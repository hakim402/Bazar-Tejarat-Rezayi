"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
	ChevronLeft,
	FileText,
	RefreshCw,
	Shield,
	ShoppingBag,
	Truck,
	Wallet,
} from "lucide-react";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/shadcn/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Icon, type IconName } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { cn } from "../../../lib/shadcn-utils";
import { AccountError } from "../../../lib/api/private-client";
import { localTimestamp } from "../../messaging/api";
import { ReportForm } from "../../messaging/components/report";
import { invoiceHref } from "../../orders/api";
import { orderListCopy } from "../../orders/list-copy";
import { BuyerRowMenu } from "../../orders/components/buyer-ui";
import { DetailDialog } from "../../orders/components/detail-dialog";
import {
	DetailCard,
	DetailField,
	Money,
	ProductThumbnail,
} from "../../orders/components/order-ui";
import { fulfilmentHref } from "../../fulfilment/api";
import { paymentHref } from "../../payments/api";
import { aftercareHref, disputeHref } from "../api";
import { aftercareCopy, aftercareState } from "../copy";
import { availableModes, modeLabel } from "../draft";
import type {
	Context,
	Domain,
	Line,
	Mode,
	Reviewed,
	Workspace,
} from "../types";
import type { useAftercareData } from "../use-data";
import type { useAftercareCommand } from "../use-command";
import {
	DeliveryRefundHistory,
	GoodsRefundHistory,
	OrderHistory,
} from "./history";
import { AftercareActionForm } from "./action-form";
import { AftercareReview } from "./review";
import { AftercareEvidence } from "./evidence";

type Tab = "overview" | "requests" | "history";

function ActionCard({
	icon,
	title,
	badge,
	body,
	time,
	children,
}: {
	icon?: IconName;
	title?: string;
	badge?: ReactNode;
	body?: ReactNode;
	time?: string;
	children?: ReactNode;
}) {
	return (
		<article className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
			<div className="flex items-start gap-3">
				{icon && (
					<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info text-action">
						<Icon name={icon} className="size-4" />
					</span>
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					{title && <h3 className="m-0 text-sm font-semibold">{title}</h3>}
					{badge && (
						<div className="flex flex-wrap items-center gap-2">{badge}</div>
					)}
				</div>
				{time && <time className="shrink-0 text-xs text-muted">{time}</time>}
			</div>
			{body && (
				<p
					dir="auto"
					className="m-0 whitespace-pre-wrap break-words text-sm text-muted"
				>
					{body}
				</p>
			)}
			{children && <div className="flex flex-wrap gap-2">{children}</div>}
		</article>
	);
}

function DomainNotice({
	title,
	state,
	onRetry,
	online,
	locale,
}: {
	title: string;
	state: "closed" | "loading" | "ready" | "denied" | "error";
	onRetry: () => void;
	online: boolean;
	locale: Locale;
}) {
	const t = aftercareCopy[locale];
	return (
		<section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface p-5">
			<h2 className="m-0 text-base font-semibold">{title}</h2>
			<p role="status" className="m-0 text-sm text-muted">
				{state === "denied"
					? t.domainUnavailable
					: state === "error"
						? t.error
						: t.loading}
			</p>
			{state === "error" && (
				<Button
					variant="outline"
					size="sm"
					disabled={!online}
					onClick={onRetry}
					className="self-start rounded-lg"
				>
					{t.refresh}
				</Button>
			)}
		</section>
	);
}

function AftercareLine({
	locale,
	line,
	orderId,
	currency,
}: {
	locale: Locale;
	line: Line;
	orderId: string;
	currency: string;
}) {
	const t = aftercareCopy[locale],
		ol = orderListCopy[locale],
		title = line.titles?.[locale] ?? line.sku ?? ol.unknown,
		unit = line.unit_labels?.[locale] ?? line.unit;
	return (
		<div className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
			<ProductThumbnail
				src={`/api/v1/orders/buyer/orders/${orderId}/lines/${line.line}/image/`}
				className="size-14"
			/>
			<div className="min-w-0 flex-1 space-y-1">
				<p className="m-0 break-words text-sm font-semibold" dir="auto">
					{title}
				</p>
				<p className="m-0 text-xs text-muted">
					{ol.sku}: <bdi>{line.sku ?? line.line}</bdi>
				</p>
				<dl className="m-0 grid grid-cols-3 gap-2">
					<DetailField label={t.quantity}>
						<bdi>{line.quantity.replace(/\.000$/, "")}</bdi> {unit}
					</DetailField>
					<DetailField label={t.unitPrice}>
						<Money amount={line.unit_price} currency={currency} />
					</DetailField>
					<DetailField label={t.total}>
						<Money
							amount={line.goods_amount}
							currency={currency}
							className="font-semibold"
						/>
					</DetailField>
				</dl>
			</div>
		</div>
	);
}

export function BuyerAftercare({
	locale,
	context,
	embedded = false,
	disputeId,
	seller,
	scope,
	data,
	source,
	command,
	blocked,
	online,
	saved,
	guardFeedback,
	formEpoch,
	uploaded,
	upload,
	choose,
	review,
	opener,
	onReview,
	closeReview,
	confirmReview,
	onDirty,
	onDomain,
	onReportDirty,
}: {
	locale: Locale;
	context: Context;
	embedded?: boolean;
	disputeId?: string;
	seller: string;
	scope: string;
	data: Workspace | null;
	source: ReturnType<typeof useAftercareData>;
	command: ReturnType<typeof useAftercareCommand>;
	blocked: boolean;
	online: boolean;
	saved: boolean;
	guardFeedback: ReactNode;
	formEpoch: number;
	uploaded: { id: string; domain: Domain } | null;
	upload: (file: File, domain: Domain) => void;
	choose: (next: () => void) => void;
	review: Reviewed | null;
	opener: HTMLElement | null;
	onReview: (packet: Reviewed, element: HTMLElement | null) => void;
	closeReview: () => void;
	confirmReview: () => void;
	onDirty: (dirty: boolean) => void;
	onDomain: (domain: Domain) => void;
	onReportDirty: (dirty: boolean) => void;
}) {
	const t = aftercareCopy[locale],
		ol = orderListCopy[locale];
	const [tab, setTab] = useState<Tab>("overview");
	const [helpOpen, setHelpOpen] = useState(false),
		[helpMode, setHelpMode] = useState<Mode | null>(null);
	const [reportOpen, setReportOpen] = useState(false);
	const modes = data ? availableModes(data) : [];
	const order = data?.order;
	const epochRef = useRef(formEpoch);
	useEffect(() => {
		if (helpOpen && formEpoch !== epochRef.current) setHelpOpen(false);
		epochRef.current = formEpoch;
	}, [formEpoch, helpOpen]);
	useEffect(() => {
		if (tab === "requests" || helpOpen) {
			if (!source.paymentOpen) source.openPayment();
			if (!source.deliveryOpen) source.openDelivery();
		}
	}, [
		tab,
		helpOpen,
		source.paymentOpen,
		source.deliveryOpen,
		source.openPayment,
		source.openDelivery,
	]);
	function openHelp(next: Mode) {
		choose(() => {
			setHelpMode(next);
			setHelpOpen(true);
		});
	}
	const disputeRow = disputeId
		? order?.disputes?.find((row) => row.id === disputeId)
		: undefined;
	const pendingCancels =
		order?.cancellations.filter((row) => row.state === "pending") ?? [];
	const pendingAmends =
		order?.amendments.filter((row) => row.state === "pending") ?? [];
	const pendingDisputes =
		order?.disputes?.filter((row) => row.state === "pending") ?? [];
	const pendingReview =
		order?.review?.state === "pending" ? order.review : null;
	const reportableDues =
		data?.payment?.refund_dues.filter((row) => row.can_report) ?? [];
	const withdrawableReports =
		data?.payment?.refund_reports.filter((row) => row.can_withdraw) ?? [];
	const canExcess = !!data?.payment?.capabilities.excess_refund;
	const deliveryProviders = data?.delivery?.capabilities.refund
		? (data.delivery.refund_providers ?? [])
		: [];
	const anyRequests =
		pendingCancels.length ||
		pendingAmends.length ||
		pendingDisputes.length ||
		pendingReview ||
		reportableDues.length ||
		withdrawableReports.length ||
		canExcess ||
		deliveryProviders.length;
	const requestCount =
		pendingCancels.length +
		pendingAmends.length +
		pendingDisputes.length +
		(pendingReview ? 1 : 0) +
		reportableDues.length +
		withdrawableReports.length +
		(canExcess ? 1 : 0) +
		deliveryProviders.length;
	const related = order
		? [
				{
					href: `/${locale}/account/buyer/orders/${order.id}`,
					label: t.viewOrder,
					Icon: ShoppingBag,
				},
				...(order.invoice
					? [
							{
								href: invoiceHref(locale, "buyer", order.invoice),
								label: ol.invoice,
								Icon: FileText,
							},
						]
					: []),
				{
					href: paymentHref(locale, "buyer", order.id),
					label: ol.payments,
					Icon: Wallet,
				},
				{
					href: fulfilmentHref(locale, "buyer", order.id),
					label: ol.delivery,
					Icon: Truck,
				},
				{
					href: disputeHref(locale, "buyer", undefined, order.seller),
					label: t.disputes,
					Icon: Shield,
				},
			]
		: [];
	const tabs: [Tab, string][] = [
		["overview", t.tabOverview],
		["requests", t.tabRequests],
		["history", t.tabHistory],
	];
	const withdrawButton = (mode: Mode) => (
		<Button
			variant="outline"
			size="sm"
			className="rounded-lg"
			onClick={() => openHelp(mode)}
		>
			{modeLabel(locale, mode)}
		</Button>
	);
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<header className="flex min-w-0 flex-col gap-3">
				{!embedded && (
					<Link
						href={aftercareHref(locale, context, undefined, seller)}
						prefetch={false}
						className="inline-flex items-center gap-1 self-start text-sm font-medium text-action no-underline hover:text-foreground"
					>
						<ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
						{t.buyerTitle}
					</Link>
				)}
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						{embedded ? (
							<h2 className="m-0 text-xl font-bold">
								{disputeId ? t.disputes : t.buyerTitle}
								{order && (
									<>
										{" "}
										· <bdi>{order.number}</bdi>
									</>
								)}
							</h2>
						) : (
							<h1 className="m-0 text-2xl font-bold">
								{disputeId ? t.disputes : t.buyerTitle}
								{order && (
									<>
										{" "}
										· <bdi>{order.number}</bdi>
									</>
								)}
							</h1>
						)}
						{order && (
							<p className="m-0 mt-1 text-sm text-muted">
								<bdi>{order.seller_name || order.seller}</bdi>
							</p>
						)}
						{order && (
							<div className="mt-2 flex flex-wrap gap-1.5">
								{order.aftercare.cancelled && (
									<StatusBadge variant="neutral">{t.cancelled}</StatusBadge>
								)}
								{pendingCancels.length > 0 && (
									<StatusBadge variant="warning">{t.cancelPending}</StatusBadge>
								)}
								{pendingAmends.length > 0 && (
									<StatusBadge variant="warning">{t.amendPending}</StatusBadge>
								)}
								{pendingDisputes.length > 0 && (
									<StatusBadge variant="warning">
										{t.disputePending}
									</StatusBadge>
								)}
								{Number(order.payment.refund_due) > 0 && (
									<StatusBadge variant="info">{t.refundDue}</StatusBadge>
								)}
							</div>
						)}
					</div>
					<div className="flex items-center gap-2">
						{order && (
							<BuyerRowMenu
								locale={locale}
								label={`${ol.actions}: ${order.number}`}
								links={related}
							/>
						)}
						<Button
							variant="outline"
							size="sm"
							disabled={!online || command.busy}
							onClick={source.refresh}
							className="h-9 rounded-lg text-xs"
						>
							<RefreshCw
								className={cn(
									"size-3.5",
									command.busy && "animate-spin motion-reduce:animate-none",
								)}
								aria-hidden="true"
							/>
							{t.refresh}
						</Button>
					</div>
				</div>
				<p className="m-0 max-w-3xl text-sm leading-relaxed text-muted">
					{disputeId ? t.disputeIntro : t.buyerIntro}
				</p>
			</header>
			{!helpOpen && !reportOpen && guardFeedback}
			{!online && (
				<p role="status" className="m-0 text-sm text-warning">
					{t.offline}
				</p>
			)}
			{source.error && (
				<p role="alert" className="m-0 text-sm text-danger">
					{t.error}
				</p>
			)}
			{command.error && (
				<p role="alert" className="m-0 text-sm text-danger">
					{command.error === "throttled" ? t.throttled : t.error}
				</p>
			)}
			{saved && !helpOpen && (
				<p role="status" className="m-0 text-sm text-chip-success">
					{t.saved}
				</p>
			)}
			{command.absent && !helpOpen && (
				<p role="status" className="m-0 text-sm text-muted">
					{t.absent}
				</p>
			)}
			{command.locked && (
				<section
					className="flex min-w-0 flex-col gap-3 rounded-card border border-warning bg-warning-surface p-4"
					aria-live="polite"
				>
					<p className="m-0 text-sm">{t.uncertain}</p>
					<Button
						variant="outline"
						size="sm"
						disabled={command.busy || !online}
						onClick={() => void command.reconcile()}
						className="self-start rounded-lg"
					>
						{t.reconcile}
					</Button>
				</section>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<DetailDialog
					locale={locale}
					title={t.helpTitle}
					icon="help"
					label={t.getHelp}
					wide
					inline
					keepMounted
					open={helpOpen}
					onOpenChange={setHelpOpen}
					onTrigger={() => openHelp(modes[0] ?? "cancel")}
					triggerVariant="default"
					triggerSize="default"
				>
					{helpOpen && guardFeedback}
					{saved && (
						<p role="status" className="m-0 text-sm text-chip-success">
							{t.saved}
						</p>
					)}
					{command.absent && (
						<p role="status" className="m-0 text-sm text-muted">
							{t.absent}
						</p>
					)}
					{data ? (
						<AftercareActionForm
							key={`${formEpoch}:${helpMode ?? ""}`}
							{...{ locale, context, data, uploaded, upload }}
							locked={blocked || !!review}
							onDirty={onDirty}
							onDomain={onDomain}
							choose={choose}
							review={onReview}
							initialMode={helpMode ?? undefined}
						/>
					) : (
						<p role="status" className="m-0 text-sm text-muted">
							{t.loading}
						</p>
					)}
				</DetailDialog>
				<DetailDialog
					locale={locale}
					title={t.reportTitle}
					icon="alert-triangle"
					label={t.reportTitle}
					inline
					keepMounted
					open={reportOpen}
					onOpenChange={setReportOpen}
					onTrigger={() => setReportOpen(true)}
					triggerVariant="outline"
					triggerSize="default"
				>
					{reportOpen && guardFeedback}
					{data && (
						<ReportForm
							key={`${scope}:report`}
							locale={locale}
							context={context}
							id={data.order.id}
							target="order"
							embedded
							compact
							onDirty={onReportDirty}
							onDenied={(error) => {
								if (error instanceof AccountError && error.status === 401)
									source.deny();
							}}
						/>
					)}
				</DetailDialog>
			</div>
			{!data ? (
				<p role="status" className="m-0 px-5 py-10 text-sm text-muted">
					{t.loading}
				</p>
			) : (
				<>
					{disputeId && disputeRow && (
						<section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h2 className="m-0 text-base font-semibold">
									<bdi>{disputeRow.number}</bdi>
								</h2>
								<StatusBadge
									variant={
										disputeRow.state === "pending"
											? "warning"
											: disputeRow.state === "refund_ordered"
												? "info"
												: disputeRow.state === "resolved_non_monetary"
													? "success"
													: "neutral"
									}
								>
									{aftercareState(locale, disputeRow.state)}
								</StatusBadge>
							</div>
							<p
								dir="auto"
								className="m-0 whitespace-pre-wrap break-words text-sm"
							>
								{disputeRow.reason}
							</p>
							{disputeRow.evidence?.length > 0 && (
								<div className="flex flex-wrap gap-3">
									{disputeRow.evidence.map((id) => (
										<AftercareEvidence
											key={id}
											locale={locale}
											context={context}
											domain="orders"
											id={id}
										/>
									))}
								</div>
							)}
							{disputeRow.response && (
								<div className="flex flex-col gap-1 border-s-2 border-border ps-3">
									<h3 className="m-0 text-sm font-semibold">
										{t.disputeResponse}
									</h3>
									<p
										dir="auto"
										className="m-0 whitespace-pre-wrap break-words text-sm"
									>
										{disputeRow.response.text}
									</p>
									<time className="text-xs text-muted">
										{localTimestamp(disputeRow.response.created_at, locale)}
									</time>
								</div>
							)}
							{disputeRow.decision && (
								<div className="flex flex-col gap-1 border-s-2 border-border ps-3">
									<h3 className="m-0 text-sm font-semibold">
										{t.disputeAction}:{" "}
										{aftercareState(locale, disputeRow.decision.action)}
									</h3>
									<p
										dir="auto"
										className="m-0 whitespace-pre-wrap break-words text-sm"
									>
										{disputeRow.decision.reason}
									</p>
									{disputeRow.decision.amount && (
										<p className="m-0 text-sm">
											<bdi>
												{disputeRow.decision.amount} {disputeRow.currency}
											</bdi>
										</p>
									)}
								</div>
							)}
							<div className="flex flex-wrap gap-2">
								{disputeRow.can_respond && withdrawButton("dispute_respond")}
								{disputeRow.can_withdraw && withdrawButton("dispute_withdraw")}
							</div>
						</section>
					)}
					<nav
						aria-label={t.buyerTitle}
						className="flex max-w-full gap-1 overflow-x-auto border-0 border-b border-solid border-border"
					>
						{tabs.map(([value, label]) => (
							<button
								key={value}
								type="button"
								aria-current={tab === value ? "page" : undefined}
								onClick={() => setTab(value)}
								className={cn(
									"shrink-0 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-action",
									tab === value
										? "border-action font-semibold text-action"
										: "border-transparent text-muted hover:text-foreground",
								)}
							>
								{label}
								{value === "requests" && requestCount > 0 && (
									<span className="ms-1.5 rounded-full bg-info px-1.5 py-0.5 text-xs font-semibold text-action">
										<bdi>{requestCount}</bdi>
									</span>
								)}
							</button>
						))}
					</nav>
					{tab === "overview" && (
						<div className="grid items-stretch gap-4 lg:grid-cols-3">
							<div className="flex h-full min-w-0 flex-col gap-4 lg:col-span-2">
								{(data.order.aftercare.cancelled ||
									pendingCancels.length > 0) && (
									<p
										role="status"
										className={cn(
											"m-0 rounded-lg px-3 py-2 text-caption",
											data.order.aftercare.cancelled
												? "bg-page text-muted"
												: "bg-warning-surface text-warning",
										)}
									>
										{data.order.aftercare.cancelled
											? t.cancelled
											: t.cancellation_hold}
									</p>
								)}
								<DetailCard
									title={ol.products}
									icon="box"
									compact
									className="flex-1"
								>
									<div className="divide-y divide-border">
										{data.order.effective_lines.map((line) => (
											<AftercareLine
												key={line.line}
												locale={locale}
												line={line}
												orderId={data.order.id}
												currency={data.order.currency}
											/>
										))}
									</div>
									<div className="mt-auto flex items-center justify-between gap-3 rounded-lg bg-page px-3 py-2">
										<span className="text-sm font-medium text-muted">
											{t.currentTotal}
										</span>
										<Money
											amount={data.order.accepted_total}
											currency={data.order.currency}
											className="text-lg font-bold"
										/>
									</div>
								</DetailCard>
							</div>
							<DetailCard
								title={t.moneySummary}
								icon="wallet"
								compact
								className="h-full"
							>
								<dl className="m-0 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
									<DetailField label={t.paidSoFar}>
										<Money
											amount={data.order.payment.received}
											currency={data.order.currency}
										/>
									</DetailField>
									<DetailField label={t.stillToPay}>
										<Money
											amount={data.order.payment.remaining}
											currency={data.order.currency}
											className="font-semibold"
										/>
									</DetailField>
									<DetailField label={t.refundForYou}>
										<Money
											amount={data.order.payment.refund_due}
											currency={data.order.currency}
											className={
												Number(data.order.payment.refund_due) > 0
													? "font-semibold text-warning"
													: undefined
											}
										/>
									</DetailField>
								</dl>
								<details className="rounded-lg border border-solid border-border bg-page">
									<summary className="cursor-pointer px-3 py-2 text-sm font-medium text-action focus-visible:outline-2 focus-visible:outline-action">
										{t.moreMoney}
									</summary>
									<dl className="m-0 grid gap-3 border-0 border-t border-solid border-border px-3 py-3 sm:grid-cols-2">
										<DetailField label={t.originalTotal}>
											<Money
												amount={data.order.goods_total}
												currency={data.order.currency}
											/>
										</DetailField>
										<DetailField label={t.refunded}>
											<Money
												amount={data.order.payment.refunded}
												currency={data.order.currency}
											/>
										</DetailField>
										<DetailField label={t.balance}>
											<Money
												amount={data.order.payment.overpayment}
												currency={data.order.currency}
											/>
										</DetailField>
										<DetailField label={t.originalDue}>
											{data.order.payment.original_due_at ? (
												<bdi>
													{localTimestamp(
														data.order.payment.original_due_at,
														locale,
													)}
												</bdi>
											) : (
												"—"
											)}
										</DetailField>
										<DetailField label={t.effectiveDue}>
											{data.order.payment.effective_due_at ? (
												<bdi>
													{localTimestamp(
														data.order.payment.effective_due_at,
														locale,
													)}
												</bdi>
											) : (
												"—"
											)}
										</DetailField>
									</dl>
								</details>
							</DetailCard>
						</div>
					)}
					{tab === "requests" &&
						(!anyRequests ? (
							<EmptyState borderless icon="inbox" title={t.requestsEmpty} />
						) : (
							<div className="flex min-w-0 flex-col gap-5">
								<p className="m-0 text-sm text-muted">{t.requestsIntro}</p>
								{pendingCancels.length > 0 && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">
											{t.pendingCancellations}
										</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											{pendingCancels.map((row) => (
												<ActionCard
													key={row.id}
													icon="return"
													title={t.groupCancel}
													badge={
														<StatusBadge variant="warning">
															{aftercareState(locale, row.state)}
														</StatusBadge>
													}
													body={row.reason}
													time={localTimestamp(row.created_at, locale)}
												>
													{row.can_withdraw &&
														withdrawButton("cancel_withdraw")}
												</ActionCard>
											))}
										</div>
									</section>
								)}
								{pendingAmends.length > 0 && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">
											{t.pendingAmendments}
										</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											{pendingAmends.map((row) => (
												<ActionCard
													key={row.id}
													icon="sliders"
													title={t.groupChange}
													badge={
														<StatusBadge variant="warning">
															{aftercareState(locale, row.state)}
														</StatusBadge>
													}
													body={`${row.reason} · ${row.after_total} ${data.order.currency}`}
													time={localTimestamp(row.created_at, locale)}
												>
													{row.can_withdraw && withdrawButton("amend_withdraw")}
												</ActionCard>
											))}
										</div>
									</section>
								)}
								{pendingDisputes.length > 0 && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">
											{t.disputes}
										</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											{pendingDisputes.map((row) => (
												<ActionCard
													key={row.id}
													icon="shield"
													title={t.groupDispute}
													badge={
														<StatusBadge variant="warning">
															{aftercareState(locale, row.state)}
														</StatusBadge>
													}
													body={row.reason}
													time={localTimestamp(row.created_at, locale)}
												>
													{row.can_respond && withdrawButton("dispute_respond")}
													{row.can_withdraw &&
														withdrawButton("dispute_withdraw")}
												</ActionCard>
											))}
										</div>
									</section>
								)}
								{pendingReview && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">{t.reviews}</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											<ActionCard
												icon="star"
												title={t.groupReview}
												badge={
													<StatusBadge variant="warning">
														{aftercareState(
															locale,
															`review_${pendingReview.state}`,
														)}
													</StatusBadge>
												}
												body={`${pendingReview.rating}/5 · ${pendingReview.text}`}
												time={localTimestamp(pendingReview.created_at, locale)}
											>
												{pendingReview.can_withdraw &&
													withdrawButton("review_withdraw")}
											</ActionCard>
										</div>
									</section>
								)}
								{(reportableDues.length > 0 || canExcess) && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">{t.dues}</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											{canExcess && (
												<ActionCard
													icon="wallet"
													title={t.refundForYou}
													body={t.refundNote}
												>
													{withdrawButton("excess")}
												</ActionCard>
											)}
											{reportableDues.map((row) => (
												<ActionCard
													key={row.id}
													icon="wallet"
													title={t.dues}
													badge={
														<StatusBadge variant="info">
															{aftercareState(locale, row.cause)}
														</StatusBadge>
													}
													body={`${row.amount} ${row.currency}`}
													time={localTimestamp(row.created_at, locale)}
												>
													{withdrawButton("report")}
												</ActionCard>
											))}
										</div>
									</section>
								)}
								{withdrawableReports.length > 0 && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">{t.reports}</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											{withdrawableReports.map((row) => (
												<ActionCard
													key={row.id}
													icon="receipt"
													title={t.reports}
													badge={
														<StatusBadge variant="warning">
															{aftercareState(locale, row.state)}
														</StatusBadge>
													}
													body={`${row.amount} ${data.order.currency} · ${row.reference}`}
													time={localTimestamp(row.sent_at, locale)}
												>
													{withdrawButton("refund_withdraw")}
												</ActionCard>
											))}
										</div>
									</section>
								)}
								{deliveryProviders.length > 0 && (
									<section className="flex min-w-0 flex-col gap-3">
										<h2 className="m-0 text-base font-semibold">
											{t.deliveryRefunds}
										</h2>
										<div className="grid gap-3 sm:grid-cols-2">
											{deliveryProviders.map((row) => (
												<ActionCard
													key={row.id}
													icon="truck"
													title={row.name}
													body={`${t.limit}: ${row.refundable} ${data.order.currency}`}
												>
													{withdrawButton("delivery_refund")}
												</ActionCard>
											))}
										</div>
									</section>
								)}
							</div>
						))}
					{tab === "history" && (
						<div className="flex min-w-0 flex-col gap-4">
							<OrderHistory locale={locale} row={data.order} />
							{source.paymentOpen &&
								(data.payment ? (
									<GoodsRefundHistory
										locale={locale}
										context={context}
										row={data.payment}
									/>
								) : (
									<DomainNotice
										title={t.dues}
										state={source.paymentState}
										onRetry={source.openPayment}
										online={online}
										locale={locale}
									/>
								))}
							{source.deliveryOpen &&
								(data.delivery ? (
									<DeliveryRefundHistory
										locale={locale}
										context={context}
										row={data.delivery}
										currency={data.order.currency}
									/>
								) : (
									<DomainNotice
										title={t.deliveryRefunds}
										state={source.deliveryState}
										onRetry={source.openDelivery}
										online={online}
										locale={locale}
									/>
								))}
						</div>
					)}
				</>
			)}
			{review && data && (
				<AftercareReview
					{...{ locale, context, data, packet: review, opener }}
					busy={blocked}
					close={closeReview}
					confirm={confirmReview}
				/>
			)}
		</div>
	);
}
