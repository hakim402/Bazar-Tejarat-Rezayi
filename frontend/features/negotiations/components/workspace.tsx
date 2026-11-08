"use client";
import Link from "next/link";
import { goodsTotal } from "../validation";
import { NegotiationFailure } from "./failure";
import { Confirmation } from "./confirmation";
import { FinalizationReview } from "./finalization-review";
import { History, ProposalSummary } from "./history";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { authCopy } from "../../../lib/i18n/auth";
import {
	SalesFrame,
	SalesHeader,
	SalesBusinessSelect,
	SalesEmpty,
	SalesPagination,
	SalesRelated,
	salesHref,
	salesAction,
	salesControl,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context } from "../../messaging/api";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import { localTimestamp } from "../../messaging/api";
import { SessionEntry } from "../../orders/components/session-entry";
import {
	action as buyerAction,
	control as buyerControl,
	panel as buyerPanel,
} from "../../orders/components/controls";
import { useCommerceGuard } from "../../orders/components/unsaved";
import {
	commerce,
	invoiceHref,
	type Profile,
	type Terms,
	type Cart,
} from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import { negotiationCopy } from "../copy";
import {
	negotiation,
	requestHref,
	getIntent,
	retain,
	settle,
	reference,
	type Proposal,
	type RequestRow,
	type Result,
	type Pending,
	type PreviewResult,
	type FinalPreviewResult,
	productContext,
	productText,
} from "../api";
import { ProposalFields, TermsFields, validateLines } from "./fields";
import {
	uuidPattern,
	type QueryReader,
} from "../../../lib/routes/account-routes";

export function NegotiationWorkspace({
	locale,
	context,
	id,
	builder = false,
}: {
	locale: Locale;
	context: Context;
	id?: string;
	builder?: boolean;
}) {
	const session = useCommunicationSession(context),
		q = useSearchParams(),
		t = negotiationCopy[locale];
	if (session.loading) return <p role="status">{t.review}…</p>;
	if (!session.session)
		return (
			<SessionEntry locale={locale} context={context} error={session.error} />
		);
	const seller = context === "seller" ? (q.get("seller") ?? "") : "",
		currency = q.get("currency") ?? "AFN",
		page = Number(q.get("page") ?? 1),
		attempt = q.get("negotiation_command");
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt && !uuidPattern.test(attempt)) ||
		!["AFN", "USD"].includes(currency) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000
	)
		return <p role="alert">{t.error}</p>;
	const scope = `${session.session.identity.id}:${session.session.accounts[0].id}:${context}:${seller}:${id ?? (builder ? `builder:${currency}` : "list")}`;
	return (
		<Workspace
			key={`${scope}:${locale}:${currency}:${page}:${q.get("state") ?? ""}:${q.get("q") ?? ""}:${q.get("history_page") ?? "1"}`}
			{...{
				locale,
				context,
				id,
				builder,
				seller,
				currency,
				page,
				attempt,
				scope,
			}}
		/>
	);
}
function Workspace({
	locale,
	context,
	id,
	builder,
	seller,
	currency,
	page,
	attempt,
	scope,
}: {
	locale: Locale;
	context: Context;
	id?: string;
	builder: boolean;
	seller: string;
	currency: string;
	page: number;
	attempt: string | null;
	scope: string;
}) {
	const t = negotiationCopy[locale],
		sales = sellerSalesCopy[locale],
		isSeller = context === "seller",
		action = isSeller ? salesAction : buyerAction,
		control = isSeller ? salesControl : buyerControl,
		panel = isSeller ? salesPanel : buyerPanel,
		router = useRouter(),
		search = useSearchParams();
	const historyPage = Number(search.get("history_page") ?? 1);
	const filterState = search.get("state") ?? "",
		filterQuery = search.get("q") ?? "";
	const [row, setRow] = useState<RequestRow | null>(null),
		[rows, setRows] = useState<{ results: RequestRow[]; count: number } | null>(
			null,
		),
		[profiles, setProfiles] = useState<Profile[]>([]),
		[cart, setCart] = useState<Cart | null>(null),
		[proposals, setProposals] = useState<Record<string, Proposal>>({}),
		[terms, setTerms] = useState<Record<string, Terms>>({}),
		[failedTerms, setFailedTerms] = useState<string[]>([]),
		[selected, setSelected] = useState<string[]>([]),
		[error, setError] = useState<unknown>(),
		[result, setResult] = useState<Result | null>(null),
		[busy, setBusy] = useState(false),
		[ready, setReady] = useState(false),
		[reason, setReason] = useState(""),
		[ack, setAck] = useState(false),
		[dirty, setDirty] = useState(false),
		[reload, setReload] = useState(0),
		[confirmation, setConfirmation] = useState<string | null>(null),
		[confirmationKey, setConfirmationKey] = useState(0),
		[preview, setPreview] = useState<PreviewResult>(),
		[finalReview, setFinalReview] = useState<{
			packet: Pending;
			preview: FinalPreviewResult;
			currency: string;
		} | null>(null),
		[intent, setIntent] = useState<Pending | undefined>(() => getIntent(scope)),
		[referenceOnly, setReferenceOnly] = useState(
			!!attempt && !getIntent(scope),
		);
	const entry = useRef({ params: search, attempt });
	const live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		termPending = useRef(new Set<string>()),
		focus = useRef<HTMLElement | null>(null),
		modalToken = useRef(0);
	const guard = useCommerceGuard(locale, dirty || !!intent || referenceOnly);
	const blocked = busy || !!intent || referenceOnly;
	const commandKey = intent?.key ?? attempt;
	const loadTerms = useCallback(
		async function loadTerms(sid: string, mine: object, signal?: AbortSignal) {
			if (termPending.current.has(sid)) return;
			termPending.current.add(sid);
			try {
				const value = await commerce<Terms>(
					`orders/seller/checkout-terms/${sid}/?context=${context}`,
					undefined,
					"GET",
					signal,
				);
				if (live.current !== mine) return;
				setTerms((v) => ({ ...v, [sid]: value }));
				setFailedTerms((v) => v.filter((x) => x !== sid));
			} catch (e) {
				if (live.current === mine) {
					if (
						accessLost(e) &&
						!(e instanceof Error && "status" in e && e.status === 404)
					) {
						setError(e);
						setReady(false);
					} else setFailedTerms((v) => [...new Set([...v, sid])]);
				}
			} finally {
				if (live.current === mine) termPending.current.delete(sid);
			}
		},
		[context],
	);
	useEffect(() => {
		void reload;
		const mine = {};
		live.current = mine;
		const controller = new AbortController();
		setReady(false);
		setAck(false);
		void (async () => {
			if (context === "seller") {
				const p = await commerce<{ results: Profile[] }>(
					"orders/seller/profiles/",
					undefined,
					"GET",
					controller.signal,
				);
				if (live.current !== mine) return;
				const allowed = p.results.filter((p) => p.orders);
				setProfiles(allowed);
				if (!seller && !id) {
					if (allowed[0])
						router.replace(
							salesHref(
								locale,
								"negotiations",
								allowed[0].id,
								id,
								entry.current.params,
							) +
								(id && historyPage > 1 ? `&history_page=${historyPage}` : "") +
								(entry.current.attempt
									? `&negotiation_command=${entry.current.attempt}`
									: ""),
						);
					else {
						setRows({ results: [], count: 0 });
						setReady(true);
					}
					return;
				}
				if (seller && !allowed.some((p) => p.id === seller))
					throw Error("scope");
			}
			if (builder) {
				const value = await commerce<Cart>(
					`cart/buyer/?locale=${locale}`,
					undefined,
					"GET",
					controller.signal,
				);
				if (live.current !== mine) return;
				const lines = value.lines.filter(
					(l) => l.mode === "negotiable" && l.currency === currency,
				);
				const ids = [...new Set(lines.map((l) => l.seller))];
				setCart(value);
				setSelected(ids);
				setProposals(
					Object.fromEntries(
						ids.map((sid) => [
							sid,
							{
								lines: lines
									.filter((l) => l.seller === sid)
									.map((l) => ({
										variant: l.variant,
										tier: l.tier,
										quantity: l.quantity,
										unit_price: "0.00",
										max_quantity: l.quantity,
										max_unit_price: "0.00",
									})),
								choice: { seller: sid, country: "", city: "", method: "" },
								note: "",
								explanation: "seller-finalizes-v1",
							},
						]),
					),
				);
				for (const sid of ids) void loadTerms(sid, mine, controller.signal);
			} else if (id) {
				const value = await negotiation<RequestRow>(
					context,
					`negotiations/${id}/?locale=${locale}&history_page=${historyPage}${seller ? `&seller=${seller}` : ""}`,
					undefined,
					controller.signal,
				);
				if (live.current !== mine) return;
				if (context === "seller" && !seller) {
					const href = salesHref(
						locale,
						"negotiations",
						value.seller,
						id,
						entry.current.params,
					);
					router.replace(
						`${href}${historyPage > 1 ? `&history_page=${historyPage}` : ""}${entry.current.attempt ? `&negotiation_command=${entry.current.attempt}` : ""}`,
					);
					return;
				}
				setRow(value);
				setProposals({ [value.seller]: structuredClone(value.proposal) });
				if (value.actions.some((a) => ["finalize", "resubmit"].includes(a)))
					void loadTerms(value.seller, mine, controller.signal);
			} else {
				const query = new URLSearchParams({
					page: String(page),
					locale,
					state: filterState,
					q: filterQuery,
				});
				if (seller) query.set("seller", seller);
				const value = await negotiation<{
					results: RequestRow[];
					count: number;
				}>(context, `negotiations/?${query}`, undefined, controller.signal);
				if (live.current !== mine) return;
				setRows(value);
			}
			if (live.current === mine) {
				setReady(true);
				setError(null);
			}
		})().catch((e) => {
			if (live.current === mine) {
				setError(e);
				setReady(false);
				setRow(null);
				setRows(null);
				setCart(null);
				setProposals({});
			}
		});
		return () => {
			live.current = null;
			owned.current = null;
			termPending.current.clear();
			controller.abort();
		};
		// The instance key owns identity, business, locale, filters and request.
	}, [
		reload,
		builder,
		currency,
		page,
		seller,
		id,
		locale,
		context,
		router,
		loadTerms,
		historyPage,
		filterState,
		filterQuery,
	]);
	function change(sid: string, value: Proposal) {
		setProposals((v) => ({ ...v, [sid]: value }));
		setDirty(true);
		setAck(false);
		setPreview(undefined);
	}
	function done(value: Result) {
		setFinalReview(null);
		if (value.pending) {
			setResult(value);
			setDirty(false);
			setConfirmation(null);
			setPreview(undefined);
			return;
		}
		settle(scope);
		setIntent(undefined);
		setReferenceOnly(false);
		reference(null);
		setResult(value);
		setDirty(false);
		setConfirmation(null);
		setPreview(undefined);
		if (id) setReload((x) => x + 1);
	}
	async function send(actionName: string, confirm = false) {
		if (owned.current) return;
		if (actionName === "finalize" && !confirm && !intent)
			focus.current = document.activeElement as HTMLElement;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		setError(null);
		try {
			let packet = intent;
			if (!packet && actionName === "finalize" && confirm) {
				if (!finalReview) throw Error("review");
				packet = retain(scope, finalReview.packet);
				setIntent(packet);
				reference(packet.key);
			}
			if (!packet) {
				const key = crypto.randomUUID();
				let body: Record<string, unknown>;
				let path: string;
				if (builder) {
					if (
						!selected.length ||
						!ack ||
						selected.some(
							(sid) =>
								!validateLines(proposals[sid].lines) || !terms[sid]?.enabled,
						)
					)
						throw Error("limits");
					body = {
						command_id: key,
						version: cart?.version,
						currency,
						lines: cart?.lines
							.filter(
								(l) =>
									l.mode === "negotiable" &&
									l.currency === currency &&
									selected.includes(l.seller),
							)
							.map((l) => l.id),
						proposals: selected.map((sid) => proposals[sid]),
					};
					path = "negotiation-submissions/";
				} else {
					if (!row) throw Error("request");
					body = { command_id: key, version: row.version, reason };
					path = `negotiations/${id}/${actionName}/`;
					if (actionName === "resubmit") {
						if (!ack || !validateLines(proposals[row.seller].lines))
							throw Error("limits");
						const {
							context: _,
							goods_total: __,
							...proposal
						} = proposals[row.seller];
						body.proposal = proposal;
					}
					if (actionName === "finalize") {
						const p = proposals[row.seller];
						if (!validateLines(p.lines)) throw Error("limits");
						body.lines = p.lines.map(
							({ max_quantity: _, max_unit_price: __, ...line }) => line,
						);
						body.choice = p.choice;
					}
				}
				if (
					actionName === "review" ||
					(actionName === "finalize" && !confirm)
				) {
					if (builder) {
						const value = await negotiation<PreviewResult>(
							context,
							"negotiation-submissions/review/",
							body,
						);
						if (live.current === mine) setPreview(value);
					} else {
						const value = await negotiation<FinalPreviewResult>(
							context,
							`negotiations/${id}/finalize/review/`,
							body,
						);
						if (live.current === mine) {
							if (
								!value.proposal ||
								!value.final ||
								value.version !== body.version
							)
								throw Error("review");
							setFinalReview(
								structuredClone({
									packet: { key, path, body, kind: "action" as const },
									preview: value,
									currency: row?.currency ?? currency,
								}),
							);
							setConfirmationKey(++modalToken.current);
							setConfirmation("finalize");
						}
					}
					return;
				}
				packet = retain(scope, {
					key,
					path,
					body,
					kind: builder ? "submission" : "action",
				});
				setIntent(packet);
				reference(key);
			}
			const value = await negotiation<Result>(
				context,
				packet.path,
				packet.body,
			);
			if (live.current === mine) done(value);
		} catch (e) {
			if (live.current === mine) {
				setError(e);
				setConfirmation(null);
				setFinalReview(null);
				if (accessLost(e)) {
					setReady(false);
					setRow(null);
					setCart(null);
				}
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function recover(resume = false) {
		if (owned.current || (!resume && !commandKey) || (resume && !result?.id))
			return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		try {
			const path = resume
				? `negotiation-submissions/${result?.id}/resume/`
				: builder
					? `negotiation-submissions/by-command/${commandKey}/reconcile/`
					: `negotiations/${id}/commands/${commandKey}/reconcile/`;
			const value = await negotiation<Result>(context, path, {});
			if (live.current === mine) done(value);
		} catch (e) {
			if (live.current === mine) setError(e);
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	function prompt(actionName: string, opener: HTMLElement) {
		focus.current = opener;
		setConfirmationKey(++modalToken.current);
		setConfirmation(actionName);
	}
	const sid = row?.seller;
	const otherActions =
		row?.actions.filter((a) => !["resubmit", "finalize"].includes(a)) ?? [];
	const editable =
		builder ||
		(row?.actions.includes("resubmit") && context === "buyer") ||
		(row?.actions.includes("finalize") && context === "seller");
	return (
		<SalesFrame seller={isSeller}>
			<section
				className={isSeller ? "min-w-0 space-y-6" : "space-y-5"}
				data-testid="negotiation-workspace"
			>
				{isSeller ? (
					<SalesHeader
						locale={locale}
						section="negotiations"
						seller={seller}
						back={
							id
								? salesHref(locale, "negotiations", seller, undefined, search)
								: undefined
						}
						business={
							profiles.length > 0 ? (
								<SalesBusinessSelect
									locale={locale}
									value={seller}
									profiles={profiles}
									onChange={(chosen) =>
										guard.choose(() =>
											router.push(
												salesHref(
													locale,
													"negotiations",
													chosen,
													undefined,
													search,
													{ page: "1" },
												),
											),
										)
									}
								/>
							) : (
								<p className="text-sm text-muted">
									{error
										? commerceCopy[locale].unavailable
										: ready
											? sales.noBusiness
											: commerceCopy[locale].loading}
								</p>
							)
						}
					/>
				) : (
					<header className="flex flex-wrap items-center justify-between gap-3">
						<h1 className="text-2xl font-bold">
							{t.title}
							{builder ? ` · ${currency}` : ""}
						</h1>
						{context === "buyer" && !builder && (
							<Link
								className={action}
								href={`${requestHref(locale, context, "new")}?currency=AFN`}
							>
								{t.new}
							</Link>
						)}
					</header>
				)}
				{guard.feedback}
				<NegotiationFailure locale={locale} error={error} />
				{commandKey && (intent || referenceOnly) && (
					<div className={panel} role="status">
						<p>{result?.pending ? commerceCopy[locale].pending : t.pending}</p>
						{intent && (
							<button
								type="button"
								className={action}
								disabled={busy}
								onClick={() => void send("retry")}
							>
								{t.retry}
							</button>
						)}{" "}
						<button
							type="button"
							className={action}
							disabled={busy}
							onClick={() => void recover()}
						>
							{t.recover}
						</button>
					</div>
				)}
				{result && (
					<ResultView
						{...{ locale, context, result, seller }}
						params={search}
						disabled={busy}
						onResume={() => void recover(true)}
					/>
				)}
				{!ready && !error && <p role="status">{t.review}…</p>}
				{rows && isSeller ? (
					profiles.length === 0 ? (
						<SalesEmpty locale={locale} noBusiness />
					) : (
						<>
							<form
								className={`${panel} grid items-end gap-3 space-y-0! sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_auto]`}
								onSubmit={(e) => {
									e.preventDefault();
									const data = new FormData(e.currentTarget);
									guard.choose(() =>
										router.push(
											salesHref(
												locale,
												"negotiations",
												seller,
												undefined,
												undefined,
												{
													q: String(data.get("q") ?? ""),
													state: String(data.get("state") ?? ""),
												},
											),
										),
									);
								}}
							>
								<label className="grid min-w-0 gap-2">
									{t.search}
									<input
										name="q"
										className={control}
										maxLength={100}
										dir="auto"
										defaultValue={filterQuery}
									/>
								</label>
								<label className="grid min-w-0 gap-2">
									{t.status}
									<select
										className={control}
										name="state"
										defaultValue={filterState}
									>
										<option value="">{t.all}</option>
										{(
											[
												"submitted",
												"correction_requested",
												"accepted",
												"withdrawn",
												"rejected",
											] as const
										).map((state) => (
											<option key={state} value={state}>
												{t[state]}
											</option>
										))}
									</select>
								</label>
								<div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
									<button type="submit" className={action}>
										{t.search}
									</button>
									{(filterQuery || filterState || page > 1) && (
										<Link
											className={action}
											href={salesHref(locale, "negotiations", seller)}
										>
											{sales.clear}
										</Link>
									)}
								</div>
							</form>
							{rows.results.length === 0 ? (
								<SalesEmpty
									locale={locale}
									filtered={!!filterQuery || !!filterState || page > 1}
								>
									{(filterQuery || filterState || page > 1) && (
										<Link
											className={action}
											href={salesHref(locale, "negotiations", seller)}
										>
											{sales.clear}
										</Link>
									)}
								</SalesEmpty>
							) : (
								<div className="space-y-3">
									{rows.results.map((r) => (
										<article
											key={r.id}
											className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm"
										>
											<div className="flex flex-wrap items-start justify-between gap-3">
												<div className="min-w-0 space-y-2">
													<h2 className="break-words font-semibold">
														{r.seller_name}
													</h2>
													<p className="break-all text-xs text-muted">
														{t.request}: <bdi>{r.id}</bdi>
													</p>
												</div>
												<span className="rounded-full border border-border bg-info px-3 py-1 text-xs font-semibold text-action">
													{t[r.state]}
												</span>
											</div>
											<dl className="my-4 grid min-w-0 gap-3 text-sm sm:grid-cols-3">
												<div className="min-w-0">
													<dt className="text-xs text-muted">
														{authCopy[locale].buyer}
													</dt>
													<dd className="break-all">
														<bdi>{r.buyer}</bdi>
													</dd>
												</div>
												<div>
													<dt className="text-xs text-muted">
														{commerceCopy[locale].currency} · {t.version}
													</dt>
													<dd>
														<bdi>{r.currency}</bdi> · <bdi>{r.version}</bdi>
													</dd>
												</div>
												<div>
													<dt className="text-xs text-muted">{t.submitted}</dt>
													<dd>
														<bdi>{localTimestamp(r.created_at, locale)}</bdi>
													</dd>
												</div>
											</dl>
											<Link
												className={action}
												href={salesHref(
													locale,
													"negotiations",
													seller,
													r.id,
													search,
												)}
											>
												{sales.view}
											</Link>
										</article>
									))}
								</div>
							)}
							<SalesPagination
								locale={locale}
								page={page}
								count={rows.count}
								onPage={(next) =>
									guard.choose(() =>
										router.push(
											salesHref(
												locale,
												"negotiations",
												seller,
												undefined,
												search,
												{ page: String(next) },
											),
										),
									)
								}
							/>
						</>
					)
				) : (
					rows && (
						<>
							<form
								className="flex flex-wrap gap-3"
								onSubmit={(e) => {
									e.preventDefault();
									const data = new FormData(e.currentTarget);
									const q = new URLSearchParams({
										q: String(data.get("q") ?? ""),
										state: String(data.get("state") ?? ""),
									});
									if (seller) q.set("seller", seller);
									router.push(`${requestHref(locale, context)}?${q}`);
								}}
							>
								<label>
									{t.search}
									<input
										name="q"
										className={control}
										maxLength={100}
										defaultValue={search.get("q") ?? ""}
									/>
								</label>
								<label>
									{t.status}
									<select
										className={control}
										name="state"
										defaultValue={search.get("state") ?? ""}
									>
										<option value="">{t.all}</option>
										{(
											[
												"submitted",
												"correction_requested",
												"accepted",
												"withdrawn",
												"rejected",
											] as const
										).map((s) => (
											<option key={s} value={s}>
												{t[s]}
											</option>
										))}
									</select>
								</label>
								<button type="submit" className={action}>
									{t.search}
								</button>
							</form>
							{!rows.results.length ? (
								<p>{t.empty}</p>
							) : (
								rows.results.map((r) => (
									<article key={r.id} className={panel}>
										<Link
											className="font-bold text-action underline"
											href={requestHref(locale, context, r.id, seller)}
										>
											{r.seller_name} · <bdi>{r.id}</bdi>
										</Link>
										<p>
											{t[r.state]} · <bdi>{r.currency}</bdi> · {t.version}{" "}
											<bdi>{r.version}</bdi>
										</p>
										<p>
											{r.buyer} ·{" "}
											<bdi>{localTimestamp(r.created_at, locale)}</bdi>
										</p>
									</article>
								))
							)}
							<nav className="flex gap-3">
								{[page - 1, page + 1]
									.filter((p) => p > 0 && p <= Math.ceil(rows.count / 20))
									.map((p) => (
										<Link
											key={p}
											className={action}
											href={`${requestHref(locale, context)}?${new URLSearchParams({ page: String(p), state: filterState, q: filterQuery, ...(seller ? { seller } : {}) })}`}
										>
											{p < page ? t.previous : t.next}
										</Link>
									))}
							</nav>
						</>
					)
				)}
				{row && isSeller ? (
					<>
						<section className={panel}>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<h2 className="text-lg font-semibold">{sales.details}</h2>
								<span className="rounded-full border border-border bg-info px-3 py-1 text-xs font-semibold text-action">
									{t[row.state]}
								</span>
							</div>
							<dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
								<div className="min-w-0">
									<dt className="text-xs text-muted">{t.request}</dt>
									<dd className="break-all">
										<bdi>{row.id}</bdi>
									</dd>
								</div>
								<div className="min-w-0">
									<dt className="text-xs text-muted">{sales.business}</dt>
									<dd dir="auto">{row.seller_name}</dd>
								</div>
								<div className="min-w-0">
									<dt className="text-xs text-muted">
										{authCopy[locale].buyer}
									</dt>
									<dd className="break-all">
										<bdi>{row.buyer}</bdi>
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted">{t.version}</dt>
									<dd>
										<bdi>{row.version}</bdi>
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted">
										{commerceCopy[locale].currency}
									</dt>
									<dd>
										<bdi>{row.currency}</bdi>
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted">{t.submitted}</dt>
									<dd>
										<bdi>{localTimestamp(row.created_at, locale)}</bdi>
									</dd>
								</div>
							</dl>
							<p className="text-sm text-muted">{t.noExpiry}</p>
							<SalesRelated
								locale={locale}
								seller={seller}
								links={[
									...(row.invoice
										? [{ section: "invoices" as const, id: row.invoice }]
										: []),
									...(row.order
										? [{ section: "orders" as const, id: row.order }]
										: []),
								]}
							/>
						</section>
						<section className={panel}>
							<h2 className="text-lg font-semibold">{t.original}</h2>
							<ProposalSummary
								locale={locale}
								proposal={row.proposal}
								currency={row.currency}
								presentation="seller"
							/>
						</section>
					</>
				) : (
					row && (
						<div className={panel}>
							<h2 className="font-bold">
								<bdi>{row.id}</bdi> · <span>{t[row.state]}</span>
							</h2>
							<p>
								{row.seller_name} · {row.buyer}
							</p>
							<p>
								{t.version} <bdi>{row.version}</bdi> · {t.noExpiry}
							</p>
							{row.invoice && (
								<Link
									className={action}
									href={invoiceHref(locale, context, row.invoice, seller)}
								>
									{t.invoice}
								</Link>
							)}
							{row.order && (
								<Link
									className={action}
									href={`/${locale}/account/${context}/orders/${row.order}${seller ? `?seller=${seller}` : ""}`}
								>
									{t.order}
								</Link>
							)}
						</div>
					)
				)}
				{(builder || row) &&
					ready &&
					(!isSeller || editable) &&
					!(builder && result && !result.rejected) && (
						<form
							className={isSeller ? `${panel} space-y-5` : "space-y-4"}
							onSubmit={(e) => {
								e.preventDefault();
								if (builder) void send("submit");
								else if (row?.actions.includes("resubmit"))
									void send("resubmit");
								else void send("finalize");
							}}
						>
							{isSeller && <h2 className="text-lg font-semibold">{t.final}</h2>}
							<p
								className={
									isSeller
										? "rounded-xl bg-info p-4 text-sm leading-relaxed"
										: "rounded-card bg-info p-4"
								}
							>
								{isSeller ? t.finalNotice : t.explanation}
							</p>
							<p
								className={
									isSeller ? "text-sm leading-relaxed text-muted" : undefined
								}
							>
								{t.bounds}
							</p>
							{(builder ? Object.keys(proposals) : sid ? [sid] : []).map(
								(s) => {
									const p = proposals[s];
									if (!p) return null;
									const current = terms[s],
										included = !builder || selected.includes(s);
									return (
										<section
											className={isSeller ? "min-w-0 space-y-4" : panel}
											key={s}
											data-seller={s}
										>
											<h2
												className={
													isSeller
														? "break-words text-sm font-semibold text-muted"
														: "break-words font-bold"
												}
											>
												{cart?.lines.find((l) => l.seller === s)?.seller_name ??
													row?.seller_name}{" "}
												· <bdi>{s}</bdi>
											</h2>
											{builder && (
												<label className="flex gap-2">
													<input
														type="checkbox"
														checked={included}
														disabled={blocked}
														onChange={(e) => {
															setSelected((v) =>
																e.target.checked
																	? [...v, s]
																	: v.filter((x) => x !== s),
															);
															setDirty(true);
														}}
													/>
													{t.include}
												</label>
											)}
											<fieldset
												disabled={blocked || !editable || !included}
												className="space-y-4"
											>
												<ProposalFields
													locale={locale}
													presentation={isSeller ? "seller" : undefined}
													currency={row?.currency ?? currency}
													lines={p.lines}
													labels={Object.fromEntries(
														p.lines.map((line, i) => {
															const product = productText(
																productContext(p, line.variant, i),
																locale,
																line.variant,
															);
															return [
																line.variant,
																cart?.lines.find(
																	(l) => l.variant === line.variant,
																)?.title ??
																	`${product.title}${product.source ? ` · ${commerceCopy[locale].source}: ${product.source}` : ""}`,
															];
														}),
													)}
													metadata={Object.fromEntries(
														p.lines.map((line, i) => {
															const c = cart?.lines.find(
																	(l) => l.variant === line.variant,
																),
																product = productContext(p, line.variant, i);
															return [
																line.variant,
																{
																	unit:
																		c?.unit_label ??
																		productText(product, locale, line.variant)
																			.unit,
																	increment:
																		c?.increment ??
																		String(product?.increment ?? ""),
																	minimum:
																		c?.minimum ??
																		String(product?.minimum ?? ""),
																},
															];
														}),
													)}
													limits={context === "seller"}
													prefillLimits={builder}
													change={(lines) => change(s, { ...p, lines })}
												/>
												<p className="font-bold">
													{commerceCopy[locale].estimate}:{" "}
													<bdi>
														{goodsTotal(p.lines)} {row?.currency ?? currency}
													</bdi>
												</p>
												{editable &&
													(current?.enabled ? (
														<TermsFields
															{...{ locale }}
															terms={current}
															presentation={isSeller ? "seller" : undefined}
															value={p.choice}
															change={(choice) => change(s, { ...p, choice })}
														/>
													) : (
														<p role="status">
															{isSeller
																? `${t.terms}: ${commerceCopy[locale].unavailable}`
																: t.unavailable}
														</p>
													))}
												{context === "buyer" && (
													<label className="grid gap-2">
														{t.note}
														<textarea
															aria-label={t.note}
															dir="auto"
															maxLength={1000}
															className={control}
															value={p.note}
															onChange={(e) =>
																change(s, { ...p, note: e.target.value })
															}
														/>
													</label>
												)}
											</fieldset>
											{editable &&
												(!current?.enabled || failedTerms.includes(s)) && (
													<button
														type="button"
														className={action}
														disabled={busy}
														onClick={() => {
															if (live.current) void loadTerms(s, live.current);
														}}
													>
														{t.retryTerms}
													</button>
												)}
										</section>
									);
								},
							)}
							{editable && (
								<>
									<p>{t.capsReview}</p>
									{context === "buyer" && (
										<label className="flex items-start gap-3">
											<input
												type="checkbox"
												required
												checked={ack}
												disabled={blocked}
												onChange={(e) => setAck(e.target.checked)}
											/>
											{t.ack}
										</label>
									)}
									{!builder && (
										<label className="grid gap-2">
											{t.reason}
											<textarea
												aria-label={t.reason}
												dir="auto"
												required
												minLength={3}
												maxLength={1000}
												value={reason}
												className={control}
												disabled={blocked}
												onChange={(e) => {
													setReason(e.target.value);
													setDirty(true);
												}}
											/>
										</label>
									)}
									<div className="flex flex-wrap gap-3">
										{builder && (
											<button
												type="button"
												className={action}
												disabled={blocked}
												onClick={() => void send("review")}
											>
												{t.review}
											</button>
										)}
										<button
											type="submit"
											className={action}
											disabled={
												blocked ||
												(!builder && sid ? !terms[sid]?.enabled : false)
											}
										>
											{builder
												? t.submit
												: context === "buyer"
													? t.resubmit
													: t.finalize}
										</button>
									</div>
								</>
							)}
						</form>
					)}
				{preview !== undefined && (
					<section className={panel}>
						<h2>{t.difference}</h2>
						<p>{t.finalNotice}</p>
						{preview.results?.map((r) => (
							<p key={r.seller}>
								<bdi>{r.seller}</bdi> ·{" "}
								{r.code === "ready"
									? t.ready
									: ["wholesale_minimum", "wholesale_verification"].includes(
												r.code,
											)
										? commerceCopy[locale].wholesaleHelp
										: (commerceCopy[locale][
												r.code as keyof typeof commerceCopy.en
											] ?? t.error)}
								{r.goods_total && (
									<>
										{" "}
										·{" "}
										<bdi>
											{r.goods_total} {currency}
										</bdi>
									</>
								)}
							</p>
						))}
						{builder && <p>{t.capsReview}</p>}
					</section>
				)}
				{row && (
					<>
						{!isSeller && <p>{t.returnCart}</p>}
						<div
							className={
								isSeller && otherActions.length
									? `${panel} flex flex-wrap gap-3 space-y-0!`
									: "flex flex-wrap gap-3"
							}
						>
							{isSeller && otherActions.length > 0 && (
								<h2 className="basis-full text-lg font-semibold">
									{sales.actions}
								</h2>
							)}
							{otherActions.map((a) => (
								<button
									type="button"
									key={a}
									className={action}
									disabled={blocked}
									onClick={(e) => prompt(a, e.currentTarget)}
								>
									{a === "withdraw"
										? t.withdraw
										: a === "reject"
											? t.reject
											: t.correct}
								</button>
							))}
						</div>
						<History
							{...{ locale, row, context, seller }}
							presentation={isSeller ? "seller" : undefined}
							params={search}
						/>
					</>
				)}
				{confirmation && (
					<Confirmation
						key={confirmationKey}
						returnFocus={focus.current}
						label={confirmation === "finalize" ? t.finalize : t.confirm}
						close={() => {
							if (!busy && modalToken.current === confirmationKey) {
								setConfirmation(null);
								setFinalReview(null);
							}
						}}
					>
						<p>
							{confirmation === "finalize"
								? t.finalNotice
								: confirmation === "withdraw"
									? t.withdrawConfirm
									: t.reason}
						</p>
						{confirmation === "finalize" && finalReview && (
							<FinalizationReview
								locale={locale}
								currency={finalReview.currency}
								presentation={isSeller ? "seller" : undefined}
								preview={finalReview.preview}
								reason={String(finalReview.packet.body.reason)}
							/>
						)}
						{confirmation !== "finalize" && (
							<label className="grid gap-2">
								{t.reason}
								<textarea
									aria-label={t.reason}
									dir="auto"
									className={control}
									value={reason}
									minLength={3}
									maxLength={1000}
									onChange={(e) => setReason(e.target.value)}
								/>
							</label>
						)}
						<button
							type="button"
							className={action}
							disabled={
								busy ||
								reason.trim().length < 3 ||
								(confirmation === "finalize" && !finalReview)
							}
							onClick={() => void send(confirmation, true)}
						>
							{confirmation === "finalize" ? t.finalize : t.confirm}
						</button>{" "}
						<button
							type="button"
							className={action}
							disabled={busy}
							onClick={() => {
								setConfirmation(null);
								setFinalReview(null);
								focus.current?.focus();
							}}
						>
							{t.cancel}
						</button>
					</Confirmation>
				)}
				{!builder && row && !row.actions.length && <p>{t.readonly}</p>}
				{builder && cart && !Object.keys(proposals).length && <p>{t.empty}</p>}
				<div className="space-y-2 rounded-card bg-info p-4 text-sm">
					<p>{t.noExpiry}</p>
					<p>{commerceCopy[locale].delivery}</p>
					<p>{commerceCopy[locale].unreserved}</p>
				</div>
				<button
					type="button"
					className={action}
					disabled={blocked}
					onClick={() =>
						guard.choose(() => {
							setDirty(false);
							setResult(null);
							setReload((x) => x + 1);
						})
					}
				>
					{t.reload}
				</button>
			</section>
		</SalesFrame>
	);
}
function ResultView({
	locale,
	context,
	result,
	seller,
	params,
	onResume,
	disabled,
}: {
	locale: Locale;
	context: Context;
	result: Result;
	seller: string;
	params: QueryReader;
	onResume?: () => void;
	disabled?: boolean;
}) {
	const t = negotiationCopy[locale],
		action = context === "seller" ? salesAction : buyerAction,
		panel = context === "seller" ? salesPanel : buyerPanel;
	return (
		<section className={panel} role="status">
			{result.rejected ? (
				<p>{t.reload}</p>
			) : (
				<>
					{result.state && (
						<p>
							{result.state in t ? t[result.state as keyof typeof t] : t.error}
						</p>
					)}
					{result.outcomes?.map((o) => (
						<div key={o.seller}>
							<p>
								<bdi>{o.seller}</bdi> ·{" "}
								{o.state === "submitted"
									? t.submitted
									: o.state === "pending"
										? t.pending
										: t.error}
								{o.code && (
									<>
										{" "}
										·{" "}
										{commerceCopy[locale][
											o.code as keyof typeof commerceCopy.en
										] ?? t.error}
									</>
								)}
							</p>
							{o.request && (
								<Link
									className={action}
									href={
										context === "seller"
											? salesHref(
													locale,
													"negotiations",
													o.seller || seller,
													o.request,
													params,
												)
											: requestHref(locale, context, o.request)
									}
								>
									{t.request}
								</Link>
							)}
						</div>
					))}
					{context === "seller" && seller && (
						<SalesRelated
							locale={locale}
							seller={seller}
							links={[
								...(result.invoice
									? [{ section: "invoices" as const, id: result.invoice }]
									: []),
								...(result.order
									? [{ section: "orders" as const, id: result.order }]
									: []),
							]}
						/>
					)}
					{result.pending && result.id && (
						<button
							type="button"
							className={action}
							disabled={disabled}
							onClick={onResume}
						>
							{commerceCopy[locale].resume}
						</button>
					)}
				</>
			)}
		</section>
	);
}
