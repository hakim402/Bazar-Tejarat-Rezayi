"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	MessageSquare,
	MoreHorizontal,
	Package,
	RotateCcw,
	ShieldX,
} from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { Icon } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import type { QueryReader } from "../../../lib/routes/account-routes";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { commerceCopy } from "../../orders/copy";
import { ProductThumbnail } from "../../orders/components/order-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { localTimestamp, threadHref } from "../../messaging/api";
import { accessLost } from "../../messaging/hooks";
import {
	SalesRelated,
	salesAction,
	salesControl,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { negotiationCopy } from "../copy";
import { sellerNegotiationCopy } from "../seller-copy";
import {
	negotiation,
	ensureConversation,
	getIntent,
	retain,
	settle,
	reference,
	productContext,
	productText,
	productImage,
	type RequestRow,
	type Proposal,
	type Line,
	type Pending,
	type Result,
	type FinalPreviewResult,
} from "../api";
import { goodsTotal, lineCents, moneyText, validateLines } from "../validation";
import { NegotiationFailure } from "./failure";
import { Confirmation } from "./confirmation";
import { FinalizationReview } from "./finalization-review";
import { History } from "./history";
import toast from "react-hot-toast";

export function RequestDetail({
	locale,
	id,
	seller,
	params,
	back,
	attempt,
	scope,
}: {
	locale: Locale;
	id: string;
	seller: string;
	params: QueryReader;
	back: string;
	attempt: string | null;
	scope: string;
}) {
	const t = negotiationCopy[locale],
		s = sellerNegotiationCopy[locale],
		router = useRouter(),
		search = useSearchParams(),
		historyPage = Number(search.get("history_page") ?? 1),
		[row, setRow] = useState<RequestRow | null>(null),
		[error, setError] = useState<unknown>(null),
		[ready, setReady] = useState(false),
		[busy, setBusy] = useState(false),
		[intent, setIntent] = useState<Pending | undefined>(() => getIntent(scope)),
		[referenceOnly, setReferenceOnly] = useState(!!attempt && !getIntent(scope)),
		[result, setResult] = useState<Result | null>(null),
		[value, setValue] = useState<Proposal | null>(null),
		[reason, setReason] = useState(""),
		[step, setStep] = useState(1),
		[dirty, setDirty] = useState(false),
		[reload, setReload] = useState(0),
		[finalReview, setFinalReview] = useState<{
			packet: Pending;
			preview: FinalPreviewResult;
			currency: string;
		} | null>(null),
		[confirmation, setConfirmation] = useState<string | null>(null),
		[confirmationKey, setConfirmationKey] = useState(0),
		[messagingBusy, setMessagingBusy] = useState(false);
	const guard = useCommerceGuard(locale, dirty || !!intent || referenceOnly),
		blocked = busy || !!intent || referenceOnly,
		live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		focus = useRef<HTMLElement | null>(null),
		modalToken = useRef(0),
		commandKey = intent?.key ?? attempt;
	useEffect(() => {
		const mine = {};
		live.current = mine;
		const controller = new AbortController();
		setReady(false);
		void negotiation<RequestRow>(
			"seller",
			`negotiations/${id}/?locale=${locale}&history_page=${historyPage}${seller ? `&seller=${seller}` : ""}`,
			undefined,
			controller.signal,
		)
			.then((data) => {
				if (live.current !== mine) return;
				if (!seller) {
					router.replace(
						salesHref(locale, "negotiations", data.seller, id, params) +
							(historyPage > 1 ? `&history_page=${historyPage}` : "") +
							(attempt ? `&negotiation_command=${attempt}` : ""),
					);
					return;
				}
				setRow(data);
				setValue(structuredClone(data.proposal));
				setReady(true);
				setError(null);
			})
			.catch((e) => {
				if (live.current === mine) {
					setError(e);
					setReady(false);
					setRow(null);
				}
			});
		return () => {
			live.current = null;
			owned.current = null;
			controller.abort();
		};
		// identity/request/locale own this load.
	}, [reload, id, seller, locale, historyPage, router, attempt]);
	function done(next: Result) {
		setFinalReview(null);
		setConfirmation(null);
		if (next.pending) {
			setResult(next);
			setDirty(false);
			return;
		}
		settle(scope);
		setIntent(undefined);
		setReferenceOnly(false);
		reference(null);
		setResult(next);
		setDirty(false);
		setReload((v) => v + 1);
	}
	async function send(action: string, confirm = false) {
		if (owned.current || !row) return;
		if (action === "finalize" && !confirm && !intent)
			focus.current = document.activeElement as HTMLElement;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		setError(null);
		try {
			let packet = intent;
			if (!packet && action === "finalize" && confirm) {
				if (!finalReview) throw Error("review");
				packet = retain(scope, finalReview.packet);
				setIntent(packet);
				reference(packet.key);
			}
			if (!packet) {
				if (reason.trim().length < 3) throw Error("reason");
				if (action === "finalize" && (!value || !validateLines(value.lines)))
					throw Error("limits");
				const key = crypto.randomUUID();
				const body: Record<string, unknown> =
					action === "finalize"
						? {
								command_id: key,
								version: row.version,
								reason: reason.trim(),
								lines: value!.lines.map((line) => ({
									variant: line.variant,
									tier: line.tier,
									quantity: line.quantity,
									unit_price: line.unit_price,
								})),
								choice: value!.choice,
							}
						: { command_id: key, version: row.version, reason: reason.trim() };
				const path = `negotiations/${row.id}/${action}/`;
				if (action === "finalize" && !confirm) {
					const preview = await negotiation<FinalPreviewResult>(
						"seller",
						`negotiations/${row.id}/finalize/review/`,
						body,
					);
					if (live.current === mine) {
						if (
							!preview.proposal ||
							!preview.final ||
							preview.version !== row.version
						)
							throw Error("review");
						setFinalReview(
							structuredClone({
								packet: { key, path, body, kind: "action" as const },
								preview,
								currency: row.currency,
							}),
						);
						setConfirmationKey(++modalToken.current);
						setConfirmation("finalize");
					}
					return;
				}
				packet = retain(scope, { key, path, body, kind: "action" });
				setIntent(packet);
				reference(key);
			}
			const next = await negotiation<Result>("seller", packet.path, packet.body);
			if (live.current === mine) done(next);
		} catch (e) {
			if (live.current === mine) {
				setError(e);
				setConfirmation(null);
				setFinalReview(null);
				if (accessLost(e)) {
					setReady(false);
					setRow(null);
				}
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function recover() {
		if (owned.current || !commandKey) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		try {
			const next = await negotiation<Result>(
				"seller",
				`negotiations/${id}/commands/${commandKey}/reconcile/`,
				{},
			);
			if (live.current === mine) done(next);
		} catch (e) {
			if (live.current === mine) setError(e);
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	function prompt(action: string, opener: HTMLElement) {
		focus.current = opener;
		setConfirmationKey(++modalToken.current);
		setConfirmation(action);
	}
	async function message() {
		if (!row || messagingBusy) return;
		if (row.conversation) {
			router.push(threadHref(locale, "seller", row.conversation, row.seller));
			return;
		}
		if (!row.can_message) return;
		setMessagingBusy(true);
		try {
			const next = await ensureConversation("seller", row.id);
			router.push(threadHref(locale, "seller", next.conversation, next.seller));
		} catch (e) {
			if (accessLost(e)) {
				setReady(false);
				setRow(null);
			} else toast.error(s.conversationError);
		} finally {
			setMessagingBusy(false);
		}
	}
	if (error && !row) return <NegotiationFailure locale={locale} error={error} />;
	if (!row || !value)
		return (
			<p role="status" aria-busy={!ready} className={salesPanel}>
				{s.loading}
			</p>
		);
	const canFinalize = row.actions.includes("finalize"),
		canChange = row.actions.includes("request-correction"),
		canDecline = row.actions.includes("reject"),
		readOnly = !row.actions.length,
		terminal = ["accepted", "rejected", "withdrawn"].includes(row.state);
	const stages = [s.stageReview, s.stageTerms, s.stageConfirm];
	const active =
		row.state === "accepted" ? 3 : row.state === "submitted" ? step : 1;
	const valid = validateLines(value.lines);
	return (
		<div className="min-w-0 space-y-5" data-testid="seller-negotiation">
			<header className="min-w-0 space-y-3">
				<Link
					href={back}
					className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action"
				>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{s.backToRequests}
				</Link>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1.5">
						<h1 className="text-xl font-bold tracking-tight" tabIndex={-1}>
							{t.request} · <bdi>{row.id}</bdi>
						</h1>
						<p className="m-0 text-sm text-muted">
							{s.customer}: <span dir="auto">{row.buyer}</span>
						</p>
						<p className="m-0 text-xs text-muted">
							<bdi>{localTimestamp(row.created_at, locale)}</bdi>
						</p>
						<div className="flex flex-wrap items-center gap-2 pt-1">
							<StatusPill locale={locale} state={row.state} />
						</div>
					</div>
					<div className="flex flex-wrap items-start gap-2">
						{(row.can_message || row.conversation) && (
							<Button
								variant="outline"
								className="rounded-xl"
								disabled={messagingBusy}
								onClick={() => void message()}
							>
								<MessageSquare className="size-4" aria-hidden="true" />
								{messagingBusy ? s.conversationOpening : s.messageCustomer}
							</Button>
						)}
						{(canDecline || canChange) && (
							<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										aria-label={s.moreActions}
										title={s.moreActions}
										className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
									>
										<MoreHorizontal className="size-5" aria-hidden="true" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" sideOffset={6} className="w-56 rounded-xl p-1.5">
									{canChange && (
										<DropdownMenuItem
											className="gap-2.5"
											onSelect={() => setConfirmation("request-correction")}
										>
											<RotateCcw aria-hidden="true" />
											{s.requestChanges}
										</DropdownMenuItem>
									)}
									{canDecline && (
										<DropdownMenuItem
											className="gap-2.5 text-danger"
											onSelect={() => setConfirmation("reject")}
										>
											<ShieldX aria-hidden="true" />
											{s.decline}
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</div>
			</header>

			{guard.feedback}
			<NegotiationFailure locale={locale} error={error} />
			{commandKey && (intent || referenceOnly) && (
				<section className={salesPanel} role="status">
					<p>{result?.pending ? commerceCopy[locale].pending : t.pending}</p>
					<button
						type="button"
						className={salesAction}
						disabled={busy}
						onClick={() => void recover()}
					>
						{t.recover}
					</button>
				</section>
			)}

			<section className={salesPanel}>
				<ProgressSteps locale={locale} stages={stages} active={active} terminal={terminal} />
			</section>

			{result && !result.pending && (
				<section className={salesPanel} role="status">
					<p className="m-0 text-sm font-semibold">
						{result.state && result.state in t
							? t[result.state as keyof typeof t]
							: t.error}
					</p>
				</section>
			)}

			<StageCard
				index={1}
				title={s.stageReview}
				status={step > 1 || terminal ? "done" : "current"}
			>
				<ReviewStage
					locale={locale}
					row={row}
					state={row.state}
					canFinalize={canFinalize}
					canChange={canChange}
					canDecline={canDecline}
					blocked={blocked}
					onTerms={() => setStep(2)}
					onChange={(el) => prompt("request-correction", el)}
					onDecline={(el) => prompt("reject", el)}
					onMessage={() => void message()}
					messagingBusy={messagingBusy}
				/>
			</StageCard>

			{row.state === "submitted" && step >= 2 && (
				<StageCard index={2} title={s.stageTerms} status={step > 2 ? "done" : "current"}>
					<TermsStage
						locale={locale}
						row={row}
						value={value}
						blocked={blocked}
						onChange={(next) => {
							setValue(next);
							setDirty(true);
						}}
						onBack={() => setStep(1)}
						onContinue={() => setStep(3)}
						valid={valid}
					/>
				</StageCard>
			)}

			{row.state === "submitted" && step >= 3 && (
				<StageCard index={3} title={s.stageConfirm} status="current">
					<ConfirmStage
						locale={locale}
						row={row}
						value={value}
						reason={reason}
						blocked={blocked}
						valid={valid}
						onReason={(next) => {
							setReason(next);
							setDirty(true);
						}}
						onBack={() => setStep(2)}
						onFinalize={() => void send("finalize")}
					/>
				</StageCard>
			)}

			{row.state === "correction_requested" && (
				<section className={salesPanel} role="status">
					<p className="m-0 text-sm font-medium text-warning">{s.awaitingCustomer}</p>
					<p className="m-0 text-sm text-muted">{t.correction_requested}</p>
				</section>
			)}
			{row.state === "accepted" && (
				<section className={salesPanel}>
					<p className="m-0 text-sm">{t.acceptedNotice}</p>
					{(row.order || row.invoice) && (
						<SalesRelated
							locale={locale}
							seller={seller}
							links={[
								...(row.order
									? [{ section: "orders" as const, id: row.order }]
									: []),
								...(row.invoice
									? [{ section: "invoices" as const, id: row.invoice }]
									: []),
							]}
						/>
					)}
				</section>
			)}
			{readOnly && row.state !== "accepted" && (
				<p className="m-0 text-sm text-muted">{t.readonly}</p>
			)}

			<details className="rounded-2xl border border-border bg-surface shadow-xs">
				<summary className="cursor-pointer px-4 py-3.5 text-sm font-semibold sm:px-5">
					{sellerSalesCopy[locale].history}
				</summary>
				<div className="px-4 pb-4 sm:px-5">
					<History
						{...{ locale, row, context: "seller" as const, seller }}
						presentation="seller"
						params={params}
						embedded
					/>
				</div>
			</details>

			<p className="m-0 text-xs text-muted">{t.noExpiry}</p>

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
					{confirmation === "finalize" ? (
						<>
							<p className="text-sm">{t.finalNotice}</p>
							{finalReview && (
								<FinalizationReview
									locale={locale}
									currency={finalReview.currency}
									presentation="seller"
									preview={finalReview.preview}
									reason={String(finalReview.packet.body.reason)}
								/>
							)}
							<button
								type="button"
								className={salesAction}
								disabled={busy || !finalReview}
								onClick={() => void send("finalize", true)}
							>
								{t.finalize}
							</button>
						</>
					) : (
						<>
							<p className="text-sm">
								{confirmation === "reject" ? s.decline : s.requestChanges}
							</p>
							<ReasonField
								locale={locale}
								value={reason}
								disabled={busy}
								onChange={setReason}
							/>
							<button
								type="button"
								className={salesAction}
								disabled={busy || reason.trim().length < 3}
								onClick={() => void send(confirmation)}
							>
								{t.confirm}
							</button>
						</>
					)}
					<button
						type="button"
						className={salesAction}
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
		</div>
	);
}

function StatusPill({ locale, state }: { locale: Locale; state: string }) {
	const t = negotiationCopy[locale];
	const tone =
		state === "accepted"
			? "bg-success-surface text-success"
			: state === "correction_requested"
				? "bg-warning-surface text-warning"
				: state === "rejected"
					? "bg-danger-surface text-danger"
					: state === "withdrawn"
						? "bg-page text-muted"
						: "bg-info text-action";
	return (
		<Badge variant="secondary" className={cn("whitespace-normal border-0", tone)}>
			{t[state as keyof typeof t] ?? state}
		</Badge>
	);
}

function ProgressSteps({
	locale,
	stages,
	active,
	terminal,
}: {
	locale: Locale;
	stages: string[];
	active: number;
	terminal: boolean;
}) {
	const s = sellerNegotiationCopy[locale];
	return (
		<ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
			{stages.map((label, i) => {
				const n = i + 1,
					done = n < active || (terminal && n <= active),
					current = n === active && !terminal;
				return (
					<li key={label} className="flex items-center gap-2">
						{i > 0 && (
							<ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
						)}
						<span
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
								done
									? "bg-success-surface text-success"
									: current
										? "bg-info text-action"
										: "bg-page text-muted",
							)}
						>
							{done ? (
								<Check className="size-3.5" aria-hidden="true" />
							) : (
								<span
									className={cn(
										"flex size-4 items-center justify-center rounded-full text-[10px]",
										current ? "bg-action text-white" : "bg-muted text-white",
									)}
									aria-hidden="true"
								>
									{n}
								</span>
							)}
							{label}
							<span className="sr-only">
								{done ? s.completed : current ? s.currentStep : s.upcoming}
							</span>
						</span>
					</li>
				);
			})}
		</ol>
	);
}

function StageCard({
	index,
	title,
	status,
	children,
}: {
	index: number;
	title: string;
	status: "done" | "current";
	children: ReactNode;
}) {
	const header = (
		<div className="flex items-center gap-3">
			<span
				className={cn(
					"flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
					status === "done" ? "bg-success-surface text-success" : "bg-info text-action",
				)}
				aria-hidden="true"
			>
				{status === "done" ? <Check className="size-3.5" /> : index}
			</span>
			<h2 className="text-base font-semibold">{title}</h2>
			{status === "done" && <Check className="size-4 text-success" aria-hidden="true" />}
		</div>
	);
	if (status === "done")
		return (
			<details className={salesPanel}>
				<summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
					{header}
				</summary>
				<div className="pt-4">{children}</div>
			</details>
		);
	return (
		<section className={cn(salesPanel, "space-y-4")}>
			{header}
			{children}
		</section>
	);
}

function ProductRow({
	locale,
	row,
	line,
	index,
}: {
	locale: Locale;
	row: RequestRow;
	line: Line;
	index: number;
}) {
	const product = productContext(row.proposal, line.variant, index),
		text = productText(product, locale, line.variant),
		sku = String(product?.sku ?? "");
	return (
		<div className="flex min-w-0 items-start gap-3">
			<ProductThumbnail src={productImage(product)} className="size-14" />
			<div className="min-w-0 flex-1 space-y-1.5">
				<p className="m-0 break-words text-sm font-semibold" dir="auto">
					{text.title}
				</p>
				<p className="m-0 text-xs text-muted">
					{commerceCopy[locale][line.tier]}
					{sku && (
						<>
							<span className="mx-1.5" aria-hidden="true">
								·
							</span>
							<bdi>{sku}</bdi>
						</>
					)}
					<span className="mx-1.5" aria-hidden="true">
						·
					</span>
					{text.unit}
				</p>
				<dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div>
						<dt className="text-xs text-muted">{negotiationCopy[locale].quantity}</dt>
						<dd className="m-0 text-sm font-medium">
							<bdi>{line.quantity}</bdi>
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">{negotiationCopy[locale].offer}</dt>
						<dd className="m-0 text-sm font-medium">
							<bdi>
								{line.unit_price} {row.currency}
							</bdi>
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">{negotiationCopy[locale].maxQuantity}</dt>
						<dd className="m-0 text-sm font-medium">
							<bdi>{line.max_quantity}</bdi>
						</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">{negotiationCopy[locale].maxPrice}</dt>
						<dd className="m-0 text-sm font-medium">
							<bdi>
								{line.max_unit_price} {row.currency}
							</bdi>
						</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}

function ReviewStage({
	locale,
	row,
	state,
	canFinalize,
	canChange,
	canDecline,
	blocked,
	onTerms,
	onChange,
	onDecline,
	onMessage,
	messagingBusy,
}: {
	locale: Locale;
	row: RequestRow;
	state: string;
	canFinalize: boolean;
	canChange: boolean;
	canDecline: boolean;
	blocked: boolean;
	onTerms: () => void;
	onChange: (el: HTMLElement) => void;
	onDecline: (el: HTMLElement) => void;
	onMessage: () => void;
	messagingBusy: boolean;
}) {
	const t = negotiationCopy[locale],
		s = sellerNegotiationCopy[locale],
		choice = row.proposal.choice,
		incomplete = !choice.method || !choice.country || !choice.city;
	return (
		<div className="space-y-4">
			<ul className="m-0 space-y-4 p-0">
				{row.proposal.lines.map((line, i) => (
					<li key={`${line.variant}:${line.tier}`}>
						<ProductRow locale={locale} row={row} line={line} index={i} />
					</li>
				))}
			</ul>
			<p className="m-0 text-sm font-semibold">
				{t.amount}: <bdi>{goodsTotal(row.proposal.lines)} {row.currency}</bdi>
			</p>
			<dl className="grid gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-3">
				<div>
					<dt className="text-xs text-muted">{s.destination}</dt>
					<dd className="m-0 font-medium">
						<bdi>{choice.country || "—"}</bdi>
						{choice.city && <span dir="auto"> · {choice.city}</span>}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">{t.method}</dt>
					<dd className="m-0 font-medium">
						{choice.method ? t[choice.method] : "—"}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">{t.version}</dt>
					<dd className="m-0 font-medium">
						<bdi>{row.version}</bdi>
					</dd>
				</div>
			</dl>
			{row.proposal.note && (
				<p className="m-0 whitespace-pre-wrap rounded-xl bg-info p-3 text-sm" dir="auto">
					{row.proposal.note}
				</p>
			)}
			{incomplete && (
				<p role="status" className="m-0 flex items-start gap-2 text-sm text-warning">
					<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					{s.missingInfo}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{(row.can_message || row.conversation) && (
					<Button
						variant="outline"
						className="rounded-xl"
						disabled={blocked || messagingBusy}
						onClick={onMessage}
					>
						<MessageSquare className="size-4" aria-hidden="true" />
						{s.messageCustomer}
					</Button>
				)}
				{canChange && (
					<button
						type="button"
						className={salesAction}
						disabled={blocked}
						onClick={(e) => onChange(e.currentTarget)}
					>
						<RotateCcw className="size-4" aria-hidden="true" />
						{s.requestChanges}
					</button>
				)}
				{canDecline && (
					<button
						type="button"
						className={salesAction}
						disabled={blocked}
						onClick={(e) => onDecline(e.currentTarget)}
					>
						<ShieldX className="size-4" aria-hidden="true" />
						{s.decline}
					</button>
				)}
				{canFinalize && state === "submitted" && (
					<button type="button" className={salesAction} disabled={blocked} onClick={onTerms}>
						<Package className="size-4" aria-hidden="true" />
						{s.continueTerms}
					</button>
				)}
			</div>
		</div>
	);
}

function TermsStage({
	locale,
	row,
	value,
	blocked,
	onChange,
	onBack,
	onContinue,
	valid,
}: {
	locale: Locale;
	row: RequestRow;
	value: Proposal;
	blocked: boolean;
	onChange: (value: Proposal) => void;
	onBack: () => void;
	onContinue: () => void;
	valid: boolean;
}) {
	const t = negotiationCopy[locale],
		s = sellerNegotiationCopy[locale];
	const setLine = (index: number, key: "quantity" | "unit_price", raw: string) =>
		onChange({
			...value,
			lines: value.lines.map((line, i) =>
				i === index ? { ...line, [key]: raw } : line,
			),
		});
	return (
		<div className="space-y-4">
			<p className="m-0 text-sm text-muted">{s.choiceLocked}</p>
			<div className="space-y-4">
				{value.lines.map((line, i) => {
					const product = productContext(row.proposal, line.variant, i),
						text = productText(product, locale, line.variant),
						increment = String(product?.increment ?? ""),
						minimum = String(product?.minimum ?? "");
					return (
						<fieldset
							key={`${line.variant}:${line.tier}`}
							disabled={blocked}
							className="space-y-3 rounded-xl border border-border p-4"
						>
							<legend className="max-w-full break-words px-2 text-sm font-semibold">
								<span dir="auto">{text.title}</span> · {commerceCopy[locale][line.tier]}
							</legend>
							<p className="m-0 text-xs text-muted">
								<bdi>{text.unit}</bdi> · {commerceCopy[locale].increment}:{" "}
								<bdi>{increment}</bdi>
								{line.tier === "wholesale" && minimum && (
									<>
										{" "}
										· {commerceCopy[locale].minimum}: <bdi>{minimum}</bdi>
									</>
								)}
							</p>
							<div className="grid gap-3 sm:grid-cols-2">
								<label className="grid gap-1.5">
									{t.quantity} · {commerceCopy[locale][line.tier]}
									<input
										className={salesControl}
										dir="ltr"
										inputMode="decimal"
										maxLength={12}
										value={line.quantity}
										onChange={(e) => setLine(i, "quantity", e.target.value)}
										aria-invalid={!valid}
									/>
									<span className="text-xs text-muted">
										{t.maxQuantity}: <bdi>{line.max_quantity}</bdi>
									</span>
								</label>
								<label className="grid gap-1.5">
									{t.offer} · {row.currency}
									<input
										className={salesControl}
										dir="ltr"
										inputMode="decimal"
										maxLength={12}
										value={line.unit_price}
										onChange={(e) => setLine(i, "unit_price", e.target.value)}
										aria-invalid={!valid}
									/>
									<span className="text-xs text-muted">
										{t.maxPrice}: <bdi>{line.max_unit_price}</bdi>
									</span>
								</label>
							</div>
							<p className="m-0 rounded-lg bg-info p-2.5 text-sm font-semibold">
								{commerceCopy[locale].goods}:{" "}
								<bdi>
									{moneyText(lineCents(line))} {row.currency}
								</bdi>
							</p>
						</fieldset>
					);
				})}
			</div>
			<p className="m-0 text-sm font-semibold">
				{t.amount}: <bdi>{goodsTotal(value.lines)} {row.currency}</bdi>
			</p>
			{!valid && (
				<p role="alert" className="m-0 text-sm text-warning">
					{s.enterValid}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<button type="button" className={salesAction} disabled={blocked} onClick={onBack}>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{s.backToRequests}
				</button>
				<button
					type="button"
					className={salesAction}
					disabled={blocked || !valid}
					onClick={onContinue}
				>
					{s.continueConfirm}
					<ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}

function ConfirmStage({
	locale,
	row,
	value,
	reason,
	blocked,
	valid,
	onReason,
	onBack,
	onFinalize,
}: {
	locale: Locale;
	row: RequestRow;
	value: Proposal;
	reason: string;
	blocked: boolean;
	valid: boolean;
	onReason: (v: string) => void;
	onBack: () => void;
	onFinalize: () => void;
}) {
	const t = negotiationCopy[locale],
		s = sellerNegotiationCopy[locale],
		choice = value.choice;
	return (
		<div className="space-y-4">
			<h3 className="m-0 text-sm font-semibold">{s.summary}</h3>
			<ul className="m-0 space-y-2 p-0">
				{value.lines.map((line, i) => {
					const product = productContext(value, line.variant, i),
						text = productText(product, locale, line.variant);
					return (
						<li
							key={`${line.variant}:${line.tier}`}
							className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
						>
							<span className="min-w-0 break-words" dir="auto">
								{text.title} · <bdi>{line.quantity}</bdi> {text.unit} ×{" "}
								<bdi>
									{line.unit_price} {row.currency}
								</bdi>
							</span>
							<bdi className="font-semibold">
								{moneyText(lineCents(line))} {row.currency}
							</bdi>
						</li>
					);
				})}
			</ul>
			<p className="m-0 text-sm font-semibold">
				{t.amount}: <bdi>{goodsTotal(value.lines)} {row.currency}</bdi>
			</p>
			<dl className="grid gap-3 text-sm sm:grid-cols-2">
				<div>
					<dt className="text-xs text-muted">{s.destination}</dt>
					<dd className="m-0 font-medium">
						<bdi>{choice.country || "—"}</bdi>
						{choice.city && <span dir="auto"> · {choice.city}</span>}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">{t.method}</dt>
					<dd className="m-0 font-medium">
						{choice.method ? t[choice.method] : "—"}
					</dd>
				</div>
			</dl>
			<p className="m-0 rounded-xl bg-info p-3 text-sm leading-relaxed">
				{t.finalNotice}
			</p>
			<ReasonField locale={locale} value={reason} disabled={blocked} onChange={onReason} />
			<div className="flex flex-wrap gap-2">
				<button type="button" className={salesAction} disabled={blocked} onClick={onBack}>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{s.stageTerms}
				</button>
				<button
					type="button"
					className={salesAction}
					disabled={blocked || !valid || reason.trim().length < 3}
					onClick={onFinalize}
				>
					{t.finalize}
				</button>
			</div>
		</div>
	);
}

function ReasonField({
	locale,
	value,
	disabled,
	onChange,
}: {
	locale: Locale;
	value: string;
	disabled: boolean;
	onChange: (v: string) => void;
}) {
	const t = negotiationCopy[locale],
		s = sellerNegotiationCopy[locale],
		chips = [s.reasonOutOfStock, s.reasonPrice, s.reasonDelivery];
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				{chips.map((chip) => (
					<button
						key={chip}
						type="button"
						className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted hover:border-action hover:text-action"
						disabled={disabled}
						onClick={() => onChange(chip)}
					>
						{chip}
					</button>
				))}
			</div>
			<label className="grid gap-1.5">
				{t.reason}
				<textarea
					aria-label={t.reason}
					dir="auto"
					required
					minLength={3}
					maxLength={1000}
					className={salesControl}
					value={value}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				/>
			</label>
		</div>
	);
}
