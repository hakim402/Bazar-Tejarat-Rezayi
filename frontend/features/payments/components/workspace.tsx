"use client";
import Link from "next/link";
import toast from "react-hot-toast";
import {
	ChevronLeft,
	ChevronRight,
	FileText,
	RefreshCw,
	RotateCcw,
	Truck,
	Wallet,
} from "lucide-react";
import { aftercareHref } from "../../aftercare/api";
import { aftercareCopy } from "../../aftercare/copy";
import { fulfilmentHref } from "../../fulfilment/api";
import { fulfilmentCopy } from "../../fulfilment/copy";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentProps,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { uuidPattern } from "../../../lib/routes/account-routes";
import type { Context } from "../../messaging/api";
import { localTimestamp } from "../../messaging/api";
import {
	accessLost,
	useCommunicationSession,
	useOnlineState,
} from "../../messaging/hooks";
import { SessionEntry } from "../../orders/components/session-entry";
import {
	action as defaultAction,
	panel as defaultPanel,
} from "../../orders/components/controls";
import { SellerSelect } from "../../../app/[locale]/(seller)/account/seller/components/seller-select";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import {
	SalesFrame,
	SalesHeader,
	SalesBusinessSelect,
	SalesEmpty,
	SalesPagination,
	salesHref,
	salesHistoryHref,
	salesAction,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { ActionReview, type ReviewedAction } from "./action-review";
import { invoiceHref } from "../../orders/api";
import { paymentCopy, paymentState, paymentRole } from "../copy";
import {
	payment,
	paymentHref,
	paymentReference,
	pendingPayment,
	retainPayment,
	settlePayment,
	type Payment,
	type Detail,
	type Profile,
	type Selection,
	type Intent,
	type Outcome,
	type Receipt,
	type Claim,
	type SelectionPreview,
} from "../api";
import { FactsForm } from "./facts-form";
import { SelectionForm } from "./selection-form";
import { PaymentEvidence } from "./evidence";
import { SellerPayments } from "./seller-payments";
import { Button } from "../../../components/shadcn/button";
import { Badge } from "../../../components/shadcn/badge";
import { Input } from "../../../components/shadcn/input";
import { Textarea } from "../../../components/shadcn/textarea";
import { StatusBadge } from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { Icon } from "../../../components/ui/icon";
import { cn } from "../../../lib/shadcn-utils";
import { orderListCopy } from "../../orders/list-copy";
import {
	DetailCard,
	DetailField,
	Money,
} from "../../orders/components/order-ui";
import {
	BuyerTableFrame,
	BuyerTableRegion,
	BuyerRowMenu,
	buyerRow,
	buyerCell,
} from "../../orders/components/buyer-ui";

type PaymentTab = "overview" | "receipts" | "history";
type PayVariant = NonNullable<ComponentProps<typeof StatusBadge>["variant"]>;
function payVariant(state: string): PayVariant {
	switch (state) {
		case "paid":
		case "confirmed":
		case "approved":
		case "reserved":
		case "resolved":
			return "success";
		case "partial":
		case "pending":
		case "open":
		case "awaiting_selection":
		case "review_required":
		case "shortage":
			return "warning";
		case "rejected":
		case "overdue":
		case "blocked_zero":
			return "danger";
		case "overpaid":
		case "withdrawn":
		case "referred":
			return "info";
		default:
			return "neutral";
	}
}
const subCard =
	"flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-page p-3";
const recordTime = "m-0 text-xs text-muted";
const recordText = "m-0 whitespace-pre-wrap break-words text-sm";

export function PaymentWorkspace({
	locale,
	context,
	id,
}: {
	locale: Locale;
	context: Context;
	id?: string;
}) {
	const session = useCommunicationSession(context),
		q = useSearchParams(),
		t = paymentCopy[locale];
	const [tab, setTab] = useState<PaymentTab>("overview");
	if (context === "seller") return <SellerPayments locale={locale} id={id} />;
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return (
			<SessionEntry locale={locale} context={context} error={session.error} />
		);
	const seller = "",
		page = Number(q.get("page") ?? 1),
		state = q.get("state") ?? "",
		attempt = q.get("payment_attempt");
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt && !uuidPattern.test(attempt)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000 ||
		!["", "unpaid", "partial", "paid", "overpaid", "overdue"].includes(state)
	)
		return <p role="alert">{t.error}</p>;
	const scope = `${session.session.identity.id}:${session.session.accounts[0].id}:${context}:${seller}:${id ?? "list"}`;
	return (
		<Workspace
			key={`${scope}:${locale}:${page}:${state}`}
			{...{
				locale,
				context,
				id,
				seller,
				page,
				state,
				attempt,
				scope,
				tab,
				setTab,
			}}
		/>
	);
}
function SellerPaymentRow({
	locale,
	row,
	href,
}: {
	locale: Locale;
	row: Payment;
	href: string;
}) {
	const t = paymentCopy[locale];
	return (
		<article className="min-w-0 space-y-4 p-4 sm:p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<h2 className="font-bold">
						<bdi>{row.number}</bdi>
					</h2>
					<p className="text-sm text-muted">
						{paymentRole(locale, "buyer")}: <bdi>{row.buyer_name}</bdi>
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
					<span className="rounded-full bg-info px-3 py-1.5 text-action">
						{paymentState(locale, row.financial)}
					</span>
					{row.overdue && (
						<span className="rounded-full bg-warning-surface px-3 py-1.5 text-warning">
							{t.overdue}
						</span>
					)}
				</div>
			</div>
			<dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{(
					[
						[t.total, row.goods_total],
						[t.confirmed, row.confirmed_total],
						[t.remaining, row.remaining],
						[t.overpayment, row.overpayment],
					] as const
				).map(([label, value]) => (
					<div key={label} className="min-w-0">
						<dt className="text-xs text-muted">{label}</dt>
						<dd className="mt-1 break-all text-sm font-semibold tabular-nums">
							<bdi>
								{value} {row.currency}
							</bdi>
						</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
				<div className="min-w-0 space-y-1 text-xs text-muted">
					<p>
						{t.method}: {paymentState(locale, row.payment_method)} ·{" "}
						{t.allocation}: {paymentState(locale, row.allocation)}
					</p>
					<p>
						{t.effectiveDue}:{" "}
						<bdi>
							{row.effective_due_at
								? localTimestamp(row.effective_due_at, locale)
								: "—"}
						</bdi>
					</p>
				</div>
				<Link className={salesAction} prefetch={false} href={href}>
					{sellerSalesCopy[locale].view}
				</Link>
			</div>
		</article>
	);
}
function Workspace({
	locale,
	context,
	id,
	seller,
	page,
	state,
	attempt,
	scope,
	tab,
	setTab,
}: {
	locale: Locale;
	context: Context;
	id?: string;
	seller: string;
	page: number;
	state: string;
	attempt: string | null;
	scope: string;
	tab: PaymentTab;
	setTab: (tab: PaymentTab) => void;
}) {
	const t = paymentCopy[locale],
		sales = sellerSalesCopy[locale],
		ol = orderListCopy[locale],
		ac = aftercareCopy[locale],
		nf = new Intl.NumberFormat(locale),
		isSeller = context === "seller",
		action = isSeller ? salesAction : defaultAction,
		panel = isSeller ? salesPanel : defaultPanel,
		params = useSearchParams(),
		router = useRouter();
	const dueId = useId(),
		extensionReasonId = useId();
	const online = useOnlineState();
	const [row, setRow] = useState<Detail | null>(null),
		[list, setList] = useState<{ count: number; results: Payment[] } | null>(
			null,
		),
		[profiles, setProfiles] = useState<Profile[]>([]),
		[profilePage, setProfilePage] = useState(1),
		[moreProfiles, setMoreProfiles] = useState(false),
		[profilesBusy, setProfilesBusy] = useState(false),
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
		[claimReasons, setClaimReasons] = useState<Record<string, string>>({}),
		[due, setDue] = useState(""),
		[formKey, setFormKey] = useState(0),
		[notice, setNotice] = useState("");
	const live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		opener = useRef<HTMLElement | null>(null),
		initial = useRef(false),
		pendingFocus = useRef(false),
		workspace = useRef<HTMLElement>(null),
		title = useRef<HTMLHeadingElement>(null);
	useLayoutEffect(() => {
		if (!isSeller) return;
		title.current = workspace.current?.querySelector("h1") ?? null;
		title.current?.setAttribute("tabindex", "-1");
	}, [isSeller]);
	useLayoutEffect(() => {
		live.current = {};
		return () => {
			live.current = null;
			owned.current = null;
		};
	}, []);
	useLayoutEffect(() => {
		if (busy || !pendingFocus.current) return;
		const previous = opener.current;
		const next =
			previous?.isConnected && !previous.matches(":disabled")
				? previous
				: (workspace.current?.querySelector<HTMLElement>(
						"[data-payment-reconcile]:not(:disabled),[data-payment-facts-review]:not(:disabled)",
					) ?? title.current);
		next?.focus();
		pendingFocus.current = false;
	}, [busy]);
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
				setEvidence([]);
				settlePayment(scope);
				setIntent(undefined);
				setModal(null);
			}
			setError(true);
		},
		[scope],
	);
	async function load(signal?: AbortSignal) {
		const mine = live.current;
		if (!mine) return;
		try {
			if (context === "seller" && !initial.current) {
				const p = await payment<{ results: Profile[]; count: number }>(
					context,
					"profiles/",
					undefined,
					signal,
				);
				if (live.current !== mine || signal?.aborted) return;
				setProfiles(p.results);
				setMoreProfiles(p.count > 20);
				if (!seller && !id) {
					if (p.results[0]) {
						const href = salesHistoryHref(
							paymentHref(locale, context, id, p.results[0].id, page, state),
							params,
						);
						router.replace(
							attempt
								? `${href}${href.includes("?") ? "&" : "?"}payment_attempt=${attempt}`
								: href,
						);
					} else setList({ count: 0, results: [] });
					return;
				}
				initial.current = true;
			}
			const query = `?page=${page}${seller ? `&seller=${seller}` : ""}${state ? `&state=${state}` : ""}`;
			if (id) {
				const value = await payment<Detail>(
					context,
					`orders/${id}/${query}`,
					undefined,
					signal,
				);
				if (live.current !== mine || signal?.aborted) return;
				if (context === "seller" && !seller) {
					const href = salesHistoryHref(
						paymentHref(locale, context, id, value.seller, page),
						params,
					);
					router.replace(attempt ? `${href}&payment_attempt=${attempt}` : href);
					return;
				}
				setRow(value);
			} else {
				const value = await payment<{ count: number; results: Payment[] }>(
					context,
					`orders/${query}`,
					undefined,
					signal,
				);
				if (live.current === mine && !signal?.aborted) setList(value);
			}
			if (live.current === mine && !signal?.aborted) setError(false);
		} catch (e) {
			if (!signal?.aborted) fail(e, mine);
			throw e;
		}
	}
	async function loadMoreProfiles() {
		const mine = live.current;
		if (!mine || profilesBusy || !moreProfiles) return;
		setProfilesBusy(true);
		try {
			const next = profilePage + 1;
			const data = await payment<{ results: Profile[]; count: number }>(
				context,
				`profiles/?page=${next}`,
			);
			if (live.current !== mine) return;
			setProfiles((previous) => [...previous, ...data.results]);
			setProfilePage(next);
			setMoreProfiles(next < 10000 && next * 20 < data.count);
		} catch (error) {
			fail(error, mine);
		} finally {
			if (live.current === mine) setProfilesBusy(false);
		}
	}
	const loader = useRef(load);
	useLayoutEffect(() => {
		loader.current = load;
	});
	useEffect(() => {
		const c = new AbortController();
		void loader.current(c.signal).catch(() => {});
		return () => c.abort();
	}, []);
	const unsettled = !!(
		intent ||
		reference ||
		(row &&
			(row.allocation === "pending" ||
				row.allocation === "review_required" ||
				row.allocation === "shortage" ||
				row.cases.some((c) => c.state === "open") ||
				row.claims.some((c) => c.state === "pending") ||
				row.corrections.some((c) => c.state === "open")))
	);
	useEffect(() => {
		if (!unsettled || denied) return;
		let active = true,
			timer: ReturnType<typeof setTimeout> | undefined,
			controller: AbortController | null = null,
			running = false;
		const tick = async () => {
			if (!active || running) return;
			if (document.hidden || !navigator.onLine) {
				timer = setTimeout(() => void tick(), 15000);
				return;
			}
			running = true;
			controller = new AbortController();
			let delay = 15000;
			try {
				await loader.current(controller.signal);
			} catch {
				delay = 60000;
			} finally {
				running = false;
				if (active) timer = setTimeout(() => void tick(), delay);
			}
		};
		const visible = () => {
			if (!document.hidden && navigator.onLine && !running) {
				clearTimeout(timer);
				void tick();
			}
		};
		timer = setTimeout(() => void tick(), 15000);
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("online", visible);
		return () => {
			active = false;
			clearTimeout(timer);
			controller?.abort();
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("online", visible);
		};
	}, [unsettled, denied]);
	useEffect(() => {
		if (!id || !row?.capabilities.selection || row.selection?.allocation)
			return;
		const mine = live.current,
			c = new AbortController();
		void payment<Selection>(
			context,
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
		context,
		fail,
	]);
	function review(
		path: string,
		body: Record<string, unknown>,
		label: string,
		preview?: SelectionPreview[],
	) {
		if (blocked || !row) return;
		opener.current = document.activeElement as HTMLElement;
		setModal({
			row: structuredClone(row),
			preview: preview ? structuredClone(preview) : undefined,
			label,
			packet: {
				key: crypto.randomUUID(),
				path,
				body: { ...body, version: row.version },
				upload: false,
			},
		});
	}
	function finished(
		outcome: Record<string, unknown>,
		current?: Detail,
		absent = false,
	) {
		settlePayment(scope);
		setIntent(undefined);
		setReference(null);
		paymentReference(null);
		if (current) setRow(current);
		if (absent) {
			setNotice(t.continue);
			toast(t.continue);
			return;
		}
		if (typeof outcome.evidence === "string" || typeof outcome.id === "string")
			setEvidence((e) =>
				[...new Set([...e, (outcome.evidence ?? outcome.id) as string])].slice(
					0,
					3,
				),
			);
		else {
			setEvidence([]);
			setCorrection(undefined);
			setReplacement(undefined);
			setDirty(false);
			setFormKey((v) => v + 1);
		}
		setNotice(outcome.duplicate_warning ? t.duplicate : "");
		toast.success(t.saved);
	}
	async function send(packet: Intent) {
		if (owned.current) return;
		const mine = live.current;
		if (!mine) return;
		const token = {};
		owned.current = token;
		pendingFocus.current = !!modal;
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
					context,
					retained.path,
					body,
				);
				if (live.current === mine && owned.current === token)
					finished({ evidence: result.id });
			} else {
				const result = await payment<Outcome>(context, retained.path, body);
				if (live.current === mine && owned.current === token) {
					const claimId = retained.path.match(/^claims\/([^/]+)\//)?.[1];
					if (claimId) setClaimReasons((m) => ({ ...m, [claimId]: "" }));
					finished(result.outcome, result.current);
				}
			}
		} catch (e) {
			if (live.current === mine) toast.error(t.failed);
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
		pendingFocus.current = true;
		opener.current = document.activeElement as HTMLElement;
		const key = intent?.key ?? reference,
			mine = live.current;
		if (!key || !mine) return;
		const token = {};
		owned.current = token;
		setBusy(true);
		try {
			const result = await payment<Outcome>(
				context,
				`orders/${id}/commands/${key}/reconcile/`,
				{},
			);
			if (live.current === mine && owned.current === token)
				finished(
					result.outcome,
					result.current,
					result.state === "absent_fenced",
				);
		} catch (e) {
			if (live.current === mine) toast.error(t.failed);
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
	const noBusiness = isSeller && !seller && !!list && profiles.length === 0;
	// List return keys are local UI state, independent of this detail's history page.
	const returnParams = new URLSearchParams();
	for (const key of ["page", "state"]) {
		const value = params.get(`list_${key}`);
		if (value) returnParams.set(key, value);
	}
	const withReturn = (href: string) => {
			const extra = new URLSearchParams();
			if (page > 1) extra.set("list_page", String(page));
			if (state) extra.set("list_state", state);
			return extra.size
				? `${href}${href.includes("?") ? "&" : "?"}${extra}`
				: href;
		},
		detailPageHref = (next: number) => {
			const href = paymentHref(locale, context, id, seller, next),
				extra = new URLSearchParams();
			for (const key of ["list_page", "list_state"]) {
				const value = params.get(key);
				if (value) extra.set(key, value);
			}
			return extra.size
				? `${href}${href.includes("?") ? "&" : "?"}${extra}`
				: href;
		},
		backPage = Number(returnParams.get("page") ?? 1),
		backState = returnParams.get("state") ?? "",
		backHref = paymentHref(
			locale,
			context,
			undefined,
			seller,
			Number.isInteger(backPage) && backPage >= 1 && backPage <= 10000
				? backPage
				: 1,
			["unpaid", "partial", "paid", "overpaid", "overdue"].includes(backState)
				? backState
				: "",
		),
		listIdentity = (r: Payment) => (
			<div className="flex min-w-0 flex-col gap-1">
				<Link
					href={withReturn(paymentHref(locale, context, r.id, seller))}
					className="text-sm font-semibold text-action no-underline hover:text-foreground"
				>
					<bdi>{r.number}</bdi>
				</Link>
				<p className="m-0 max-w-44 truncate text-xs text-muted" dir="auto">
					<bdi>{r.seller_name}</bdi>
				</p>
			</div>
		),
		listAmounts = (r: Payment) => (
			<div className="flex flex-col gap-1">
				<Money
					amount={r.goods_total}
					currency={r.currency}
					className="text-sm font-semibold"
				/>
				<p className="m-0 whitespace-nowrap text-xs text-muted">
					{t.remaining}: <Money amount={r.remaining} currency={r.currency} />
				</p>
				<p className="m-0 whitespace-nowrap text-xs text-muted">
					{t.confirmed}:{" "}
					<Money amount={r.confirmed_total} currency={r.currency} />
				</p>
			</div>
		),
		listBadges = (r: Payment) => (
			<div className="flex flex-wrap items-center gap-1 lg:flex-nowrap">
				<StatusBadge
					size="sm"
					variant={payVariant(r.financial)}
					className="shrink-0 whitespace-nowrap"
				>
					{paymentState(locale, r.financial)}
				</StatusBadge>
				{r.overdue && (
					<StatusBadge
						size="sm"
						variant="danger"
						className="shrink-0 whitespace-nowrap"
					>
						{t.overdue}
					</StatusBadge>
				)}
			</div>
		),
		listMenu = (r: Payment) => (
			<BuyerRowMenu
				locale={locale}
				label={`${ol.actions}: ${r.number}`}
				links={[
					{
						href: withReturn(paymentHref(locale, context, r.id, seller)),
						label: t.continue,
						Icon: Wallet,
					},
					{
						href: invoiceHref(locale, context, r.invoice, seller),
						label: t.invoice,
						Icon: FileText,
					},
					{
						href: fulfilmentHref(locale, context, r.id, seller),
						label: fulfilmentCopy[locale].buyerTitle,
						Icon: Truck,
					},
					{
						href: aftercareHref(locale, context, r.id, seller),
						label: ol.aftercare,
						Icon: RotateCcw,
					},
				]}
			/>
		);
	const buyerOverview = row && (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="grid items-stretch gap-4 lg:grid-cols-2">
				<DetailCard
					title={t.paymentInfo}
					icon="wallet"
					compact
					className="h-full"
				>
					<dl className="m-0 grid gap-4 sm:grid-cols-2">
						<DetailField label={paymentRole(locale, "seller")}>
							<bdi>{row.seller_name}</bdi>
						</DetailField>
						<DetailField label={t.method}>
							{paymentState(locale, row.payment_method)}
						</DetailField>
						<DetailField label={t.allocation}>
							<StatusBadge size="sm" variant={payVariant(row.allocation)}>
								{paymentState(locale, row.allocation)}
							</StatusBadge>
						</DetailField>
						<DetailField label={t.originalDue}>
							<bdi>
								{row.original_due_at
									? localTimestamp(row.original_due_at, locale)
									: "—"}
							</bdi>
						</DetailField>
						<DetailField label={t.effectiveDue}>
							<bdi>
								{row.effective_due_at
									? localTimestamp(row.effective_due_at, locale)
									: "—"}
							</bdi>{" "}
							<span className="text-xs font-normal text-muted">
								v{row.deadline_generation}
							</span>
						</DetailField>
					</dl>
				</DetailCard>
				<DetailCard title={t.amounts} icon="receipt" compact className="h-full">
					<dl className="m-0 grid grid-cols-2 gap-4">
						<DetailField label={t.total}>
							<Money
								amount={row.goods_total}
								currency={row.currency}
								className="text-base font-bold"
							/>
						</DetailField>
						<DetailField label={t.confirmed}>
							<Money
								amount={row.confirmed_total}
								currency={row.currency}
								className="text-base font-bold"
							/>
						</DetailField>
						<DetailField label={t.remaining}>
							<Money
								amount={row.remaining}
								currency={row.currency}
								className="text-base font-bold"
							/>
						</DetailField>
						<DetailField label={t.overpayment}>
							<Money
								amount={row.overpayment}
								currency={row.currency}
								className="text-base font-bold"
							/>
						</DetailField>
					</dl>
					<p className="m-0 mt-auto rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-muted">
						{t.noAutomatic}
					</p>
				</DetailCard>
			</div>
			{row.capabilities.details && (
				<>
					{row.capabilities.selection &&
						selection &&
						!row.selection?.allocation && (
							<SelectionForm
								compact
								{...{
									locale,
									row,
									selection,
									disabled: blocked,
									onReview: review,
									onPage: setSelectionPage,
									onDirty: () => setDirty(true),
								}}
							/>
						)}
					{row.plans.length > 0 && (
						<DetailCard title={t.plans} icon="box" compact>
							<div className="flex flex-col gap-3">
								{row.plans.map((p) => (
									<div key={p.id} className={subCard}>
										<div className="flex flex-wrap items-center gap-2">
											<StatusBadge size="sm" variant={payVariant(p.state)}>
												{paymentState(locale, p.state)}
											</StatusBadge>
											{p.reason && (
												<span className="text-xs text-muted" dir="auto">
													{p.reason}
												</span>
											)}
										</div>
										{p.lines.map((l, i) => (
											<p
												key={`${l.variant}:${l.batch ?? i}`}
												className="m-0 text-xs text-muted"
											>
												<bdi>{l.sku}</bdi> · {t.batch}:{" "}
												<bdi>{l.batch_code || "—"}</bdi> · {t.quantity}:{" "}
												<bdi>
													{l.quantity} {l.unit_labels[locale] ?? l.unit}
												</bdi>
											</p>
										))}
									</div>
								))}
							</div>
						</DetailCard>
					)}
					{row.capabilities.extension && (
						<form
							className="flex min-w-0 flex-col gap-4 rounded-xl border border-solid border-border bg-surface p-4 sm:p-5"
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
									`orders/${id}/extensions/`,
									{
										deadline_generation: row.deadline_generation,
										due_at: new Date(parsed).toISOString(),
										reason: reason.trim(),
									},
									t.extend,
								);
							}}
						>
							<h3 className="m-0 text-base font-semibold">{t.extend}</h3>
							<fieldset
								disabled={blocked}
								className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2"
							>
								<div className="min-w-0 space-y-2">
									<label htmlFor={dueId} className="block text-sm font-medium">
										{t.laterDue}
									</label>
									<Input
										id={dueId}
										type="datetime-local"
										required
										className="h-10 rounded-lg border-solid text-sm shadow-none"
										value={due}
										onChange={(e) => {
											setDue(e.target.value);
											setDirty(true);
										}}
									/>
								</div>
								<div className="min-w-0 space-y-2 sm:col-span-2">
									<label
										htmlFor={extensionReasonId}
										className="block text-sm font-medium"
									>
										{t.reason}
									</label>
									<Textarea
										id={extensionReasonId}
										required
										minLength={3}
										maxLength={1000}
										className="h-auto min-h-24 resize-y rounded-lg border-solid text-sm shadow-none"
										value={reason}
										onChange={(e) => {
											setReason(e.target.value);
											setDirty(true);
										}}
									/>
								</div>
								<p className="m-0 text-xs leading-relaxed text-muted sm:col-span-2">
									{t.inputTimezone}
								</p>
								<Button
									type="submit"
									className="justify-self-start rounded-lg sm:col-span-2"
								>
									{t.exact}
								</Button>
							</fieldset>
						</form>
					)}
					{row.extensions.length > 0 && (
						<DetailCard title={t.deadlines} icon="clock" compact>
							<div className="flex flex-col gap-3">
								{row.extensions.map((e) => (
									<div
										key={e.id}
										className="flex flex-col gap-1 border-s-2 border-border ps-3"
									>
										<p className="m-0 text-sm font-medium">
											<bdi>
												{localTimestamp(e.before_at, locale)} →{" "}
												{localTimestamp(e.due_at, locale)}
											</bdi>
										</p>
										<p className="m-0 text-xs text-muted" dir="auto">
											{e.reason}
										</p>
									</div>
								))}
							</div>
						</DetailCard>
					)}
					{row.cases.length > 0 && (
						<DetailCard title={t.cases} icon="shield" compact>
							<div className="flex flex-col gap-2">
								{row.cases.map((c) => (
									<div key={c.id} className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-medium">
											{paymentState(locale, c.kind)}
										</span>
										<StatusBadge size="sm" variant={payVariant(c.state)}>
											{paymentState(locale, c.state)}
										</StatusBadge>
									</div>
								))}
							</div>
						</DetailCard>
					)}
				</>
			)}
		</div>
	);
	const buyerFacts = row && (
		<>
			<p className="m-0 rounded-xl bg-info px-4 py-3 text-sm leading-relaxed text-action">
				{t.claimNote}
			</p>
			{(row.capabilities.claim || row.capabilities.receipt) && (
				<FactsForm
					key={`${formKey}:${correction?.id ?? replacement?.id ?? "new"}`}
					{...{
						locale,
						row,
						disabled: blocked,
						evidence,
						onEvidence: upload,
						onReview: review,
						onDirty: () => setDirty(true),
					}}
					receipt={correction}
					prior={replacement}
					context={context}
					onRemove={(image) => {
						setEvidence((e) => e.filter((x) => x !== image));
						setDirty(true);
					}}
				/>
			)}
			{(correction || replacement) && (
				<Button
					type="button"
					variant="outline"
					className="w-fit rounded-lg"
					disabled={blocked}
					onClick={() =>
						guard.choose(() => {
							setCorrection(undefined);
							setReplacement(undefined);
							setEvidence([]);
							setDirty(false);
						})
					}
				>
					{t.cancel}
				</Button>
			)}
		</>
	);
	const buyerRecords = row?.capabilities.details && (
		<>
			<DetailCard
				title={t.claims}
				icon="shield"
				compact
				action={
					row.claims.length > 0 ? (
						<Badge
							variant="secondary"
							className="rounded-full border-0 bg-page text-muted"
						>
							{nf.format(row.claims.length)}
						</Badge>
					) : undefined
				}
			>
				{row.claims.length === 0 ? (
					<p className="m-0 text-sm text-muted">{t.none}</p>
				) : (
					<div className="flex flex-col gap-3">
						{row.claims.map((c) => (
							<article key={c.id} className={subCard}>
								<div className="flex flex-wrap items-center gap-2">
									<Money
										amount={c.amount}
										currency={c.currency}
										className="text-sm font-bold"
									/>
									<StatusBadge size="sm" variant={payVariant(c.state)}>
										{paymentState(locale, c.state)}
									</StatusBadge>
									<span className="text-xs text-muted">
										v{c.version} · {paymentRole(locale, "buyer")}
									</span>
								</div>
								<p className={recordTime}>
									<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
								</p>
								{c.description && (
									<p className={recordText} dir="auto">
										{c.description}
									</p>
								)}
								{c.reason && (
									<p
										className="m-0 border-s-2 border-border ps-2 text-xs text-muted"
										dir="auto"
									>
										{c.reason}
									</p>
								)}
								{row.capabilities.evidence && c.evidence.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{c.evidence.map((e) => (
											<PaymentEvidence
												key={e}
												id={e}
												{...{ locale, context }}
											/>
										))}
									</div>
								)}
								{row.capabilities.claim &&
									["withdrawn", "rejected"].includes(c.state) &&
									!c.replacement && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="w-fit rounded-lg"
											disabled={blocked}
											onClick={() =>
												guard.choose(() => {
													setReplacement(c);
													setCorrection(undefined);
													setEvidence([]);
													setFormKey((v) => v + 1);
												})
											}
										>
											{t.replaceClaim}
										</Button>
									)}
								{c.state === "pending" && (
									<div className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-2">
										<label
											htmlFor={`${c.id}-reason`}
											className="text-xs font-medium"
										>
											{t.reason}
										</label>
										<Textarea
											id={`${c.id}-reason`}
											maxLength={1000}
											disabled={blocked}
											className="h-auto min-h-16 resize-y rounded-lg border-solid bg-surface text-sm shadow-none"
											value={claimReasons[c.id] ?? ""}
											onChange={(e) => {
												const value = e.target.value;
												setClaimReasons((m) => ({ ...m, [c.id]: value }));
												setDirty(true);
											}}
										/>
										<div className="flex flex-wrap gap-2">
											{(row.capabilities.claim
												? ["withdraw"]
												: row.capabilities.receipt
													? ["confirm", "reject"]
													: []
											).map((a) => (
												<Button
													type="button"
													key={a}
													size="sm"
													variant={
														a === "reject"
															? "destructive"
															: a === "confirm"
																? "default"
																: "outline"
													}
													className="rounded-lg"
													disabled={
														blocked ||
														(claimReasons[c.id] ?? "").trim().length < 3
													}
													onClick={() =>
														review(
															`claims/${c.id}/${a}/`,
															{
																claim_version: c.version,
																reason: (claimReasons[c.id] ?? "").trim(),
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
												</Button>
											))}
										</div>
									</div>
								)}
							</article>
						))}
					</div>
				)}
			</DetailCard>
			<DetailCard
				title={t.receipts}
				icon="receipt"
				compact
				action={
					row.receipts.length > 0 ? (
						<Badge
							variant="secondary"
							className="rounded-full border-0 bg-page text-muted"
						>
							{nf.format(row.receipts.length)}
						</Badge>
					) : undefined
				}
			>
				{row.receipts.length === 0 ? (
					<p className="m-0 text-sm text-muted">{t.none}</p>
				) : (
					<div className="flex flex-col gap-3">
						{row.receipts.map((r) => (
							<article key={r.id} className={subCard}>
								<div className="grid grid-cols-2 gap-2">
									<div className="min-w-0">
										<p className="m-0 text-xs text-muted">{t.originalAmount}</p>
										<Money
											amount={r.original_amount}
											currency={r.currency}
											className="text-sm font-medium"
										/>
									</div>
									<div className="min-w-0">
										<p className="m-0 text-xs text-muted">
											{t.effectiveAmount}
										</p>
										<Money
											amount={r.amount}
											currency={r.currency}
											className="text-sm font-bold"
										/>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<StatusBadge size="sm" variant={payVariant(r.review)}>
										{t.review}: {paymentState(locale, r.review)}
									</StatusBadge>
									<span className="text-xs text-muted">
										v{r.version} · {paymentRole(locale, "seller")}
									</span>
								</div>
								<p className={recordTime}>
									<bdi>{localTimestamp(r.paid_at, locale)}</bdi>
								</p>
								{r.description && (
									<p className={recordText} dir="auto">
										{r.description}
									</p>
								)}
								{row.capabilities.evidence && r.evidence.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{r.evidence.map((e) => (
											<PaymentEvidence
												key={e}
												id={e}
												{...{ locale, context }}
											/>
										))}
									</div>
								)}
								{row.capabilities.correction && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="w-fit rounded-lg"
										disabled={
											blocked ||
											row.corrections.some(
												(c) => c.receipt === r.id && c.state === "open",
											)
										}
										onClick={() =>
											guard.choose(() => {
												setCorrection(r);
												setReplacement(undefined);
												setEvidence([]);
											})
										}
									>
										{t.correction}
									</Button>
								)}
							</article>
						))}
					</div>
				)}
			</DetailCard>
			<DetailCard
				title={t.corrections}
				icon="file"
				compact
				action={
					row.corrections.length > 0 ? (
						<Badge
							variant="secondary"
							className="rounded-full border-0 bg-page text-muted"
						>
							{nf.format(row.corrections.length)}
						</Badge>
					) : undefined
				}
			>
				<p className="m-0 text-xs leading-relaxed text-muted">
					{t.correctionNote}
				</p>
				{row.corrections.length === 0 ? (
					<p className="m-0 text-sm text-muted">{t.none}</p>
				) : (
					<div className="flex flex-col gap-3">
						{row.corrections.map((c) => (
							<article key={c.id} className={subCard}>
								<div className="flex flex-wrap items-center gap-2">
									<Money
										amount={c.amount}
										currency={row.currency}
										className="text-sm font-bold"
									/>
									<StatusBadge size="sm" variant={payVariant(c.state)}>
										{paymentState(locale, c.state)}
									</StatusBadge>
									<span className="text-xs text-muted">
										v{c.target_version}
									</span>
								</div>
								{c.reason && (
									<p className="m-0 text-sm font-medium" dir="auto">
										{c.reason}
									</p>
								)}
								{c.description && (
									<p className={recordText} dir="auto">
										{c.description}
									</p>
								)}
								<p className={recordTime}>
									<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
								</p>
								{row.capabilities.evidence && c.evidence.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{c.evidence.map((e) => (
											<PaymentEvidence
												key={e}
												id={e}
												{...{ locale, context }}
											/>
										))}
									</div>
								)}
							</article>
						))}
					</div>
				)}
			</DetailCard>
		</>
	);
	const buyerHistory = row?.capabilities.details && (
		<DetailCard title={t.history} icon="history" compact>
			<p className="m-0 text-xs text-muted">
				{sales.results}:{" "}
				<bdi className="font-semibold tabular-nums text-foreground">
					{nf.format(row.history_count)}
				</bdi>{" "}
				· {sales.page} <bdi>{nf.format(page)}</bdi>
			</p>
			{row.history.length === 0 ? (
				<p className="m-0 text-sm text-muted">{t.none}</p>
			) : (
				<div className="divide-y divide-border">
					{row.history.map((e) => (
						<div
							key={e.id}
							className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0"
						>
							<StatusBadge size="sm" variant="neutral">
								{paymentState(locale, e.action.replace(/^case_/, ""))}
							</StatusBadge>
							<span className="text-xs text-muted">v{e.version}</span>
							<span className="ms-auto text-xs text-muted">
								<bdi>
									{localTimestamp(e.created_at, locale)} ·{" "}
									{paymentRole(locale, e.context)}
								</bdi>
							</span>
						</div>
					))}
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="rounded-lg"
					disabled={page <= 1 || blocked}
					onClick={() =>
						guard.choose(() => router.push(detailPageHref(page - 1)))
					}
				>
					<ChevronLeft className="size-4 rtl:rotate-180" />
					{t.previous}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="rounded-lg"
					disabled={
						blocked ||
						(page * 50 >= row.history_count &&
							row.claims.length < 20 &&
							row.receipts.length < 20 &&
							row.corrections.length < 20 &&
							row.plans.length < 20 &&
							row.cases.length < 20 &&
							row.extensions.length < 20)
					}
					onClick={() =>
						guard.choose(() => router.push(detailPageHref(page + 1)))
					}
				>
					{t.next}
					<ChevronRight className="size-4 rtl:rotate-180" />
				</Button>
			</div>
		</DetailCard>
	);
	if (denied) return <p role="alert">{t.noAccess}</p>;
	return (
		<SalesFrame seller={isSeller}>
			<section
				ref={workspace}
				className="space-y-5 min-w-0"
				aria-label={t.title}
			>
				{isSeller ? (
					<SalesHeader
						locale={locale}
						section="payments"
						seller={row?.seller ?? seller}
						back={
							id
								? salesHref(
										locale,
										"payments",
										row?.seller ?? seller,
										undefined,
										returnParams,
									)
								: undefined
						}
						business={
							profiles.length > 0 ? (
								<fieldset
									disabled={busy || profilesBusy}
									className="min-w-0 space-y-3 border-0 p-0"
								>
									<SalesBusinessSelect
										locale={locale}
										value={seller}
										profiles={
											seller &&
											!profiles.some((profile) => profile.id === seller)
												? [
														...profiles,
														{ id: seller, name: row?.seller_name ?? seller },
													]
												: profiles
										}
										onChange={(nextSeller) => {
											if (busy) return;
											guard.choose(() =>
												router.push(salesHref(locale, "payments", nextSeller)),
											);
										}}
									/>
									{moreProfiles && (
										<button
											type="button"
											className={action}
											onClick={() => void loadMoreProfiles()}
										>
											{sales.moreBusinesses}
										</button>
									)}
								</fieldset>
							) : undefined
						}
					/>
				) : (
					<header className="flex min-w-0 flex-col gap-3">
						{id && (
							<Link
								href={backHref}
								className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted no-underline hover:text-action"
							>
								<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
								{t.title}
							</Link>
						)}
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<h1
									ref={title}
									tabIndex={-1}
									className="m-0 flex flex-wrap items-center gap-2 text-2xl font-bold"
								>
									{row ? <bdi>{row.number}</bdi> : t.title}
									{row && (
										<StatusBadge variant={payVariant(row.financial)}>
											{paymentState(locale, row.financial)}
										</StatusBadge>
									)}
									{row?.overdue && (
										<StatusBadge variant="danger">{t.overdue}</StatusBadge>
									)}
								</h1>
								{row ? (
									<p className="m-0 text-sm text-muted">
										<bdi>{row.seller_name}</bdi>
									</p>
								) : (
									!id && <p className="m-0 text-sm text-muted">{t.intro}</p>
								)}
							</div>
							{row && (
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										className="rounded-lg"
										asChild
									>
										<Link
											prefetch={false}
											href={fulfilmentHref(locale, context, row.id, seller)}
										>
											<Truck className="size-4" aria-hidden="true" />
											{fulfilmentCopy[locale].buyerTitle}
										</Link>
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="rounded-lg"
										asChild
									>
										<Link
											prefetch={false}
											href={invoiceHref(locale, context, row.invoice, seller)}
										>
											<FileText className="size-4" aria-hidden="true" />
											{t.invoice}
										</Link>
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="rounded-lg"
										disabled={busy}
										onClick={() => void load().catch(() => {})}
									>
										<RefreshCw
											className={cn(
												"size-4",
												busy && "animate-spin motion-reduce:animate-none",
											)}
											aria-hidden="true"
										/>
										{t.refresh}
									</Button>
								</div>
							)}
						</div>
					</header>
				)}
				{!online && (
					<p
						role="status"
						className={cn(
							"m-0",
							!isSeller && "rounded-lg bg-page px-3 py-2 text-sm text-muted",
						)}
					>
						{t.offline}
					</p>
				)}
				{noBusiness && <SalesEmpty locale={locale} noBusiness />}
				{error && (
					<p
						role="alert"
						className={
							isSeller
								? "text-warning"
								: "m-0 rounded-lg border border-solid border-danger bg-danger-surface px-3 py-2 text-sm text-danger"
						}
					>
						{t.error}
					</p>
				)}
				{notice && (
					<p
						role="status"
						className={cn(
							"m-0",
							!isSeller && "rounded-lg bg-info px-3 py-2 text-sm text-action",
						)}
					>
						{notice}
					</p>
				)}
				{(intent || reference) &&
					(isSeller ? (
						<div className={panel}>
							<p role="status">{t.unresolved}</p>
							<div className="flex flex-wrap gap-3">
								{intent && (
									<button
										type="button"
										className={action}
										disabled={busy}
										onClick={() => void send(intent)}
									>
										{t.retry}
									</button>
								)}
								<button
									type="button"
									className={action}
									disabled={busy}
									data-payment-reconcile
									onClick={() => void reconcile()}
								>
									{t.reconcile}
								</button>
							</div>
						</div>
					) : (
						<div className="flex min-w-0 flex-col gap-3 rounded-xl border border-solid border-warning bg-warning-surface p-4">
							<p role="status" className="m-0 text-sm font-medium text-warning">
								{t.unresolved}
							</p>
							<div className="flex flex-wrap gap-2">
								{intent && (
									<Button
										type="button"
										size="sm"
										className="rounded-lg"
										disabled={busy}
										onClick={() => void send(intent)}
									>
										{t.retry}
									</Button>
								)}
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-lg"
									disabled={busy}
									data-payment-reconcile
									onClick={() => void reconcile()}
								>
									{t.reconcile}
								</Button>
							</div>
						</div>
					))}
				{isSeller && (
					<button
						type="button"
						className={action}
						disabled={busy}
						onClick={() => void load().catch(() => {})}
					>
						{t.refresh}
					</button>
				)}
				{!id &&
					!noBusiness &&
					(isSeller ? (
						<>
							<div className={`${salesPanel} flex flex-wrap items-end gap-3`}>
								<div className="min-w-0 flex-1 space-y-2 sm:max-w-xs">
									<p className="text-xs font-semibold text-muted">
										{sales.paymentStatus}
									</p>
									<SellerSelect
										label={sales.paymentStatus}
										value={state}
										options={[
											"",
											"unpaid",
											"partial",
											"paid",
											"overpaid",
											"overdue",
										].map((value) => ({
											value,
											label: value ? paymentState(locale, value) : t.all,
										}))}
										onChange={(value) =>
											guard.choose(() =>
												router.push(
													salesHref(
														locale,
														"payments",
														seller,
														undefined,
														undefined,
														{ page: "1", state: value },
													),
												),
											)
										}
									/>
								</div>
								{(state || page > 1) && (
									<button
										type="button"
										className={action}
										onClick={() =>
											guard.choose(() =>
												router.push(salesHref(locale, "payments", seller)),
											)
										}
									>
										{sales.clear}
									</button>
								)}
							</div>
							{!list ? (
								!error && <p role="status">{t.loading}</p>
							) : !list.results.length ? (
								<SalesEmpty locale={locale} filtered={!!state || page > 1}>
									{(state || page > 1) && (
										<button
											type="button"
											className={action}
											onClick={() =>
												guard.choose(() =>
													router.push(salesHref(locale, "payments", seller)),
												)
											}
										>
											{sales.clear}
										</button>
									)}
								</SalesEmpty>
							) : (
								<div className="min-w-0 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
									{list.results.map((r) => (
										<SellerPaymentRow
											key={r.id}
											locale={locale}
											row={r}
											href={salesHref(
												locale,
												"payments",
												r.seller,
												r.id,
												undefined,
												{ page: String(page), state },
											)}
										/>
									))}
								</div>
							)}
							{list && (
								<fieldset disabled={busy} className="min-w-0 border-0 p-0">
									<SalesPagination
										locale={locale}
										page={page}
										count={list.count}
										onPage={(nextPage) =>
											guard.choose(() =>
												router.push(
													salesHref(
														locale,
														"payments",
														seller,
														undefined,
														undefined,
														{ page: String(nextPage), state },
													),
												),
											)
										}
									/>
								</fieldset>
							)}
						</>
					) : (
						<>
							<nav
								aria-label={ol.status}
								className="flex max-w-full gap-1 overflow-x-auto border-0 border-b border-solid border-border"
							>
								{["", "unpaid", "partial", "paid", "overpaid", "overdue"].map(
									(value) => (
										<button
											key={value || "all"}
											type="button"
											aria-pressed={state === value}
											onClick={() =>
												guard.choose(() =>
													router.push(
														paymentHref(
															locale,
															context,
															undefined,
															seller,
															1,
															value,
														),
													),
												)
											}
											className={cn(
												"shrink-0 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-action",
												state === value
													? "border-action font-semibold text-action"
													: "border-transparent text-muted hover:text-foreground",
											)}
										>
											{value ? paymentState(locale, value) : t.all}
										</button>
									),
								)}
							</nav>
							<BuyerTableFrame
								locale={locale}
								title={t.title}
								count={list?.count ?? null}
								page={page}
								onPage={(next) =>
									guard.choose(() =>
										router.push(
											paymentHref(
												locale,
												context,
												undefined,
												seller,
												next,
												state,
											),
										),
									)
								}
								pageHref={(next) =>
									paymentHref(locale, context, undefined, seller, next, state)
								}
								onRefresh={() => void load().catch(() => {})}
								busy={!list && !error}
							>
								{!list && !error ? (
									<p
										role="status"
										className="m-0 px-5 py-10 text-sm text-muted"
									>
										{t.loading}
									</p>
								) : list && list.results.length === 0 ? (
									<div className="px-5 py-6">
										<EmptyState
											borderless
											icon="wallet"
											title={state ? sales.noMatches : t.empty}
											description={state ? sales.noMatchesHelp : undefined}
											action={
												state ? (
													<Button
														variant="outline"
														size="sm"
														className="rounded-lg"
														onClick={() =>
															guard.choose(() =>
																router.push(
																	paymentHref(
																		locale,
																		context,
																		undefined,
																		seller,
																		1,
																		"",
																	),
																),
															)
														}
													>
														{sales.clear}
													</Button>
												) : undefined
											}
										/>
									</div>
								) : list ? (
									<>
										<BuyerTableRegion
											label={t.title}
											minWidth="64rem"
											head={[
												ol.order,
												t.total,
												ol.status,
												t.effectiveDue,
												ol.actions,
											]}
										>
											{list.results.map((r) => (
												<tr key={r.id} className={buyerRow}>
													<td className={buyerCell}>{listIdentity(r)}</td>
													<td className={buyerCell}>{listAmounts(r)}</td>
													<td className={buyerCell}>{listBadges(r)}</td>
													<td
														className={`${buyerCell} whitespace-nowrap text-sm`}
													>
														<bdi>
															{r.effective_due_at
																? localTimestamp(r.effective_due_at, locale)
																: "—"}
														</bdi>
													</td>
													<td className="px-4 py-3 text-end align-top">
														<div className="flex items-center justify-end">
															{listMenu(r)}
														</div>
													</td>
												</tr>
											))}
										</BuyerTableRegion>
										<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
											{list.results.map((r) => (
												<li key={r.id} className="flex flex-col gap-3 p-4">
													<div className="flex items-start justify-between gap-3">
														{listIdentity(r)}
														{listMenu(r)}
													</div>
													<div className="grid grid-cols-1 gap-3 rounded-xl border border-solid border-border p-3 sm:grid-cols-2">
														{listAmounts(r)}
														<div className="flex flex-col gap-2">
															{listBadges(r)}
															<p className="m-0 text-xs text-muted">
																{t.effectiveDue}:{" "}
																<bdi>
																	{r.effective_due_at
																		? localTimestamp(r.effective_due_at, locale)
																		: "—"}
																</bdi>
															</p>
														</div>
													</div>
												</li>
											))}
										</ul>
									</>
								) : null}
							</BuyerTableFrame>
						</>
					))}
				{id && !row && !error && !noBusiness && (
					<p role="status">{t.loading}</p>
				)}
				{row && (
					<>
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-border bg-surface px-4 py-3">
							<span className="flex items-center gap-2 text-sm font-semibold">
								<RotateCcw className="size-4 text-muted" aria-hidden="true" />
								{ac.buyerTitle}
							</span>
							<Button
								variant="outline"
								size="sm"
								className="rounded-lg"
								asChild
							>
								<Link
									prefetch={false}
									href={aftercareHref(locale, context, row.id, row.seller)}
								>
									{ac.openWorkspace}
								</Link>
							</Button>
						</div>
						{row.capabilities.details ? (
							<>
								<div
									role="tablist"
									aria-label={t.title}
									className="flex max-w-full gap-1 overflow-x-auto border-0 border-b border-solid border-border"
								>
									{(
										[
											["overview", t.tabOverview],
											["receipts", t.tabReceipts],
											["history", t.history],
										] as [PaymentTab, string][]
									).map(([value, label]) => (
										<button
											key={value}
											type="button"
											role="tab"
											id={`payment-tab-${row.id}-${value}`}
											aria-selected={tab === value}
											aria-controls={`payment-panel-${row.id}-${value}`}
											onClick={() => setTab(value)}
											className={cn(
												"shrink-0 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-action",
												tab === value
													? "border-action font-semibold text-action"
													: "border-transparent text-muted hover:text-foreground",
											)}
										>
											{label}
											{value === "receipts" &&
												row.claims.length + row.receipts.length > 0 && (
													<span className="ms-1.5 rounded-full bg-info px-1.5 py-0.5 text-xs font-semibold text-action">
														<bdi>
															{nf.format(
																row.claims.length + row.receipts.length,
															)}
														</bdi>
													</span>
												)}
										</button>
									))}
								</div>
								{tab === "overview" && (
									<div
										role="tabpanel"
										id={`payment-panel-${row.id}-overview`}
										aria-labelledby={`payment-tab-${row.id}-overview`}
									>
										{buyerOverview}
									</div>
								)}
								{tab === "receipts" && (
									<div
										role="tabpanel"
										id={`payment-panel-${row.id}-receipts`}
										aria-labelledby={`payment-tab-${row.id}-receipts`}
										className="flex min-w-0 flex-col gap-4"
									>
										{buyerFacts}
										{buyerRecords}
									</div>
								)}
								{tab === "history" && (
									<div
										role="tabpanel"
										id={`payment-panel-${row.id}-history`}
										aria-labelledby={`payment-tab-${row.id}-history`}
									>
										{buyerHistory}
									</div>
								)}
							</>
						) : (
							<div className="flex min-w-0 flex-col gap-4">
								{buyerOverview}
								{buyerFacts}
							</div>
						)}
					</>
				)}
				{modal && (
					<ActionReview
						{...{ locale, context, selection, busy }}
						review={modal}
						liveRow={row}
						opener={opener.current}
						cancel={() => setModal(null)}
						confirm={() => void send(modal.packet)}
					/>
				)}
				{guard.feedback}
			</section>
		</SalesFrame>
	);
}
