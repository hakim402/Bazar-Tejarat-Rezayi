"use client";
import { AccountError } from "../../../lib/api/private-client";
import { SessionEntry } from "./session-entry";
import Link from "next/link";
import { uuidPattern } from "../../../lib/routes/account-routes";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import {
	commerce,
	type Cart,
	type Terms,
	type Choice,
	type Packet,
	type Submission,
	estimate,
} from "../api";
import { pendingIntent, retainIntent, settleIntent } from "../intents";
import { commerceCopy } from "../copy";
import { useCommerceGuard } from "./unsaved";
import { action, control, Failure, panel, Disclosure } from "./controls";
export function CheckoutWorkspace({ locale }: { locale: Locale }) {
	const s = useCommunicationSession("buyer"),
		t = commerceCopy[locale],
		currency = useSearchParams().get("currency") ?? "AFN",
		attempt = useSearchParams().get("attempt");
	if (s.loading) return <p role="status">{t.loading}</p>;
	if (!s.session)
		return <SessionEntry locale={locale} context={"buyer"} error={s.error} />;
	if (!["AFN", "USD"].includes(currency))
		return <p role="alert">{t.unavailable}</p>;
	const scope = `${s.session.identity.id}:${s.session.accounts[0].id}:buyer`;
	if (attempt && !uuidPattern.test(attempt))
		return <p role="alert">{t.unavailable}</p>;
	if (attempt && !pendingIntent(scope))
		return (
			<RecoverAttempt
				key={`${scope}:${locale}:${attempt}`}
				locale={locale}
				attempt={attempt}
			/>
		);
	return (
		<Checkout
			key={`${scope}:${locale}:${currency}`}
			scope={scope}
			locale={locale}
			currency={currency}
		/>
	);
}
function Checkout({
	locale,
	currency,
	scope,
}: {
	locale: Locale;
	currency: string;
	scope: string;
}) {
	const t = commerceCopy[locale],
		router = useRouter(),
		[cart, setCart] = useState<Cart | null>(null),
		[terms, setTerms] = useState<Record<string, Terms>>({}),
		[termStates, setTermStates] = useState<
			Record<
				string,
				"loading" | "ready" | "unconfigured" | "unavailable" | "failed"
			>
		>({}),
		[choices, setChoices] = useState<
			Record<string, Omit<Choice, "method"> & { method: Choice["method"] | "" }>
		>({}),
		[selected, setSelected] = useState<string[]>([]),
		[error, setError] = useState<unknown>(),
		[busy, setBusy] = useState(false),
		[result, setResult] = useState<{
			results: {
				seller: string;
				code: string;
				total?: string;
				currency?: string;
			}[];
		} | null>(null),
		[pending, setPending] = useState<Packet | undefined>(() =>
			pendingIntent(scope),
		);
	const live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		termRequests = useRef(new Map<string, object>());
	const loadTerms = useCallback(
		async (id: string, mine: object, signal?: AbortSignal) => {
			if (live.current !== mine || termRequests.current.has(id)) return;
			const token = {};
			termRequests.current.set(id, token);
			setTermStates((v) => ({ ...v, [id]: "loading" }));
			try {
				const value = await commerce<Terms>(
					`orders/seller/checkout-terms/${id}/?context=buyer`,
					undefined,
					"GET",
					signal,
				);
				if (live.current !== mine || termRequests.current.get(id) !== token)
					return;
				setTerms((v) => ({ ...v, [id]: value }));
				setTermStates((v) => ({
					...v,
					[id]: value.enabled ? "ready" : "unconfigured",
				}));
			} catch (e) {
				if (live.current !== mine || termRequests.current.get(id) !== token)
					return;
				if (e instanceof AccountError && [401, 403].includes(e.status ?? 0)) {
					setCart(null);
					setSelected([]);
					setChoices({});
					setTerms({});
					setError(e);
				} else
					setTermStates((v) => ({
						...v,
						[id]:
							e instanceof AccountError && e.status === 404
								? "unavailable"
								: "failed",
					}));
			} finally {
				if (termRequests.current.get(id) === token)
					termRequests.current.delete(id);
			}
		},
		[],
	);
	useEffect(() => {
		const mine = {};
		live.current = mine;
		const controller = new AbortController();
		void commerce<Cart>(
			`cart/buyer/?locale=${locale}`,
			undefined,
			"GET",
			controller.signal,
		)
			.then(async (value) => {
				const history = await commerce<{ results: Submission[] }>(
					"orders/buyer/checkouts/",
					undefined,
					"GET",
					controller.signal,
				);
				const unresolved = history.results.find((x) => x.pending);
				if (unresolved && !pendingIntent(scope) && live.current === mine) {
					router.replace(`/${locale}/account/buyer/checkouts/${unresolved.id}`);
					return;
				}
				const lines = value.lines.filter(
					(x) => x.currency === currency && x.mode === "fixed",
				);
				const sellerIds = [...new Set(lines.map((x) => x.seller))];
				if (live.current !== mine) return;
				setCart(value);
				setSelected(lines.map((x) => x.id));
				setChoices(
					Object.fromEntries(
						sellerIds.map((id) => [
							id,
							{ seller: id, country: "", city: "", method: "" },
						]),
					),
				);
				for (const id of sellerIds) void loadTerms(id, mine, controller.signal);
			})
			.catch((e) => {
				if (live.current === mine) {
					setCart(null);
					setError(e);
				}
			});
		return () => {
			live.current = null;
			owned.current = null;
			termRequests.current.clear();
			controller.abort();
		};
	}, [locale, currency, router, scope, loadTerms]);

	const navigation = useCommerceGuard(
		locale,
		!!pending ||
			Object.values(choices).some((c) => !!c.country || !!c.city || !!c.method),
	);
	const lines = cart?.lines.filter((x) => selected.includes(x.id)) ?? [],
		sellers = [...new Set(lines.map((x) => x.seller))];
	async function send(review = false) {
		if (owned.current || !cart) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		setError(null);
		try {
			let packet: Packet;
			if (pendingIntent(scope)) {
				packet =
					pendingIntent(scope) ??
					(() => {
						throw new Error("intent");
					})();
			} else {
				packet = {
					command_id: crypto.randomUUID(),
					version: cart.version,
					currency,
					lines: selected,
					choices: sellers.map((x) => {
						const choice = choices[x];
						if (choice.method !== "advance" && choice.method !== "cod")
							throw new Error("method");
						return { ...choice, method: choice.method };
					}),
					shown_prices: lines.flatMap((x) =>
						x.price ? [{ line: x.id, price: x.price }] : [],
					),
					locale,
				};
				if (!review) {
					packet = retainIntent(scope, packet);
					const url = new URL(location.href);
					url.searchParams.set("attempt", packet.command_id);
					history.replaceState(null, "", url);
					setPending(packet);
				}
			}
			const value = await commerce<
				Submission & {
					results: {
						seller: string;
						code: string;
						total?: string;
						currency?: string;
					}[];
				}
			>(`orders/buyer/${review ? "review/" : "checkouts/"}`, packet);
			if (live.current !== mine || owned.current !== write) return;
			if (review) {
				setResult(value);
			} else {
				settleIntent(scope);
				setPending(undefined);
				router.push(`/${locale}/account/buyer/checkouts/${value.id}`);
			}
		} catch (e) {
			if (live.current === mine && owned.current === write) {
				if (accessLost(e)) {
					settleIntent(scope);
					setPending(undefined);
					setCart(null);
					setChoices({});
				}
				setError(e);
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	return (
		<section className="space-y-5" data-testid="checkout-workspace">
			<h1 className="text-3xl font-bold">
				{t.checkout} · <bdi>{currency}</bdi>
			</h1>
			<Disclosure locale={locale} />
			<Failure locale={locale} error={error} />
			{navigation.feedback}
			{pending ? (
				<div className={panel}>
					<p role="status">{t.pending}</p>
					<p>{t.retryHelp}</p>
					<button
						type="button"
						className={action}
						disabled={busy}
						onClick={() => void send()}
					>
						{t.retry}
					</button>
				</div>
			) : null}
			{!cart && !error ? (
				<p role="status">{t.loading}</p>
			) : (
				<form
					className="space-y-5"
					onSubmit={(e) => {
						e.preventDefault();
						void send();
					}}
				>
					{cart?.lines
						.filter((x) => x.currency === currency && x.mode === "fixed")
						.map((row) => (
							<label
								className="flex min-h-11 items-center gap-3 rounded-card border border-border p-4"
								key={row.id}
								data-testid="checkout-selection"
								data-variant={row.variant}
								data-seller={row.seller}
							>
								<input
									type="checkbox"
									disabled={busy || !!pending}
									checked={selected.includes(row.id)}
									onChange={(e) =>
										setSelected((v) =>
											e.target.checked
												? [...v, row.id]
												: v.filter((id) => id !== row.id),
										)
									}
								/>
								<span className="min-w-0 break-words">
									<span className="block text-sm text-muted" dir="auto">
										{row.seller_name || t.unavailable}
									</span>
									<span dir="auto">{row.title || t.unavailable}</span> ·{" "}
									{t[row.tier]} ·{" "}
									<bdi>
										{row.quantity} × {row.price ?? "—"} {row.currency}
									</bdi>{" "}
									·{" "}
									<bdi>
										{row.price ? estimate(row.price, row.quantity) : "—"}{" "}
										{row.currency}
									</bdi>
								</span>
							</label>
						))}
					{[
						...new Set(
							(
								cart?.lines.filter(
									(x) => x.currency === currency && x.mode === "fixed",
								) ?? []
							).map((x) => x.seller),
						),
					].map((id) => (
						<fieldset
							disabled={busy || !!pending}
							key={id}
							data-testid="checkout-seller"
							data-seller={id}
							className={panel}
						>
							<legend
								className="break-words font-bold"
								data-testid="checkout-seller-name"
							>
								{t.destination} ·{" "}
								<bdi>
									{cart?.lines.find((line) => line.seller === id)
										?.seller_name || t.business}
								</bdi>
							</legend>
							{termStates[id] !== "ready" ? (
								<div
									className="space-y-2"
									data-testid="seller-terms-state"
									data-state={termStates[id] ?? "loading"}
								>
									<p role={termStates[id] === "loading" ? "status" : "alert"}>
										{termStates[id] === "unavailable"
											? t.termsUnavailable
											: termStates[id] === "failed"
												? t.termsDependency
												: termStates[id] === "unconfigured"
													? t.termsUnconfigured
													: t.termsLoading}
									</p>
									{termStates[id] !== "loading" && (
										<button
											type="button"
											className={action}
											disabled={busy || !!pending}
											onClick={() =>
												live.current && void loadTerms(id, live.current)
											}
										>
											{t.retry}
										</button>
									)}
								</div>
							) : (
								<fieldset
									disabled={!sellers.includes(id)}
									className="space-y-3 border-0 p-0"
								>
									<label className="block space-y-2">
										{t.country}
										<select
											required
											className={control}
											value={choices[id]?.country ?? ""}
											onChange={(e) =>
												setChoices((v) => ({
													...v,
													[id]: { ...v[id], country: e.target.value, city: "" },
												}))
											}
										>
											<option value="">{t.choose}</option>
											{terms[id].destinations.map((d) => (
												<option key={d.country} value={d.country}>
													{d.country}
												</option>
											))}
										</select>
									</label>
									<label htmlFor={`city-${id}`} className="block space-y-2">
										{t.city}
										{terms[id].destinations.find(
											(x) => x.country === choices[id]?.country,
										)?.all_cities ? (
											<input
												id={`city-${id}`}
												className={control}
												required
												maxLength={100}
												value={choices[id]?.city ?? ""}
												onChange={(e) =>
													setChoices((v) => ({
														...v,
														[id]: { ...v[id], city: e.target.value },
													}))
												}
											/>
										) : (
											<select
												id={`city-${id}`}
												className={control}
												required
												value={choices[id]?.city ?? ""}
												onChange={(e) =>
													setChoices((v) => ({
														...v,
														[id]: { ...v[id], city: e.target.value },
													}))
												}
											>
												<option value="">{t.choose}</option>
												{terms[id].destinations
													.find((x) => x.country === choices[id]?.country)
													?.cities.map((c) => (
														<option key={c}>{c}</option>
													))}
											</select>
										)}
									</label>
									<label className="block space-y-2">
										{t.method}
										<select
											aria-label={t.method}
											className={control}
											required
											value={choices[id]?.method ?? ""}
											onChange={(e) =>
												setChoices((v) => ({
													...v,
													[id]: {
														...v[id],
														method: e.target.value as Choice["method"],
													},
												}))
											}
										>
											<option value="">{t.choose}</option>
											{terms[id].methods.map((m) => (
												<option key={m} value={m}>
													{t[m]}
												</option>
											))}
										</select>
									</label>
								</fieldset>
							)}
						</fieldset>
					))}
					<button
						type="button"
						className={action}
						disabled={busy || !!pending || !lines.length}
						onClick={() => void send(true)}
					>
						{t.review}
					</button>{" "}
					<button
						type="submit"
						className={action}
						disabled={
							busy ||
							!!pending ||
							!lines.length ||
							sellers.some((id) => termStates[id] !== "ready")
						}
					>
						{busy ? t.loading : t.submit}
					</button>
				</form>
			)}
			{result ? (
				<section className={panel} aria-label={t.review}>
					{result.results.map((row) => (
						<p key={row.seller}>
							<bdi>{row.seller}</bdi> ·{" "}
							{row.code === "ready" ? t.goods : t.unavailable}{" "}
							{row.total && (
								<bdi>
									{row.total} {row.currency}
								</bdi>
							)}
						</p>
					))}
				</section>
			) : null}
			<Link className={action} href={`/${locale}/account/buyer/checkouts`}>
				{t.history}
			</Link>
		</section>
	);
}

function RecoverAttempt({
	locale,
	attempt,
}: {
	locale: Locale;
	attempt: string;
}) {
	const t = commerceCopy[locale],
		router = useRouter(),
		[error, setError] = useState<unknown>(),
		[busy, setBusy] = useState(false),
		[reload, setReload] = useState(0);
	useEffect(() => {
		void reload;
		const c = new AbortController();
		setBusy(true);
		void commerce<Submission>(
			`orders/buyer/checkouts/by-command/${attempt}/`,
			undefined,
			"GET",
			c.signal,
		)
			.then((row) => {
				if (!c.signal.aborted)
					router.replace(`/${locale}/account/buyer/checkouts/${row.id}`);
			})
			.catch((e) => {
				if (!c.signal.aborted) setError(e);
			})
			.finally(() => {
				if (!c.signal.aborted) setBusy(false);
			});
		return () => c.abort();
	}, [locale, attempt, reload, router]);
	return (
		<section className={panel} data-testid="checkout-recovery">
			<h1 className="text-2xl font-bold">{t.pending}</h1>
			<p>{t.retryHelp}</p>
			<Failure locale={locale} error={error} />
			<button
				type="button"
				className={action}
				disabled={busy}
				onClick={() => setReload((v) => v + 1)}
			>
				{busy ? t.loading : t.retry}
			</button>
			<Link className={action} href={`/${locale}/account/buyer/checkouts`}>
				{t.history}
			</Link>
		</section>
	);
}
