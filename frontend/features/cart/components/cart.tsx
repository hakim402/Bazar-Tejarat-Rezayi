"use client";
import { negotiationCopy } from "../../negotiations/copy";
import Link from "next/link";
import toast from "react-hot-toast";
import { validCartQuantity } from "../recovery";
import { announceCartChange } from "../transport";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { authHref } from "../../../lib/routes/auth-routes";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import { Icon } from "../../../components/ui/icon";
import { Asset } from "../../marketplace/components/cards";
import { marketplaceCopy } from "../../marketplace/copy";
import {
	commerce,
	cartPath,
	estimate,
	estimateTotal,
	stepQuantity,
	type Cart,
	type Line,
} from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import { action, Failure, panel } from "../../orders/components/controls";

const sheet =
	"rounded-card border border-border/60 bg-surface/70 shadow-card backdrop-blur-sm";
const primary =
	"inline-flex min-h-12 w-full items-center gap-2 rounded-control bg-primary px-4 text-sm font-bold text-on-primary no-underline shadow-sm transition-opacity hover:opacity-90 hover:no-underline active:scale-[0.99] motion-reduce:active:scale-100 disabled:opacity-60";
const quiet =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface/80 px-4 text-[0.8125rem] font-bold text-foreground no-underline transition-colors hover:border-action/50 hover:bg-info hover:no-underline disabled:opacity-60";
const columns = "wide:grid-cols-[minmax(0,1fr)_5.5rem_5rem_9rem_6rem_1.75rem]";
const capLabel = (locale: Locale) =>
	`text-[0.6875rem] font-semibold text-muted ${locale === "en" ? "uppercase tracking-[0.08em]" : ""}`;
const specGap = (
	<span aria-hidden="true" className="mx-1.5 opacity-50">
		{"//"}
	</span>
);
type Tier = "retail" | "wholesale";

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
				`${cartPath(context)}?locale=${locale}`,
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
				toast.success(path.includes("merge") ? t.merged : t.saved);
				announceCartChange();
				setReload((x) => x + 1);
			}
		} catch (e) {
			if (live.current === mine && owned.current === write) {
				if (accessLost(e)) setData(null);
				setError(e);
				toast.error(t.actionFailed);
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
			write = {},
			applied = !!pending.current;
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
				if (applied) {
					announceCartChange();
					toast.success(t.saved);
				}
				setReload((x) => x + 1);
			}
		} catch (e) {
			if (live.current === mine && owned.current === write) {
				setError(e);
				toast.error(t.actionFailed);
			}
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
		}),
		groups = ["AFN", "USD", "negotiable"].map((group) => ({
			group,
			lines:
				data?.lines.filter((x) =>
					group === "negotiable"
						? x.mode === "negotiable"
						: x.mode === "fixed" && x.currency === group,
				) ?? [],
		})),
		filled = groups.filter((g) => g.lines.length),
		signIn = authHref(
			locale,
			"buyer-sign-in",
			new URLSearchParams({ return: `/${locale}/cart` }),
		);
	return (
		<div className="space-y-4" data-testid="cart-workspace">
			<Failure locale={locale} error={error} />
			{pending.current && (
				<div className={panel}>
					<p className="text-sm">{t.retryHelp}</p>
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
			{buyer && guest?.lines.length ? (
				<div
					className={`flex flex-wrap items-center justify-between gap-3 ${sheet} p-4`}
				>
					<p className="text-sm">
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
				</div>
			) : null}
			{!data && !error ? (
				<p role="status">{t.loading}</p>
			) : data && !data.lines.length ? (
				<EmptyCart locale={locale} />
			) : (
				<div className={`${sheet} p-5 desktop:p-8 wide:p-10`}>
					<header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
						<h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-3xl font-extrabold tracking-tight desktop:text-4xl">
							{t.cart}
							{!!data?.lines.length && (
								<span className="text-xs font-semibold tracking-normal text-muted">
									{t.items} <bdi>{data.lines.length}</bdi>
								</span>
							)}
						</h1>
						<Link
							prefetch={false}
							href={`/${locale}/products`}
							className={quiet}
						>
							<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
							{t.continueShopping}
						</Link>
					</header>
					<div className="mt-7 grid min-w-0 gap-8 desktop:grid-cols-[minmax(0,1fr)_17rem] desktop:items-start wide:grid-cols-[minmax(0,1fr)_19rem] wide:gap-10">
						<div className="min-w-0">
							<div
								className={`hidden items-center gap-3 border-b border-border pb-3 wide:grid ${capLabel(locale)} ${columns}`}
							>
								<span>{t.lineProduct}</span>
								<span>{t.tier}</span>
								<span>{t.unitPrice}</span>
								<span className="text-center">{t.quantity}</span>
								<span className="text-end">{t.lineTotal}</span>
								<span aria-hidden="true" />
							</div>
							<div className="border-b border-border/60">
								{filled.map(({ group, lines }, index) => (
									<section
										key={group}
										className={index ? "border-t border-border/70" : undefined}
									>
										{(filled.length > 1 || group === "negotiable") && (
											<h2 className={`pt-4 ${capLabel(locale)}`}>
												{group === "negotiable" ? (
													t.negotiable
												) : (
													<>
														{t.fixed} ·{" "}
														<bdi className="text-foreground">{group}</bdi>
													</>
												)}
											</h2>
										)}
										<div className="divide-y divide-border/60">
											{lines.map((row) => (
												<CartRow
													key={`${row.id}:${row.version}`}
													row={row}
													locale={locale}
													disabled={busy || !!pending.current}
													update={(qty, tier) =>
														void mutate(
															cartPath(context),
															command({
																action: "set",
																variant: row.variant,
																tier: tier ?? row.tier,
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
										</div>
									</section>
								))}
							</div>
							<div className="mt-6 rounded-card bg-page/80 p-5 desktop:p-6">
								<div className="grid gap-6 wide:grid-cols-[minmax(0,1fr)_15rem] wide:items-start wide:gap-8">
									<div className="space-y-2">
										<h2 className="text-base font-extrabold">{t.shipping}</h2>
										<p className="text-xs leading-5 text-muted">{t.delivery}</p>
										<button
											type="button"
											className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-action disabled:opacity-60"
											disabled={busy}
											onClick={() => void reconcileAndReload()}
										>
											<Icon name="history" className="size-4" />
											{t.reload}
										</button>
									</div>
									<div className="space-y-5">
										{filled.map(({ group, lines }) => (
											<CartTotals
												key={group}
												locale={locale}
												group={
													group === "negotiable" ? lines[0].currency : group
												}
												label={
													filled.length > 1
														? group === "negotiable"
															? t.negotiableShort
															: `${t.fixed} · ${group}`
														: undefined
												}
												lines={lines}
											/>
										))}
									</div>
								</div>
							</div>
						</div>
						<aside className="min-w-0 desktop:sticky desktop:top-6">
							<PaymentPanel
								locale={locale}
								groups={filled}
								buyer={buyer}
								signIn={signIn}
							/>
						</aside>
					</div>
				</div>
			)}
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
	update: (quantity: string, tier?: Tier) => void;
	remove: () => void;
}) {
	const t = commerceCopy[locale],
		market = marketplaceCopy[locale],
		[invalid, setInvalid] = useState(false),
		[quantity, setQuantity] = useState(row.quantity),
		labelId = `cart-quantity-${row.id}`,
		helpId = `cart-quantity-help-${row.id}`,
		draft = /^\d{1,9}(\.\d{1,3})?$/.test(quantity) ? quantity : row.quantity,
		commit = (value: string, tier?: Tier) => {
			if (!validCartQuantity(value, row.increment)) {
				setInvalid(true);
				return;
			}
			setInvalid(false);
			update(value, tier);
		},
		step = (delta: 1 | -1) => {
			try {
				const next = stepQuantity(draft, row.increment, delta);
				setQuantity(next);
				if (next === row.quantity) setInvalid(false);
				else commit(next);
			} catch {
				setQuantity(row.quantity);
			}
		};
	return (
		<article
			data-testid="cart-row"
			data-variant={row.variant}
			className={`flex flex-wrap items-center gap-x-3 gap-y-3 py-5 wide:grid wide:gap-3 ${columns}`}
		>
			<div className="flex min-w-0 grow basis-full items-center gap-3 wide:basis-auto">
				<div
					className={`size-16 shrink-0 overflow-hidden rounded-control bg-page wide:size-20 ${row.image ? "" : "border border-border/60"}`}
				>
					{row.image ? (
						<Asset asset={row.image} className="size-full object-cover" />
					) : (
						<span className="flex size-full items-center justify-center text-muted">
							<Icon name="box" className="size-6" />
							<span className="sr-only">{t.lineProduct}</span>
						</span>
					)}
				</div>
				<div className="min-w-0 space-y-1">
					<Link
						prefetch={false}
						href={`/${locale}/products/${row.product}?variant=${row.variant}`}
						className="line-clamp-2 break-words text-sm font-bold text-foreground no-underline hover:text-action hover:underline"
						dir="auto"
					>
						{row.available ? row.title : t.unavailable}
					</Link>
					<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
						<bdi>{row.sku}</bdi>
						<span aria-hidden="true">·</span>
						<span className="max-w-full truncate" dir="auto">
							{row.seller_name || t.unavailable}
						</span>
					</p>
					{(!!row.attributes?.length || !!row.contents) && (
						<p className="line-clamp-2 text-xs leading-5 text-muted">
							{(row.attributes ?? []).map((spec, index) => (
								<span key={`${spec.label}:${spec.value}`}>
									{index > 0 && specGap}
									<b className="font-semibold">{spec.label}:</b>{" "}
									<span dir="auto">{spec.value}</span>
								</span>
							))}
							{row.contents && (
								<span>
									{!!row.attributes?.length && specGap}
									<span dir="auto">{row.contents}</span>
								</span>
							)}
						</p>
					)}
					{(row.mode === "negotiable" ||
						!row.available ||
						row.availability === "unavailable") && (
						<p className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] font-bold">
							{row.mode === "negotiable" && (
								<span className="rounded-full bg-info px-2 py-0.5 text-action">
									{t.negotiableShort}
								</span>
							)}
							{row.available && row.availability === "unavailable" && (
								<span className="rounded-full bg-warning-surface px-2 py-0.5 text-warning">
									{market.unavailableStock}
								</span>
							)}
							{!row.available && (
								<span className="rounded-full bg-danger/10 px-2 py-0.5 text-danger">
									{t.unavailable}
								</span>
							)}
						</p>
					)}
				</div>
			</div>
			<select
				aria-label={t.tier}
				className="min-h-9 w-full max-w-24 rounded-control border border-border bg-surface/80 px-2 text-xs font-bold text-foreground transition-colors hover:border-action/50 disabled:opacity-50"
				value={row.tier}
				disabled={disabled}
				onChange={(e) => commit(draft, e.target.value as Tier)}
			>
				<option value="retail" disabled={row.retail === null}>
					{t.retail}
				</option>
				<option value="wholesale" disabled={row.wholesale === null}>
					{t.wholesale}
				</option>
			</select>
			<span className="min-w-0 text-sm">
				<bdi dir="ltr" className="font-bold">
					{row.price ?? "—"}
				</bdi>
				{row.price && (
					<span className="ms-1 text-[0.6875rem] font-semibold text-muted">
						{row.currency}
					</span>
				)}
			</span>
			<form
				className="flex items-center wide:justify-center"
				onSubmit={(e) => {
					e.preventDefault();
					commit(quantity);
				}}
			>
				<span id={labelId} className="sr-only">
					{t.quantity}
				</span>
				<span id={helpId} className="sr-only">
					{t.increment}: {row.increment} · {t.minimum}: {row.minimum}
				</span>
				<button
					type="button"
					aria-label={market.decreaseQuantity}
					title={market.decreaseQuantity}
					disabled={disabled}
					onClick={() => step(-1)}
					className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-info hover:text-action active:bg-info disabled:opacity-50"
				>
					<Icon name="minus" className="size-4" />
				</button>
				<input
					inputMode="decimal"
					dir="ltr"
					aria-labelledby={labelId}
					aria-describedby={helpId}
					className="min-h-8 w-20 shrink-0 rounded-control border-0 bg-transparent px-0.5 text-center text-sm font-bold text-foreground focus-visible:ring-2 focus-visible:ring-focus/50 disabled:opacity-50"
					value={quantity}
					maxLength={20}
					disabled={disabled}
					onChange={(e) => {
						setQuantity(e.target.value);
						setInvalid(false);
					}}
					required
				/>
				<button
					type="button"
					aria-label={market.increaseQuantity}
					title={market.increaseQuantity}
					disabled={disabled}
					onClick={() => step(1)}
					className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-info hover:text-action active:bg-info disabled:opacity-50"
				>
					<Icon name="plus" className="size-4" />
				</button>
				<button
					type="submit"
					aria-label={t.update}
					title={t.update}
					disabled={disabled}
					className="ms-1 flex size-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-info hover:text-action disabled:opacity-50"
				>
					<Icon name="check" className="size-3.5" />
				</button>
			</form>
			<span className="ms-auto min-w-0 wide:ms-0 wide:w-full wide:text-end">
				<bdi dir="ltr" className="text-sm font-extrabold">
					{row.price
						? `${estimate(row.price, row.quantity)} ${row.currency}`
						: `— ${row.currency}`}
				</bdi>
			</span>
			<button
				type="button"
				onClick={remove}
				disabled={disabled}
				aria-label={t.remove}
				title={t.remove}
				className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
			>
				<Icon name="close" className="size-4" />
			</button>
			{invalid && (
				<p
					role="alert"
					className="basis-full text-xs font-semibold text-danger wide:col-span-full"
				>
					{t.quantityInvalid}
				</p>
			)}
			{(invalid || row.tier === "wholesale") && (
				<p className="basis-full text-xs text-muted wide:col-span-full">
					{t.increment}: <bdi>{row.increment}</bdi> · {t.minimum}:{" "}
					<bdi>{row.minimum}</bdi>
				</p>
			)}
		</article>
	);
}
function CartTotals({
	locale,
	group,
	label,
	lines,
}: {
	locale: Locale;
	group: string;
	label?: string;
	lines: Line[];
}) {
	const t = commerceCopy[locale],
		cap = capLabel(locale),
		total = estimateTotal(lines);
	return (
		<dl className="m-0 space-y-2.5 text-sm">
			{label && <dt className={cap}>{label}</dt>}
			<div className="flex items-baseline justify-between gap-4">
				<dt className={cap}>{t.subtotal}</dt>
				<dd className="m-0 font-bold">
					<bdi dir="ltr">
						{total ?? "—"} {group}
					</bdi>
				</dd>
			</div>
			<div className="flex items-baseline justify-between gap-4">
				<dt className={cap}>{t.shipping}</dt>
				<dd className="m-0 font-semibold text-muted">—</dd>
			</div>
			<div className="flex items-baseline justify-between gap-4 border-t border-border pt-2.5">
				<dt className={cap}>{t.total}</dt>
				<dd className="m-0 text-base font-extrabold">
					<bdi dir="ltr">
						{total ?? "—"} {group}
					</bdi>
				</dd>
			</div>
		</dl>
	);
}
function PaymentPanel({
	locale,
	groups,
	buyer,
	signIn,
}: {
	locale: Locale;
	groups: { group: string; lines: Line[] }[];
	buyer: boolean;
	signIn: string;
}) {
	const t = commerceCopy[locale],
		fixed = groups.filter((g) => g.group !== "negotiable"),
		currencies = [
			...new Set(
				groups
					.filter((g) => g.group === "negotiable")
					.flatMap(({ lines }) => lines.map((row) => row.currency)),
			),
		],
		methods = [
			["truck", t.cod, t.codHelp],
			["wallet", t.advance, t.advanceHelp],
		] as ["truck" | "wallet", string, string][],
		termsHref = (currency: string) =>
			buyer
				? `/${locale}/account/buyer/negotiations/new?currency=${currency}`
				: signIn,
		signInLink = (
			<Link key="sign-in" className={`${primary} justify-center`} href={signIn}>
				{t.signIn}
				<Icon name="arrow" className="size-4 rtl:-scale-x-100" />
			</Link>
		),
		termsLink = (currency: string, style: string) => (
			<Link key={currency} className={style} href={termsHref(currency)}>
				<Icon name="handshake" className="size-4" />
				{negotiationCopy[locale].new} · <bdi>{currency}</bdi>
			</Link>
		);
	return (
		<section className="space-y-4 rounded-card border border-border/60 bg-page/80 p-5">
			<h2 className="flex items-center gap-2.5 text-lg font-extrabold">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info text-action">
					<Icon name="wallet" className="size-4" />
				</span>
				{t.paymentInfo}
			</h2>
			<div className="space-y-2">
				<h3 className={capLabel(locale)}>{t.method}</h3>
				<ul className="m-0 list-none space-y-2 p-0">
					{methods.map(([icon, label, help]) => (
						<li
							key={label}
							className="flex items-start gap-2.5 rounded-control border border-border/50 bg-surface/70 p-3"
						>
							<Icon
								name={icon}
								className="mt-0.5 size-4 shrink-0 text-action"
							/>
							<span className="min-w-0">
								<b className="block text-sm font-bold">{label}</b>
								<span className="mt-0.5 block text-xs leading-5 text-muted">
									{help}
								</span>
							</span>
						</li>
					))}
				</ul>
			</div>
			<p className="text-xs leading-5 text-muted">{t.methodHelp}</p>
			<div className="space-y-2.5 border-t border-border pt-4">
				{fixed.length
					? buyer
						? fixed.map(({ group, lines }) => (
								<Link
									key={group}
									className={`${primary} justify-between`}
									href={`/${locale}/account/buyer/checkout?currency=${group}`}
								>
									<span>
										{t.checkout} · <bdi>{group}</bdi>
									</span>
									<bdi dir="ltr">{estimateTotal(lines) ?? "—"}</bdi>
								</Link>
							))
						: signInLink
					: buyer
						? currencies.map((currency) =>
								termsLink(currency, `${primary} justify-center`),
							)
						: signInLink}
				{!!fixed.length &&
					currencies.map((currency) => termsLink(currency, `${quiet} w-full`))}
			</div>
			<p className="text-xs leading-5 text-muted">{t.currentPrice}</p>
		</section>
	);
}
function EmptyCart({ locale }: { locale: Locale }) {
	const t = commerceCopy[locale],
		market = marketplaceCopy[locale];
	return (
		<div className={`mx-auto max-w-md space-y-4 p-8 text-center ${sheet}`}>
			<span className="mx-auto flex size-14 items-center justify-center rounded-full bg-info text-action">
				<Icon name="cart" className="size-7" />
			</span>
			<p className="text-lg font-bold">{t.empty}</p>
			<Link
				prefetch={false}
				href={`/${locale}/products`}
				className={`${primary} justify-center`}
			>
				{market.browseProducts}
			</Link>
		</div>
	);
}
