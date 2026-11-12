"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
	FileText,
	MoreHorizontal,
	Receipt as ReceiptIcon,
	RefreshCw,
	Wallet,
} from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { Icon } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { uuidPattern } from "../../../lib/routes/account-routes";
import { SessionEntry } from "../../orders/components/session-entry";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { invoiceHref } from "../../orders/api";
import {
	useCommunicationSession,
	accessLost,
	useOnlineState,
} from "../../messaging/hooks";
import { localTimestamp } from "../../messaging/api";
import { orderListCopy } from "../../orders/list-copy";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import {
	SalesFrame,
	SalesHeader,
	salesFilterPanel,
	salesTableCard,
	SalesBusinessSelect,
	SalesEmpty,
	SalesPagination,
	SalesRelated,
	salesAction,
	salesControl,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { paymentCopy, paymentState, paymentRole } from "../copy";
import { sellerPaymentCopy } from "../seller-copy";
import {
	payment,
	paymentHref,
	retainPayment,
	pendingPayment,
	settlePayment,
	paymentReference,
	type Detail,
	type Payment,
	type Profile,
	type Selection,
	type Intent,
	type Outcome,
	type Receipt,
	type Claim,
} from "../api";
import { ActionReview, type ReviewedAction } from "./action-review";
import { FactsForm } from "./facts-form";
import { SelectionForm } from "./selection-form";
import { PaymentEvidence } from "./evidence";
import toast from "react-hot-toast";

type Tab = "overview" | "claims" | "activity";

export function SellerPayments({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	const session = useCommunicationSession("seller"),
		q = useSearchParams();
	if (session.loading)
		return <p role="status">{paymentCopy[locale].loading}</p>;
	if (!session.session)
		return (
			<SessionEntry locale={locale} context="seller" error={session.error} />
		);
	const seller = q.get("seller") ?? "",
		page = Number(q.get("page") ?? 1),
		state = q.get("state") ?? "",
		search = q.get("q") ?? "",
		attempt = q.get("payment_attempt");
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt && !uuidPattern.test(attempt)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000
	)
		return <p role="alert">{paymentCopy[locale].error}</p>;
	const scope = `${session.session.identity.id}:${session.session.accounts[0].id}:seller:${seller}:${id ?? "list"}`;
	return (
		<Workspace
			key={`${scope}:${locale}:${page}:${state}:${search}`}
			{...{ locale, id, seller, page, state, search, attempt, scope }}
		/>
	);
}

function Workspace({
	locale,
	id,
	seller,
	page,
	state,
	search,
	attempt,
	scope,
}: {
	locale: Locale;
	id?: string;
	seller: string;
	page: number;
	state: string;
	search: string;
	attempt: string | null;
	scope: string;
}) {
	const t = paymentCopy[locale],
		s = sellerPaymentCopy[locale],
		params = useSearchParams(),
		router = useRouter(),
		online = useOnlineState(),
		[list, setList] = useState<{ count: number; results: Payment[] } | null>(
			null,
		),
		[row, setRow] = useState<Detail | null>(null),
		[profiles, setProfiles] = useState<Profile[] | null>(null),
		[selection, setSelection] = useState<Selection | null>(null),
		[selectionPage, setSelectionPage] = useState(1),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[busy, setBusy] = useState(false),
		[dirty, setDirty] = useState(false),
		[intent, setIntent] = useState<Intent | undefined>(() =>
			pendingPayment(scope),
		),
		[reference, setReference] = useState(attempt),
		[modal, setModal] = useState<ReviewedAction | null>(null),
		[evidence, setEvidence] = useState<string[]>([]),
		[correction, setCorrection] = useState<Receipt | undefined>(),
		[replacement, setReplacement] = useState<Claim | undefined>(),
		[reason, setReason] = useState(""),
		[due, setDue] = useState(""),
		[formKey, setFormKey] = useState(0),
		[notice, setNotice] = useState(""),
		[tab, setTab] = useState<Tab>("overview"),
		[reload, setReload] = useState(0);
	const live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		opener = useRef<HTMLElement | null>(null);
	const guard = useCommerceGuard(locale, dirty || !!intent || !!reference),
		blocked = busy || !!intent || !!reference || denied;
	const fail = useCallback(
		(e: unknown, mine: object) => {
			if (live.current !== mine) return;
			if (accessLost(e)) {
				live.current = null;
				owned.current = null;
				setBusy(false);
				setDenied(true);
				setRow(null);
				setList(null);
				setSelection(null);
				settlePayment(scope);
				setIntent(undefined);
				setModal(null);
			}
			setError(true);
			toast.error(s.failed);
		},
		[scope, s.failed],
	);
	useEffect(() => {
		void reload;
		const mine = {};
		live.current = mine;
		const controller = new AbortController();
		void (async () => {
			const p = await payment<{ results: Profile[]; count: number }>(
				"seller",
				"profiles/",
				undefined,
				controller.signal,
			);
			if (live.current !== mine || controller.signal.aborted) return;
			setProfiles(p.results);
			if (!seller && !id) {
				if (p.results[0]) {
					const href = salesHref(locale, "payments", p.results[0].id);
					router.replace(
						attempt
							? `${href}${href.includes("?") ? "&" : "?"}payment_attempt=${attempt}`
							: href,
					);
				}
				return;
			}
			if (id) {
				const value = await payment<Detail>(
					"seller",
					`orders/${id}/?page=${page}${seller ? `&seller=${seller}` : ""}`,
					undefined,
					controller.signal,
				);
				if (live.current !== mine || controller.signal.aborted) return;
				if (!seller) {
					const href = salesHref(locale, "payments", value.seller, id);
					router.replace(
						attempt
							? `${href}${href.includes("?") ? "&" : "?"}payment_attempt=${attempt}`
							: href,
					);
					return;
				}
				setRow(value);
			} else {
				const query = new URLSearchParams({
					page: String(page),
					state,
					q: search,
				});
				if (seller) query.set("seller", seller);
				const value = await payment<{ count: number; results: Payment[] }>(
					"seller",
					`orders/?${query}`,
					undefined,
					controller.signal,
				);
				if (live.current === mine && !controller.signal.aborted) setList(value);
			}
			if (live.current === mine && !controller.signal.aborted) setError(false);
		})().catch((e) => {
			if (!controller.signal.aborted) fail(e, mine);
		});
		return () => {
			live.current = null;
			owned.current = null;
			controller.abort();
		};
		// scope identity + request + filters own this load.
	}, [reload, id, seller, locale, page, state, search, attempt, router, fail]);
	useEffect(() => {
		if (!id || !row?.capabilities.selection || row.selection?.allocation)
			return;
		const mine = live.current,
			c = new AbortController();
		void payment<Selection>(
			"seller",
			`orders/${id}/stock-selection/?page=${selectionPage}`,
			undefined,
			c.signal,
		)
			.then((v) => {
				if (live.current === mine && !c.signal.aborted) setSelection(v);
			})
			.catch((e) => {
				if (mine && !c.signal.aborted) fail(e, mine);
			});
		return () => c.abort();
	}, [
		id,
		row?.capabilities.selection,
		row?.selection?.allocation,
		selectionPage,
		fail,
	]);
	function review(path: string, body: Record<string, unknown>, label: string) {
		if (blocked || !row) return;
		opener.current = document.activeElement as HTMLElement;
		setModal({
			row: structuredClone(row),
			label,
			packet: {
				key: crypto.randomUUID(),
				path,
				body: { ...body, version: row.version },
				upload: false,
			},
		});
	}
	function finished(outcome: Record<string, unknown>, current?: Detail) {
		settlePayment(scope);
		setIntent(undefined);
		setReference(null);
		paymentReference(null);
		if (current) setRow(current);
		setEvidence([]);
		setCorrection(undefined);
		setReplacement(undefined);
		setReason("");
		setDue("");
		setDirty(false);
		setFormKey((v) => v + 1);
		setNotice(outcome.duplicate_warning ? t.duplicate : "");
		toast.success(s.recorded);
	}
	async function send(packet: Intent) {
		if (owned.current || !live.current) return;
		const mine = live.current,
			token = {};
		owned.current = token;
		const retained = retainPayment(scope, packet);
		setIntent(retained);
		setReference(retained.key);
		paymentReference(retained.key);
		setBusy(true);
		setError(false);
		setModal(null);
		try {
			const body =
				retained.body instanceof FormData
					? retained.body
					: { ...retained.body, command_id: retained.key };
			if (retained.upload) {
				const result = await payment<{ id: string }>(
					"seller",
					retained.path,
					body,
				);
				if (live.current === mine && owned.current === token) {
					settlePayment(scope);
					setIntent(undefined);
					setReference(null);
					paymentReference(null);
					setEvidence((e) => [...new Set([...e, result.id])].slice(0, 3));
				}
			} else {
				const result = await payment<Outcome>("seller", retained.path, body);
				if (live.current === mine && owned.current === token)
					finished(result.outcome, result.current);
			}
		} catch (e) {
			fail(e, mine);
		} finally {
			if (live.current === mine && owned.current === token) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function reconcile() {
		if (!id || owned.current) return;
		const key = intent?.key ?? reference,
			mine = live.current;
		if (!key || !mine) return;
		const token = {};
		owned.current = token;
		setBusy(true);
		try {
			const result = await payment<Outcome>(
				"seller",
				`orders/${id}/commands/${key}/reconcile/`,
				{},
			);
			if (live.current === mine && owned.current === token)
				finished(result.outcome, result.current);
		} catch (e) {
			fail(e, mine);
		} finally {
			if (live.current === mine && owned.current === token) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	function upload(file: File) {
		if (!id || blocked) return;
		const key = crypto.randomUUID(),
			body = new FormData();
		body.append("command_id", key);
		body.append("file", file);
		void send({ key, path: `orders/${id}/uploads/`, body, upload: true });
	}
	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(""), 6000);
		return () => clearTimeout(timer);
	}, [notice]);
	const back = salesHref(locale, "orders", seller, id);
	const goto = (changes: Record<string, string>) =>
		guard.choose(() =>
			router.push(
				salesHref(locale, "payments", seller, undefined, params, changes),
			),
		);
	if (denied) return <p role="alert">{t.noAccess}</p>;
	const business =
		profiles && profiles.length > 0 ? (
			<SalesBusinessSelect
				locale={locale}
				value={seller}
				profiles={profiles}
				onChange={(chosen) =>
					router.push(salesHref(locale, "payments", chosen))
				}
			/>
		) : undefined;
	return (
		<SalesFrame seller>
			{!id ? (
				<SalesHeader
					locale={locale}
					section="payments"
					description={sellerSalesCopy[locale].paymentsDescription}
					seller={seller}
					business={business}
				/>
			) : null}
			{!online && <p role="status">{t.offline}</p>}
			{error && (
				<p role="alert" className="text-warning">
					{s.failed}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{(intent || reference) && (
				<section className={salesPanel} role="status">
					<p>{t.unresolved}</p>
					<div className="flex flex-wrap gap-3">
						{intent && (
							<button
								type="button"
								className={salesAction}
								disabled={busy}
								onClick={() => void send(intent)}
							>
								{t.retry}
							</button>
						)}
						<button
							type="button"
							className={salesAction}
							disabled={busy}
							data-payment-reconcile
							onClick={() => void reconcile()}
						>
							{t.reconcile}
						</button>
					</div>
				</section>
			)}
			{!id ? (
				<PaymentList
					locale={locale}
					seller={seller}
					page={page}
					state={state}
					search={search}
					list={list}
					error={error}
					profileCount={profiles?.length ?? -1}
					onReload={() => setReload((v) => v + 1)}
					goto={goto}
				/>
			) : !row ? (
				!error && <p role="status">{t.loading}</p>
			) : (
				<>
					<header className="min-w-0 space-y-3">
						<Link
							href={back}
							className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action"
						>
							<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
							{s.backToOrder}
						</Link>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 space-y-1.5">
								<h1 className="text-xl font-bold tracking-tight" tabIndex={-1}>
									{t.title} · <bdi>{row.number}</bdi>
								</h1>
								<p className="m-0 text-sm text-muted">
									{paymentRole(locale, "buyer")}:{" "}
									<span dir="auto">{row.buyer_name}</span>
								</p>
								<div className="flex flex-wrap items-center gap-2 pt-1">
									<StatusPill locale={locale} row={row} />
								</div>
							</div>
							<SalesRelated
								locale={locale}
								seller={seller}
								links={[
									{ section: "orders", id: row.id },
									{ section: "invoices", id: row.invoice },
									{ section: "fulfilment", id: row.id },
								]}
							/>
						</div>
					</header>
					<MoneyCards locale={locale} row={row} />
					<PrimaryAction
						locale={locale}
						row={row}
						seller={seller}
						onOpenClaims={() => setTab("claims")}
					/>
					<Tabs locale={locale} tab={tab} onChange={setTab} />
					{tab === "overview" && (
						<Overview
							locale={locale}
							row={row}
							selection={selection}
							selectionPage={selectionPage}
							onSelectionPage={setSelectionPage}
							review={review}
							blocked={blocked}
							due={due}
							setDue={setDue}
							reason={reason}
							setReason={setReason}
							setDirty={setDirty}
							setError={setError}
						/>
					)}
					{tab === "claims" && (
						<ClaimsReceipts
							locale={locale}
							row={row}
							blocked={blocked}
							evidence={evidence}
							onEvidence={upload}
							onRemove={(eid) => setEvidence((e) => e.filter((x) => x !== eid))}
							correction={correction}
							replacement={replacement}
							formKey={formKey}
							reason={reason}
							setReason={setReason}
							setDirty={setDirty}
							review={review}
							startCorrection={(r) => {
								setCorrection(r);
								setReplacement(undefined);
								setEvidence([]);
								setFormKey((v) => v + 1);
							}}
							cancelDraft={() => {
								setCorrection(undefined);
								setReplacement(undefined);
								setEvidence([]);
								setDirty(false);
							}}
						/>
					)}
					{tab === "activity" && (
						<Activity
							locale={locale}
							row={row}
							page={page}
							onPage={(next) =>
								guard.choose(() =>
									router.push(paymentHref(locale, "seller", id, seller, next)),
								)
							}
						/>
					)}
				</>
			)}
			{modal && (
				<ActionReview
					{...{ locale, context: "seller" as const, selection, busy }}
					review={modal}
					opener={opener.current}
					cancel={() => setModal(null)}
					confirm={() => void send(modal.packet)}
				/>
			)}
			{guard.feedback}
		</SalesFrame>
	);
}

function StatusPill({ locale, row }: { locale: Locale; row: Payment }) {
	const t = paymentCopy[locale],
		s = sellerPaymentCopy[locale];
	return (
		<>
			<Badge
				variant="secondary"
				className={cn(
					"border-0",
					row.financial === "paid"
						? "bg-success-surface text-success"
						: row.overdue
							? "bg-warning-surface text-warning"
							: "bg-info text-action",
				)}
			>
				{paymentState(locale, row.financial)}
			</Badge>
			{row.overdue && (
				<Badge
					variant="secondary"
					className="border-0 bg-warning-surface text-warning"
				>
					{t.overdue}
				</Badge>
			)}
			{row.pending_claims > 0 && (
				<Badge
					variant="secondary"
					className="border-0 bg-warning-surface text-warning"
				>
					{s.reviewClaim}
				</Badge>
			)}
			{row.review_pending > 0 && (
				<Badge variant="secondary" className="border-0 bg-page text-muted">
					{t.review}
				</Badge>
			)}
		</>
	);
}

function PaymentList({
	locale,
	seller,
	page,
	state,
	search,
	list,
	error,
	profileCount,
	onReload,
	goto,
}: {
	locale: Locale;
	seller: string;
	page: number;
	state: string;
	search: string;
	list: { count: number; results: Payment[] } | null;
	error: boolean;
	profileCount: number;
	onReload: () => void;
	goto: (changes: Record<string, string>) => void;
}) {
	const t = paymentCopy[locale],
		s = sellerPaymentCopy[locale],
		sales = sellerSalesCopy[locale],
		nf = new Intl.NumberFormat(locale),
		detailHref = (row: Payment) =>
			salesHref(locale, "payments", seller, row.id, undefined, {
				page: String(page),
				state,
				q: search,
			});
	if (profileCount === 0) return <SalesEmpty locale={locale} noBusiness />;
	return (
		<>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					const data = new FormData(e.currentTarget);
					goto({
						page: "1",
						q: String(data.get("q") ?? ""),
						state: String(data.get("state") ?? ""),
					});
				}}
				className={cn(
					salesFilterPanel,
					"grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)_auto]",
				)}
			>
				<label className="grid min-w-0 gap-2">
					{s.search}
					<input
						name="q"
						className={salesControl}
						maxLength={100}
						dir="auto"
						defaultValue={search}
					/>
				</label>
				<label className="grid min-w-0 gap-2">
					{s.status}
					<select name="state" className={salesControl} defaultValue={state}>
						<option value="">{t.all}</option>
						{(
							["unpaid", "partial", "paid", "overpaid", "overdue"] as const
						).map((v) => (
							<option key={v} value={v}>
								{paymentState(locale, v)}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap gap-2">
					<button type="submit" className={salesAction}>
						{t.refresh}
					</button>
					{(search || state || page > 1) && (
						<Link
							className={salesAction}
							href={salesHref(locale, "payments", seller)}
						>
							{sales.clear}
						</Link>
					)}
				</div>
			</form>
			{error ? (
				<p role="alert" className={salesPanel}>
					{s.failed}
				</p>
			) : !list ? (
				<p role="status" className={salesPanel}>
					{t.loading}
				</p>
			) : !list.results.length ? (
				<SalesEmpty locale={locale} filtered={!!search || !!state || page > 1}>
					<p className="text-sm text-muted">{s.emptyFiltered}</p>
				</SalesEmpty>
			) : (
				<Card className={salesTableCard}>
					<div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
						<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
							{t.title}
							<Badge
								variant="secondary"
								className="rounded-full border-0 bg-page text-muted"
							>
								{nf.format(list.count)}
							</Badge>
						</h2>
						<Button
							variant="outline"
							size="sm"
							className="h-9 rounded-lg text-xs"
							onClick={onReload}
						>
							<RefreshCw className="size-3.5" aria-hidden="true" />
							{t.refresh}
						</Button>
					</div>
					<section
						aria-label={t.title}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: named overflow region
						tabIndex={0}
						className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-action lg:block"
					>
						<table className="w-full min-w-[62rem] border-collapse text-start">
							<caption className="sr-only">{t.title}</caption>
							<thead>
								<tr className="bg-transparent">
									{[
										sales.invoices,
										orderListCopy[locale].customer,
										s.status,
										t.total,
										t.confirmed,
										t.remaining,
										t.method,
										t.effectiveDue,
										"",
									].map((label, i) => (
										<th
											key={label}
											scope="col"
											className={cn(
												"border-0 border-b border-solid border-border px-4 py-3 text-start text-xs font-medium text-muted",
												i === 8 && "text-end",
											)}
										>
											{i === 8 ? (
												<span className="sr-only">{label}</span>
											) : (
												label
											)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{list.results.map((row) => (
									<tr
										key={row.id}
										className="border-0 border-b border-solid border-border last:border-b-0 hover:bg-transparent"
									>
										<td className="px-4 py-4 align-top">
											<Link
												href={detailHref(row)}
												className="text-sm font-semibold text-action no-underline"
											>
												<bdi>{row.number}</bdi>
											</Link>
										</td>
										<td className="px-4 py-4 align-top">
											<span className="text-sm font-medium" dir="auto">
												{row.buyer_name}
											</span>
										</td>
										<td className="px-4 py-4 align-top">
											<div className="flex flex-col items-start gap-1">
												<StatusPill locale={locale} row={row} />
											</div>
										</td>
										<td className="px-4 py-4 align-top text-sm tabular-nums">
											<bdi>
												{row.goods_total} {row.currency}
											</bdi>
										</td>
										<td className="px-4 py-4 align-top text-sm tabular-nums">
											<bdi>
												{row.confirmed_total} {row.currency}
											</bdi>
										</td>
										<td className="px-4 py-4 align-top text-sm font-semibold tabular-nums">
											<bdi>
												{row.remaining} {row.currency}
											</bdi>
										</td>
										<td className="px-4 py-4 align-top text-sm">
											{paymentState(locale, row.payment_method)}
										</td>
										<td className="px-4 py-4 align-top text-xs text-muted">
											<bdi>
												{row.effective_due_at
													? localTimestamp(row.effective_due_at, locale)
													: "—"}
											</bdi>
										</td>
										<td className="px-4 py-3 text-end align-top">
											<RowMenu locale={locale} seller={seller} row={row} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
						{list.results.map((row) => (
							<li key={row.id} className="space-y-3 p-4">
								<div className="flex items-start justify-between gap-3">
									<div className="space-y-1">
										<Link
											href={detailHref(row)}
											className="text-sm font-semibold text-action no-underline"
										>
											<bdi>{row.number}</bdi>
										</Link>
										<p className="m-0 break-words text-sm" dir="auto">
											{row.buyer_name}
										</p>
									</div>
									<RowMenu locale={locale} seller={seller} row={row} />
								</div>
								<div className="flex flex-wrap gap-2">
									<StatusPill locale={locale} row={row} />
								</div>
								<dl className="m-0 grid grid-cols-3 gap-2 text-sm">
									<div>
										<dt className="text-xs text-muted">{t.total}</dt>
										<dd className="m-0 tabular-nums">
											<bdi>
												{row.goods_total} {row.currency}
											</bdi>
										</dd>
									</div>
									<div>
										<dt className="text-xs text-muted">{t.confirmed}</dt>
										<dd className="m-0 tabular-nums">
											<bdi>{row.confirmed_total}</bdi>
										</dd>
									</div>
									<div>
										<dt className="text-xs text-muted">{t.remaining}</dt>
										<dd className="m-0 font-semibold tabular-nums">
											<bdi>{row.remaining}</bdi>
										</dd>
									</div>
								</dl>
							</li>
						))}
					</ul>
					<SalesPagination
						locale={locale}
						page={page}
						count={list.count}
						onPage={(next) => goto({ page: String(next) })}
					/>
				</Card>
			)}
		</>
	);
}

function RowMenu({
	locale,
	seller,
	row,
}: {
	locale: Locale;
	seller: string;
	row: Payment;
}) {
	const s = sellerPaymentCopy[locale],
		t = paymentCopy[locale];
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={sellerSalesCopy[locale].actions}
					className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
				>
					<MoreHorizontal className="size-5" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className="w-56 rounded-xl p-1.5"
			>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={salesHref(locale, "payments", seller, row.id)}>
						<Wallet aria-hidden="true" />
						{t.title}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={salesHref(locale, "invoices", seller, row.invoice)}>
						<FileText aria-hidden="true" />
						{s.openInvoice}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={salesHref(locale, "orders", seller, row.id)}>
						<ReceiptIcon aria-hidden="true" />
						{s.backToOrder}
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function MoneyCards({ locale, row }: { locale: Locale; row: Detail }) {
	const t = paymentCopy[locale],
		s = sellerPaymentCopy[locale];
	const cards = [
		[t.total, row.goods_total],
		[t.confirmed, row.confirmed_total],
		[t.remaining, row.remaining],
	] as const;
	return (
		<section className={salesPanel}>
			<dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{cards.map(([label, value], i) => (
					<div
						key={label}
						className="min-w-0 rounded-xl border border-border bg-page p-3"
					>
						<dt className="text-xs text-muted">{label}</dt>
						<dd
							className={cn(
								"mt-1 break-all tabular-nums",
								i === 2 ? "text-xl font-bold" : "text-lg font-semibold",
							)}
						>
							<bdi>
								{value} {row.currency}
							</bdi>
						</dd>
					</div>
				))}
			</dl>
			{(row.overpayment !== "0.00" || row.refund_due !== "0.00") && (
				<dl className="grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
					{row.overpayment !== "0.00" && (
						<div>
							<dt className="text-xs text-muted">{t.overpayment}</dt>
							<dd className="m-0 font-medium tabular-nums">
								<bdi>
									{row.overpayment} {row.currency}
								</bdi>
							</dd>
						</div>
					)}
					{row.refund_due !== "0.00" && (
						<div>
							<dt className="text-xs text-muted">{s.refundDue}</dt>
							<dd className="m-0 font-medium tabular-nums">
								<bdi>
									{row.refund_due} {row.currency}
								</bdi>
							</dd>
						</div>
					)}
				</dl>
			)}
			<p className="m-0 text-xs text-muted">{s.deliverySeparate}</p>
		</section>
	);
}

function PrimaryAction({
	locale,
	row,
	seller,
	onOpenClaims,
}: {
	locale: Locale;
	row: Detail;
	seller: string;
	onOpenClaims: () => void;
}) {
	const t = paymentCopy[locale],
		s = sellerPaymentCopy[locale],
		pendingClaim = row.claims.find((c) => c.state === "pending");
	let action: { label: string; onClick?: () => void; href?: string } | null =
		null;
	if (row.capabilities.receipt && pendingClaim)
		action = { label: s.reviewClaim, onClick: onOpenClaims };
	else if (row.capabilities.receipt && row.remaining !== "0.00")
		action = { label: s.recordPayment, onClick: onOpenClaims };
	else if (row.financial === "paid")
		action = {
			label: s.openInvoice,
			href: invoiceHref(locale, "seller", row.invoice, seller),
		};
	return (
		<section className={cn(salesPanel, "space-y-2")}>
			<p className="m-0 text-sm font-semibold">{s.nextAction}</p>
			{action ? (
				action.href ? (
					<Button asChild className="rounded-xl">
						<Link href={action.href}>{action.label}</Link>
					</Button>
				) : (
					<Button className="rounded-xl" onClick={action.onClick}>
						<Wallet className="size-4" aria-hidden="true" />
						{action.label}
					</Button>
				)
			) : (
				<p className="m-0 text-sm text-muted">{t.noAutomatic}</p>
			)}
			<p className="m-0 text-xs text-muted">{s.recordHelp}</p>
		</section>
	);
}

function Tabs({
	locale,
	tab,
	onChange,
}: {
	locale: Locale;
	tab: Tab;
	onChange: (t: Tab) => void;
}) {
	const s = sellerPaymentCopy[locale];
	const tabs: [Tab, string][] = [
		["overview", s.overview],
		["claims", s.claimsReceipts],
		["activity", s.activity],
	];
	return (
		<div
			role="tablist"
			aria-label={s.overview}
			className="flex flex-wrap gap-1 border-0 border-b border-solid border-border"
		>
			{tabs.map(([id, label]) => (
				<button
					key={id}
					type="button"
					role="tab"
					aria-selected={tab === id}
					tabIndex={tab === id ? 0 : -1}
					onClick={() => onChange(id)}
					className={cn(
						"-mb-px inline-flex min-h-11 items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold transition-colors motion-reduce:transition-none",
						tab === id
							? "border-border bg-surface text-action"
							: "border-transparent bg-transparent text-muted hover:text-foreground",
					)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function Overview({
	locale,
	row,
	selection,
	onSelectionPage,
	review,
	blocked,
	due,
	setDue,
	reason,
	setReason,
	setDirty,
	setError,
}: {
	locale: Locale;
	row: Detail;
	selection: Selection | null;
	selectionPage: number;
	onSelectionPage: (p: number) => void;
	review: (path: string, body: Record<string, unknown>, label: string) => void;
	blocked: boolean;
	due: string;
	setDue: (v: string) => void;
	reason: string;
	setReason: (v: string) => void;
	setDirty: (v: boolean) => void;
	setError: (v: boolean) => void;
}) {
	const t = paymentCopy[locale];
	return (
		<section className={salesPanel}>
			<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
				<div>
					<dt className="text-xs text-muted">{t.method}</dt>
					<dd className="m-0 font-medium">
						{paymentState(locale, row.payment_method)}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">{t.allocation}</dt>
					<dd className="m-0 font-medium">
						{paymentState(locale, row.allocation)}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">{t.originalDue}</dt>
					<dd className="m-0">
						<bdi>
							{row.original_due_at
								? localTimestamp(row.original_due_at, locale)
								: "—"}
						</bdi>
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">{t.effectiveDue}</dt>
					<dd className="m-0">
						<bdi>
							{row.effective_due_at
								? localTimestamp(row.effective_due_at, locale)
								: "—"}
						</bdi>{" "}
						· <bdi>v{row.deadline_generation}</bdi>
					</dd>
				</div>
			</dl>
			{row.capabilities.selection &&
				selection &&
				!row.selection?.allocation && (
					<details className="rounded-xl border border-solid border-border p-4">
						<summary className="cursor-pointer text-sm font-medium">
							{t.selection}
						</summary>
						<div className="mt-4">
							<SelectionForm
								{...{
									locale,
									row,
									selection,
									disabled: blocked,
									onReview: review,
									onPage: onSelectionPage,
								}}
								onDirty={() => setDirty(true)}
							/>
						</div>
					</details>
				)}
			{row.capabilities.extension && (
				<details className="rounded-xl border border-solid border-border p-4">
					<summary className="cursor-pointer text-sm font-medium">
						{t.extend}
					</summary>
					<form
						className="mt-4 space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							const parsed = Date.parse(due);
							if (
								!Number.isFinite(parsed) ||
								parsed <= Date.parse(row.effective_due_at ?? "") ||
								reason.trim().length < 3
							) {
								setError(true);
								return;
							}
							review(
								`orders/${row.id}/extensions/`,
								{
									deadline_generation: row.deadline_generation,
									due_at: new Date(parsed).toISOString(),
									reason: reason.trim(),
								},
								t.extend,
							);
						}}
					>
						<fieldset disabled={blocked} className="grid gap-3 sm:grid-cols-2">
							<label className="grid gap-1.5">
								{t.laterDue}
								<input
									type="datetime-local"
									required
									className={salesControl}
									value={due}
									onChange={(e) => {
										setDue(e.target.value);
										setDirty(true);
									}}
								/>
							</label>
							<label className="grid gap-1.5">
								{t.reason}
								<textarea
									required
									minLength={3}
									maxLength={1000}
									className={salesControl}
									value={reason}
									onChange={(e) => {
										setReason(e.target.value);
										setDirty(true);
									}}
								/>
							</label>
							<button
								type="submit"
								className={cn(salesAction, "justify-self-start sm:col-span-2")}
							>
								{t.exact}
							</button>
						</fieldset>
					</form>
				</details>
			)}
		</section>
	);
}

function ClaimsReceipts({
	locale,
	row,
	blocked,
	evidence,
	onEvidence,
	onRemove,
	correction,
	replacement,
	formKey,
	reason,
	setReason,
	setDirty,
	review,
	startCorrection,
	cancelDraft,
}: {
	locale: Locale;
	row: Detail;
	blocked: boolean;
	evidence: string[];
	onEvidence: (file: File) => void;
	onRemove: (id: string) => void;
	correction: Receipt | undefined;
	replacement: Claim | undefined;
	formKey: number;
	reason: string;
	setReason: (v: string) => void;
	setDirty: (v: boolean) => void;
	review: (path: string, body: Record<string, unknown>, label: string) => void;
	startCorrection: (r: Receipt) => void;
	cancelDraft: () => void;
}) {
	const t = paymentCopy[locale],
		s = sellerPaymentCopy[locale];
	return (
		<div className="space-y-5">
			{(row.capabilities.receipt || row.capabilities.claim) && (
				<section className={salesPanel}>
					<FactsForm
						key={`${formKey}:${correction?.id ?? replacement?.id ?? "new"}`}
						{...{
							locale,
							row,
							disabled: blocked,
							evidence,
							onEvidence,
							onReview: review,
							onDirty: () => setDirty(true),
						}}
						receipt={correction}
						prior={replacement}
						context="seller"
						onRemove={onRemove}
					/>
					{(correction || replacement) && (
						<button
							type="button"
							className={salesAction}
							disabled={blocked}
							onClick={cancelDraft}
						>
							{t.cancel}
						</button>
					)}
				</section>
			)}
			{row.capabilities.details && (
				<>
					<section className={salesPanel}>
						<h3 className="text-sm font-semibold">{t.claims}</h3>
						{row.claims.length === 0 && (
							<p className="text-sm text-muted">{s.emptyHelp}</p>
						)}
						{row.claims.map((c) => (
							<article
								key={c.id}
								className="space-y-2 rounded-xl border border-border p-3 text-sm"
							>
								<p className="m-0 flex flex-wrap items-center gap-2 font-medium">
									<bdi>
										{c.amount} {c.currency}
									</bdi>
									<Badge
										variant="secondary"
										className={cn(
											"border-0",
											c.state === "pending"
												? "bg-warning-surface text-warning"
												: c.state === "confirmed"
													? "bg-success-surface text-success"
													: "bg-page text-muted",
										)}
									>
										{paymentState(locale, c.state)}
									</Badge>
									{paymentRole(locale, "buyer")}
								</p>
								<p className="m-0 text-muted">
									<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
								</p>
								<p className="m-0 whitespace-pre-wrap break-words">
									{c.description}
								</p>
								{row.capabilities.evidence && (
									<div className="flex flex-wrap gap-2">
										{c.evidence.map((e) => (
											<PaymentEvidence
												key={e}
												id={e}
												{...{ locale, context: "seller" as const }}
											/>
										))}
									</div>
								)}
								{c.state === "pending" && (
									<div className="space-y-2">
										<p className="m-0 text-xs text-muted">{s.confirmNote}</p>
										<label className="grid gap-1.5">
											{t.reason}
											<textarea
												className={salesControl}
												maxLength={1000}
												disabled={blocked}
												value={reason}
												onChange={(e) => {
													setReason(e.target.value);
													setDirty(true);
												}}
											/>
										</label>
										<div className="flex flex-wrap gap-2">
											{(row.capabilities.receipt
												? ["confirm", "reject"]
												: ["withdraw"]
											).map((a) => (
												<button
													key={a}
													type="button"
													className={salesAction}
													disabled={blocked || reason.trim().length < 3}
													onClick={() =>
														review(
															`claims/${c.id}/${a}/`,
															{
																claim_version: c.version,
																reason: reason.trim(),
															},
															a === "confirm"
																? t.confirmClaim
																: a === "reject"
																	? t.rejectClaim
																	: t.withdrawClaim,
														)
													}
												>
													{a === "confirm"
														? t.confirmClaim
														: a === "reject"
															? t.rejectClaim
															: t.withdrawClaim}
												</button>
											))}
										</div>
									</div>
								)}
							</article>
						))}
					</section>
					<section className={salesPanel}>
						<h3 className="text-sm font-semibold">{t.receipts}</h3>
						{row.receipts.map((r) => (
							<article
								key={r.id}
								className="space-y-2 rounded-xl border border-border p-3 text-sm"
							>
								<p className="m-0">
									{t.originalAmount}:{" "}
									<bdi>
										{r.original_amount} {r.currency}
									</bdi>{" "}
									· {t.effectiveAmount}:{" "}
									<bdi>
										{r.amount} {r.currency}
									</bdi>{" "}
									· v{r.version}
								</p>
								<p className="m-0 text-muted">
									{t.review}: {paymentState(locale, r.review)} ·{" "}
									{paymentRole(locale, "seller")} ·{" "}
									<bdi>{localTimestamp(r.paid_at, locale)}</bdi>
								</p>
								<p className="m-0 whitespace-pre-wrap break-words">
									{r.description}
								</p>
								{row.capabilities.evidence && (
									<div className="flex flex-wrap gap-2">
										{r.evidence.map((e) => (
											<PaymentEvidence
												key={e}
												id={e}
												{...{ locale, context: "seller" as const }}
											/>
										))}
									</div>
								)}
								{row.capabilities.correction && (
									<button
										type="button"
										className={salesAction}
										disabled={
											blocked ||
											row.corrections.some(
												(c) => c.receipt === r.id && c.state === "open",
											)
										}
										onClick={() => startCorrection(r)}
									>
										{t.correction}
									</button>
								)}
							</article>
						))}
					</section>
					<section className={salesPanel}>
						<h3 className="text-sm font-semibold">{t.corrections}</h3>
						<p className="m-0 text-xs text-muted">{t.correctionNote}</p>
						{row.corrections.map((c) => (
							<article
								key={c.id}
								className="space-y-1 rounded-xl border border-border p-3 text-sm"
							>
								<p className="m-0 flex flex-wrap items-center gap-2">
									<bdi>
										{c.amount} {row.currency}
									</bdi>
									<Badge
										variant="secondary"
										className={cn(
											"border-0",
											c.state === "open"
												? "bg-warning-surface text-warning"
												: "bg-page text-muted",
										)}
									>
										{paymentState(locale, c.state)}
									</Badge>
								</p>
								<p className="m-0">{c.reason}</p>
								<p className="m-0 text-muted">
									<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
								</p>
							</article>
						))}
					</section>
				</>
			)}
		</div>
	);
}

function Activity({
	locale,
	row,
	page,
	onPage,
}: {
	locale: Locale;
	row: Detail;
	page: number;
	onPage: (p: number) => void;
}) {
	const t = paymentCopy[locale],
		sales = sellerSalesCopy[locale];
	const last = Math.max(1, Math.ceil(row.history_count / 50));
	return (
		<section className={salesPanel}>
			<p className="m-0 text-sm text-muted">
				{sales.results}:{" "}
				<bdi>{new Intl.NumberFormat(locale).format(row.history_count)}</bdi> ·{" "}
				{sales.page} <bdi>{new Intl.NumberFormat(locale).format(page)}</bdi>
			</p>
			<div className="space-y-1">
				{row.history.map((e) => (
					<p
						key={e.id}
						className="m-0 border-s-2 border-border ps-3 text-sm leading-relaxed"
					>
						v{e.version} ·{" "}
						{paymentState(locale, e.action.replace(/^case_/, ""))} ·{" "}
						<bdi>
							{localTimestamp(e.created_at, locale)} ·{" "}
							{paymentRole(locale, e.context)}
						</bdi>
					</p>
				))}
			</div>
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					className={salesAction}
					disabled={page <= 1}
					onClick={() => onPage(page - 1)}
				>
					{t.previous}
				</button>
				<button
					type="button"
					className={salesAction}
					disabled={page >= last && page * 50 >= row.history_count}
					onClick={() => onPage(page + 1)}
				>
					{t.next}
				</button>
			</div>
		</section>
	);
}
