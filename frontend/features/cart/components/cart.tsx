"use client";
import Link from "next/link";
import { validCartQuantity } from "../recovery";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { authHref } from "../../../lib/routes/auth-routes";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import {
	commerce,
	cartPath,
	estimate,
	estimateTotal,
	type Cart,
	type Line,
} from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import {
	action,
	control,
	Failure,
	panel,
	Disclosure,
} from "../../orders/components/controls";
export function CartWorkspace({ locale }: { locale: Locale }) {
	const session = useCommunicationSession("buyer"),
		t = commerceCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session && !accessLost(session.error))
		return <Failure locale={locale} error={session.error} />;
	return (
		<CartEditor
			key={`${locale}:${session.session?.identity.id ?? "guest"}:${session.session?.accounts[0].id ?? "guest"}`}
			locale={locale}
			buyer={!!session.session}
		/>
	);
}
function CartEditor({ locale, buyer }: { locale: Locale; buyer: boolean }) {
	const t = commerceCopy[locale],
		context = buyer ? "buyer" : "guest",
		[data, setData] = useState<Cart | null>(null),
		[guest, setGuest] = useState<Cart | null>(null),
		[error, setError] = useState<unknown>(),
		[busy, setBusy] = useState(false),
		[notice, setNotice] = useState(""),
		[reload, setReload] = useState(0);
	const live = useRef<object | null>(null),
		pending = useRef<{ path: string; data: Record<string, unknown> } | null>(
			null,
		),
		owned = useRef<object | null>(null);
	useEffect(() => {
		void reload;
		const mine = {};
		live.current = mine;
		const controller = new AbortController();
		void Promise.all([
			commerce<Cart>(
				cartPath(context) + `?locale=${locale}`,
				undefined,
				"GET",
				controller.signal,
			),
			buyer
				? commerce<Cart>(
						`cart/merge/?locale=${locale}`,
						undefined,
						"GET",
						controller.signal,
					)
				: Promise.resolve(null),
		])
			.then(([value, g]) => {
				if (live.current === mine) {
					setData(value);
					setGuest(g);
					setError(null);
				}
			})
			.catch((e) => {
				if (live.current === mine) {
					setData(null);
					setError(e);
				}
			});
		return () => {
			live.current = null;
			owned.current = null;
			controller.abort();
		};
	}, [context, buyer, locale, reload]);
	async function mutate(path: string, packet: Record<string, unknown>) {
		if (owned.current) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		setError(null);
		pending.current ??= { path, data: packet };
		try {
			await commerce(pending.current.path, pending.current.data);
			if (live.current === mine && owned.current === write) {
				pending.current = null;
				setNotice(path.includes("merge") ? t.merged : t.saved);
				setReload((x) => x + 1);
			}
		} catch (e) {
			if (live.current === mine && owned.current === write) {
				if (accessLost(e)) setData(null);
				setError(e);
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function reconcileAndReload() {
		if (owned.current) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		try {
			if (pending.current) {
				if (pending.current.path.includes("merge")) {
					await commerce(pending.current.path, pending.current.data);
				} else
					await commerce(
						`${pending.current.path}commands/reconcile/`,
						pending.current.data,
					);
			}
			if (live.current === mine && owned.current === write) {
				pending.current = null;
				setReload((x) => x + 1);
			}
		} catch (e) {
			if (live.current === mine && owned.current === write) setError(e);
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	const command = (values: Record<string, unknown>) => ({
		command_id: crypto.randomUUID(),
		...(context === "guest" && data?.guest_scope
			? { guest_scope: data.guest_scope }
			: {}),
		version: data?.version ?? 0,
		...values,
	});
	const groups = ["AFN", "USD", "negotiable"].map((group) => ({
		group,
		lines:
			data?.lines.filter((x) =>
				group === "negotiable"
					? x.mode === "negotiable"
					: x.mode === "fixed" && x.currency === group,
			) ?? [],
	}));
	return (
		<div className="space-y-5" data-testid="cart-workspace">
			<h1 className="text-3xl font-bold">{t.cart}</h1>
			<Disclosure locale={locale} />
			<Failure locale={locale} error={error} />
			{pending.current && (
				<div className={panel}>
					<p>{t.retryHelp}</p>
					<button
						type="button"
						className={action}
						disabled={busy}
						onClick={() =>
							pending.current &&
							void mutate(pending.current.path, pending.current.data)
						}
					>
						{t.retry}
					</button>
				</div>
			)}
			{notice && <p role="status">{notice}</p>}
			{buyer && guest?.lines.length ? (
				<section className={panel}>
					<p>
						{t.merge} · <bdi>{guest.lines.length}</bdi>
					</p>
					<button
						type="button"
						className={action}
						disabled={busy || !!pending.current || !data}
						onClick={() =>
							void mutate(
								"cart/merge/",
								command({ guest_version: guest.version }),
							)
						}
					>
						{t.merge}
					</button>
				</section>
			) : null}
			{!data && !error ? (
				<p role="status">{t.loading}</p>
			) : data && !data.lines.length ? (
				<p>{t.empty}</p>
			) : (
				groups
					.filter((g) => g.lines.length)
					.map(({ group, lines }) => (
						<section className="space-y-4" key={group}>
							<h2 className="text-xl font-bold">
								{group === "negotiable" ? (
									t.negotiable
								) : (
									<>
										{t.fixed} · <bdi>{group}</bdi>
									</>
								)}
							</h2>
							{[...new Set(lines.map((row) => row.seller))].map((seller) => (
								<section key={seller} className="space-y-3">
									<h3 className="break-words text-lg font-bold" dir="auto">
										{lines.find((row) => row.seller === seller)?.seller_name ||
											t.unavailable}
									</h3>
									{lines
										.filter((row) => row.seller === seller)
										.map((row) => (
											<CartRow
												key={`${row.id}:${row.version}`}
												row={row}
												locale={locale}
												disabled={busy || !!pending.current}
												update={(qty) =>
													void mutate(
														cartPath(context),
														command({
															action: "set",
															variant: row.variant,
															tier: row.tier,
															quantity: qty,
														}),
													)
												}
												remove={() =>
													void mutate(
														cartPath(context),
														command({ action: "remove", line: row.id }),
													)
												}
											/>
										))}
								</section>
							))}
							{group !== "negotiable" && (
								<p className="text-xl font-bold">
									{t.estimate}:{" "}
									<bdi>
										{estimateTotal(lines) ?? "—"} {group}
									</bdi>
								</p>
							)}
							{group !== "negotiable" &&
								(buyer ? (
									<Link
										className={action}
										href={`/${locale}/account/buyer/checkout?currency=${group}`}
									>
										{t.checkout} · <bdi>{group}</bdi>
									</Link>
								) : (
									<Link
										className={action}
										href={authHref(
											locale,
											"buyer-sign-in",
											new URLSearchParams({ return: `/${locale}/cart` }),
										)}
									>
										{t.signIn}
									</Link>
								))}
						</section>
					))
			)}
			<button
				type="button"
				className={action}
				disabled={busy}
				onClick={() => void reconcileAndReload()}
			>
				{t.reload}
			</button>
		</div>
	);
}
function CartRow({
	row,
	locale,
	disabled,
	update,
	remove,
}: {
	row: Line;
	locale: Locale;
	disabled: boolean;
	update: (q: string) => void;
	remove: () => void;
}) {
	const t = commerceCopy[locale],
		[invalid, setInvalid] = useState(false),
		[quantity, setQuantity] = useState(row.quantity);
	return (
		<article
			className={panel}
			data-testid="cart-row"
			data-variant={row.variant}
		>
			<h3 className="break-words font-bold" dir="auto">
				{row.available ? row.title : t.unavailable}
			</h3>
			<p>
				<bdi>{row.sku}</bdi> · {t[row.tier]} · {row.unit_label}
			</p>
			<p>
				<bdi>
					{row.price ?? "—"} {row.currency}
				</bdi>{" "}
				× <bdi>{row.quantity}</bdi> ={" "}
				<bdi>
					{row.price ? estimate(row.price, row.quantity) : "—"} {row.currency}
				</bdi>
			</p>
			{row.tier === "wholesale" && (
				<p className="text-sm text-muted">{t.wholesaleHelp}</p>
			)}
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (!validCartQuantity(quantity, row.increment)) {
						setInvalid(true);
						return;
					}
					setInvalid(false);
					update(quantity);
				}}
			>
				<label className="space-y-2">
					{t.quantity}
					<input
						className={control}
						value={quantity}
						disabled={disabled}
						inputMode="decimal"
						dir="ltr"
						maxLength={20}
						onChange={(e) => setQuantity(e.target.value)}
						required
					/>
				</label>
				<button type="submit" className={action} disabled={disabled}>
					{t.update}
				</button>
				<button
					className={action}
					disabled={disabled}
					type="button"
					onClick={remove}
				>
					{t.remove}
				</button>
			</form>
			{invalid && <p role="alert">{t.quantityInvalid}</p>}
			<p className="text-sm text-muted">
				{t.increment}: <bdi>{row.increment}</bdi> · {t.minimum}:{" "}
				<bdi>{row.minimum}</bdi>
			</p>
			<Link
				className="inline-flex min-h-11 items-center text-action"
				href={`/${locale}/products/${row.product}?variant=${row.variant}`}
			>
				{t.choose} · {t.retail} / {t.wholesale}
			</Link>
		</article>
	);
}
