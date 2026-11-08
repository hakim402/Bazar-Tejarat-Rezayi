"use client";
import Link from "next/link";
import { AftercareSection } from "../../aftercare/section";
import { fulfilmentHref } from "../../fulfilment/api";
import { fulfilmentCopy } from "../../fulfilment/copy";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
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
	control as defaultControl,
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
	SalesRelated,
	salesHref,
	salesHistoryHref,
	salesAction,
	salesControl,
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
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return (
			<SessionEntry locale={locale} context={context} error={session.error} />
		);
	const seller = context === "seller" ? (q.get("seller") ?? "") : "",
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
			{...{ locale, context, id, seller, page, state, attempt, scope }}
		/>
	);
}
function PaymentGroup({
	seller,
	title,
	children,
}: {
	seller: boolean;
	title: string;
	children: ReactNode;
}) {
	return seller ? (
		<section className="min-w-0 space-y-4 [&>form]:rounded-2xl [&>form]:shadow-sm [&>form]:sm:p-6 [&>form_button]:min-h-11 [&>form_button]:rounded-xl [&>form_button]:text-sm">
			<h2 className="text-lg font-bold tracking-tight">{title}</h2>
			{children}
		</section>
	) : (
		children
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
function Summary({
	locale,
	row,
	seller = false,
}: {
	locale: Locale;
	row: Payment;
	seller?: boolean;
}) {
	const t = paymentCopy[locale];
	if (seller)
		return (
			<section className={salesPanel}>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 space-y-1">
						<h2 className="text-xl font-bold">
							<bdi>{row.number}</bdi>
						</h2>
						<p className="text-sm text-muted">
							{paymentRole(locale, "buyer")}: <bdi>{row.buyer_name}</bdi>
						</p>
						<p className="text-sm text-muted">
							{sellerSalesCopy[locale].business}: <bdi>{row.seller_name}</bdi>
						</p>
					</div>
					<span className="rounded-full bg-info px-3 py-1.5 text-sm font-semibold text-action">
						{paymentState(locale, row.financial)}
					</span>
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
						<div
							key={label}
							className="min-w-0 rounded-xl border border-border bg-page p-3"
						>
							<dt className="text-xs text-muted">{label}</dt>
							<dd className="mt-2 break-all font-bold tabular-nums">
								<bdi>
									{value} {row.currency}
								</bdi>
							</dd>
						</div>
					))}
				</dl>
				<div className="flex flex-wrap gap-3 text-sm">
					<span>
						{t.method}: {paymentState(locale, row.payment_method)}
					</span>
					<span>
						{t.allocation}: {paymentState(locale, row.allocation)}
					</span>
					{row.overdue && <strong className="text-warning">{t.overdue}</strong>}
				</div>
				<dl className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
					<div>
						<dt className="text-xs text-muted">{t.originalDue}</dt>
						<dd className="mt-1">
							<bdi>
								{row.original_due_at
									? localTimestamp(row.original_due_at, locale)
									: "—"}
							</bdi>
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">{t.effectiveDue}</dt>
						<dd className="mt-1">
							<bdi>
								{row.effective_due_at
									? localTimestamp(row.effective_due_at, locale)
									: "—"}
							</bdi>{" "}
							· <bdi>v{row.deadline_generation}</bdi>
						</dd>
					</div>
				</dl>
				<p className="text-sm leading-relaxed text-muted">{t.noAutomatic}</p>
				<p className="text-xs text-muted">{t.inputTimezone}</p>
			</section>
		);
	return (
		<div className={defaultPanel}>
			<h2 className="text-xl font-bold">
				<bdi>{row.number}</bdi>
			</h2>
			<p>
				<bdi>{row.seller_name}</bdi>
			</p>
			<dl className="grid gap-4 sm:grid-cols-2 desktop:grid-cols-3">
				{(
					[
						[t.total, row.goods_total],
						[t.confirmed, row.confirmed_total],
						[t.remaining, row.remaining],
						[t.overpayment, row.overpayment],
					] as const
				).map(([label, value]) => (
					<div key={label}>
						<dt className="text-sm text-muted">{label}</dt>
						<dd className="font-bold break-all">
							<bdi>
								{value} {row.currency}
							</bdi>
						</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-wrap gap-3">
				<span className="rounded-control bg-info px-3 py-1">
					{paymentState(locale, row.financial)}
				</span>
				<span>
					{t.allocation}: {paymentState(locale, row.allocation)}
				</span>
				<span>
					{t.method}: {paymentState(locale, row.payment_method)}
				</span>
				{row.overdue && <strong className="text-warning">{t.overdue}</strong>}
			</div>
			<p>
				{t.originalDue}:{" "}
				<bdi>
					{row.original_due_at
						? localTimestamp(row.original_due_at, locale)
						: "—"}
				</bdi>
			</p>
			<p>
				{t.effectiveDue}:{" "}
				<bdi>
					{row.effective_due_at
						? localTimestamp(row.effective_due_at, locale)
						: "—"}
				</bdi>{" "}
				· v{row.deadline_generation}
			</p>
			<p className="text-sm text-muted">{t.noAutomatic}</p>
			<p className="text-sm text-muted">{t.inputTimezone}</p>
		</div>
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
}: {
	locale: Locale;
	context: Context;
	id?: string;
	seller: string;
	page: number;
	state: string;
	attempt: string | null;
	scope: string;
}) {
	const t = paymentCopy[locale],
		sales = sellerSalesCopy[locale],
		isSeller = context === "seller",
		action = isSeller ? salesAction : defaultAction,
		control = isSeller ? salesControl : defaultControl,
		panel = isSeller ? salesPanel : defaultPanel,
		params = useSearchParams(),
		router = useRouter();
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
					<h1 ref={title} tabIndex={-1} className="text-2xl font-bold">
						{t.title}
					</h1>
				)}
				{!online && <p role="status">{t.offline}</p>}
				{noBusiness && <SalesEmpty locale={locale} noBusiness />}
				{error && (
					<p role="alert" className="text-warning">
						{t.error}
					</p>
				)}
				{notice && <p role="status">{notice}</p>}
				{(intent || reference) && (
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
				)}
				<button
					type="button"
					className={action}
					disabled={busy}
					onClick={() => void load().catch(() => {})}
				>
					{t.refresh}
				</button>
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
							<label className="block">
								{t.all}
								<select
									className={control}
									value={state}
									onChange={(e) =>
										guard.choose(() =>
											router.push(
												paymentHref(
													locale,
													context,
													undefined,
													seller,
													1,
													e.target.value,
												),
											),
										)
									}
								>
									{["", "unpaid", "partial", "paid", "overpaid", "overdue"].map(
										(s) => (
											<option key={s} value={s}>
												{s ? paymentState(locale, s) : t.all}
											</option>
										),
									)}
								</select>
							</label>
							{!list ? (
								<p role="status">{t.loading}</p>
							) : !list.results.length ? (
								<p>{t.empty}</p>
							) : (
								list.results.map((r) => (
									<article key={r.id} className="space-y-3">
										<Summary locale={locale} row={r} />
										<Link
											className={action}
											href={paymentHref(locale, context, r.id, seller)}
										>
											{t.continue}
										</Link>
									</article>
								))
							)}
							<div className="flex flex-wrap gap-3">
								<button
									type="button"
									className={action}
									disabled={page <= 1}
									onClick={() =>
										guard.choose(() =>
											router.push(
												paymentHref(
													locale,
													context,
													undefined,
													seller,
													page - 1,
													state,
												),
											),
										)
									}
								>
									{t.previous}
								</button>
								<button
									type="button"
									className={action}
									disabled={!list || page * 20 >= list.count}
									onClick={() =>
										guard.choose(() =>
											router.push(
												paymentHref(
													locale,
													context,
													undefined,
													seller,
													page + 1,
													state,
												),
											),
										)
									}
								>
									{t.next}
								</button>
							</div>
						</>
					))}
				{id && !row && !error && !noBusiness && (
					<p role="status">{t.loading}</p>
				)}
				{row && (
					<>
						<Summary locale={locale} row={row} seller={isSeller} />
						<AftercareSection
							locale={locale}
							context={context}
							orderId={row.id}
							seller={row.seller}
						/>
						{isSeller ? (
							<SalesRelated
								locale={locale}
								seller={row.seller}
								links={[
									{ section: "orders", id: row.id },
									{ section: "invoices", id: row.invoice },
									{ section: "fulfilment", id: row.id },
								]}
							/>
						) : (
							<>
								<Link
									className={action}
									href={fulfilmentHref(locale, context, row.id, seller)}
								>
									{fulfilmentCopy[locale].buyerTitle}
								</Link>
								<Link
									className={action}
									href={invoiceHref(locale, context, row.invoice, seller)}
								>
									{t.invoice}
								</Link>
							</>
						)}
						<PaymentGroup
							seller={isSeller}
							title={`${t.receipts} · ${t.evidence}`}
						>
							<p className="text-sm text-muted">{t.claimNote}</p>
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
									onRemove={(id) => {
										setEvidence((e) => e.filter((x) => x !== id));
										setDirty(true);
									}}
								/>
							)}
							{(correction || replacement) && (
								<button
									type="button"
									className={action}
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
								</button>
							)}
							{row.capabilities.details && (
								<>
									<div className={panel}>
										<h3 className="font-bold">{t.claims}</h3>
										{row.claims.map((c) => (
											<article
												key={c.id}
												className="space-y-3 border-t border-border py-3"
											>
												<p>
													<bdi>
														{c.amount} {c.currency}
													</bdi>{" "}
													· {paymentState(locale, c.state)} · v{c.version} ·{" "}
													{paymentRole(locale, "buyer")}
												</p>
												<p>
													<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
												</p>
												<p className="whitespace-pre-wrap break-words">
													{c.description}
												</p>
												{c.reason && <p>{c.reason}</p>}
												<div className="flex flex-wrap gap-3">
													{row.capabilities.evidence &&
														c.evidence.map((e) => (
															<PaymentEvidence
																key={e}
																id={e}
																{...{ locale, context }}
															/>
														))}
												</div>
												{row.capabilities.claim &&
													["withdrawn", "rejected"].includes(c.state) &&
													!c.replacement && (
														<button
															type="button"
															className={action}
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
														</button>
													)}
												{c.state === "pending" && (
													<div className="space-y-3">
														<label className="block">
															{t.reason}
															<textarea
																className={control}
																maxLength={1000}
																disabled={blocked}
																value={reason}
																onChange={(e) => {
																	setReason(e.target.value);
																	setDirty(true);
																}}
															/>
														</label>
														<div className="flex flex-wrap gap-3">
															{(row.capabilities.claim
																? ["withdraw"]
																: row.capabilities.receipt
																	? ["confirm", "reject"]
																	: []
															).map((a) => (
																<button
																	type="button"
																	key={a}
																	className={action}
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
									</div>
									<div className={panel}>
										<h3 className="font-bold">{t.receipts}</h3>
										{row.receipts.map((r) => (
											<article
												key={r.id}
												className="space-y-3 border-t border-border py-3"
											>
												<p>
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
												<p>
													{t.review}: {paymentState(locale, r.review)} ·{" "}
													{paymentRole(locale, "seller")}
												</p>
												<p>
													<bdi>{localTimestamp(r.paid_at, locale)}</bdi>
												</p>
												<p className="whitespace-pre-wrap break-words">
													{r.description}
												</p>
												<div className="flex flex-wrap gap-3">
													{row.capabilities.evidence &&
														r.evidence.map((e) => (
															<PaymentEvidence
																key={e}
																id={e}
																{...{ locale, context }}
															/>
														))}
												</div>
												{row.capabilities.correction && (
													<button
														type="button"
														className={action}
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
													</button>
												)}
											</article>
										))}
									</div>
									<div className={panel}>
										<h3 className="font-bold">{t.corrections}</h3>
										<p>{t.correctionNote}</p>
										{row.corrections.map((c) => (
											<article
												key={c.id}
												className={
													isSeller
														? "space-y-2 border-t border-border pt-4 text-sm"
														: undefined
												}
											>
												<p>
													<bdi>
														{c.amount} {row.currency}
													</bdi>{" "}
													· {paymentState(locale, c.state)} · v
													{c.target_version}
												</p>
												<p>{c.reason}</p>
												<p>{c.description}</p>
												<p>
													<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
												</p>
												{row.capabilities.evidence &&
													c.evidence.map((e) => (
														<PaymentEvidence
															key={e}
															id={e}
															{...{ locale, context }}
														/>
													))}
											</article>
										))}
									</div>
								</>
							)}
						</PaymentGroup>
						{row.capabilities.details && (
							<>
								<PaymentGroup
									seller={isSeller}
									title={`${t.allocation} · ${t.deadlines}`}
								>
									{row.capabilities.selection &&
										selection &&
										!row.selection?.allocation && (
											<SelectionForm
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
									<div className={panel}>
										<h3 className="font-bold">{t.plans}</h3>
										{row.plans.map((p) => (
											<article
												key={p.id}
												className={
													isSeller
														? "space-y-2 border-t border-border pt-4 text-sm"
														: undefined
												}
											>
												<p>
													{paymentState(locale, p.state)} · {p.reason}
												</p>
												{p.lines.map((l, i) => (
													<p key={`${l.variant}:${l.batch ?? i}`}>
														<bdi>{l.sku}</bdi> · {t.batch}:{" "}
														<bdi>{l.batch_code || "—"}</bdi> · {t.quantity}:{" "}
														<bdi>
															{l.quantity} {l.unit_labels[locale] ?? l.unit}
														</bdi>
													</p>
												))}
											</article>
										))}
									</div>
									{row.capabilities.extension && (
										<form
											className={panel}
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
											<h3 className="font-bold">{t.extend}</h3>
											<fieldset disabled={blocked} className="space-y-3">
												<label className="block">
													{t.laterDue}
													<input
														type="datetime-local"
														required
														className={control}
														value={due}
														onChange={(e) => {
															setDue(e.target.value);
															setDirty(true);
														}}
													/>
												</label>
												<label className="block">
													{t.reason}
													<textarea
														required
														minLength={3}
														maxLength={1000}
														className={control}
														value={reason}
														onChange={(e) => {
															setReason(e.target.value);
															setDirty(true);
														}}
													/>
												</label>
												<button type="submit" className={action}>
													{t.exact}
												</button>
											</fieldset>
										</form>
									)}
									<div className={panel}>
										<h3 className="font-bold">{t.deadlines}</h3>
										{row.extensions.map((e) => (
											<p
												key={e.id}
												className={
													isSeller
														? "border-s-2 border-border ps-3 text-sm leading-relaxed"
														: undefined
												}
											>
												<bdi>
													{localTimestamp(e.before_at, locale)} →{" "}
													{localTimestamp(e.due_at, locale)}
												</bdi>{" "}
												· {e.reason}
											</p>
										))}
									</div>
									<div className={panel}>
										<h3 className="font-bold">{t.cases}</h3>
										{row.cases.map((c) => (
											<p key={c.id}>
												{paymentState(locale, c.kind)} ·{" "}
												{paymentState(locale, c.state)}
											</p>
										))}
									</div>
								</PaymentGroup>
								<PaymentGroup seller={isSeller} title={sales.history}>
									<div className={panel}>
										{isSeller ? (
											<p className="text-sm text-muted">
												{sales.results}:{" "}
												<bdi className="font-semibold tabular-nums text-foreground">
													{new Intl.NumberFormat(locale).format(
														row.history_count,
													)}
												</bdi>{" "}
												· {sales.page}{" "}
												<bdi>{new Intl.NumberFormat(locale).format(page)}</bdi>
											</p>
										) : (
											<h3 className="font-bold">{t.history}</h3>
										)}
										{row.history.map((e) => (
											<p
												key={e.id}
												className={
													isSeller
														? "border-s-2 border-border ps-3 text-sm leading-relaxed"
														: undefined
												}
											>
												v{e.version} ·{" "}
												{paymentState(locale, e.action.replace(/^case_/, ""))} ·{" "}
												<bdi>
													{localTimestamp(e.created_at, locale)} ·{" "}
													{paymentRole(locale, e.context)}
												</bdi>
											</p>
										))}
										<div className="flex flex-wrap gap-3">
											<button
												type="button"
												className={action}
												disabled={page <= 1 || blocked}
												onClick={() =>
													guard.choose(() =>
														router.push(
															isSeller
																? salesHistoryHref(
																		paymentHref(
																			locale,
																			context,
																			id,
																			seller,
																			page - 1,
																		),
																		params,
																	)
																: paymentHref(
																		locale,
																		context,
																		id,
																		seller,
																		page - 1,
																	),
														),
													)
												}
											>
												{t.previous}
											</button>
											<button
												type="button"
												className={action}
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
													guard.choose(() =>
														router.push(
															isSeller
																? salesHistoryHref(
																		paymentHref(
																			locale,
																			context,
																			id,
																			seller,
																			page + 1,
																		),
																		params,
																	)
																: paymentHref(
																		locale,
																		context,
																		id,
																		seller,
																		page + 1,
																	),
														),
													)
												}
											>
												{t.next}
											</button>
										</div>
									</div>
								</PaymentGroup>
							</>
						)}
					</>
				)}
				{modal && (
					<ActionReview
						{...{ locale, context, selection, busy }}
						review={modal}
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
