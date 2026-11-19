"use client";
import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import {
	AlertTriangle,
	Check,
	Clock3,
	ChevronRight,
	Download,
	FileText,
	MoreHorizontal,
	Package,
	Printer,
	RefreshCw,
	RotateCcw,
	Shield,
	Truck,
	Wallet,
} from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { useSellerNavigation } from "../../../app/[locale]/(seller)/account/seller/components/seller-navigation";
import { Icon } from "../../../components/ui/icon";
import { pageBannerClass } from "../../../components/ui/page-header";
import type { Locale } from "../../../lib/i18n/locales";
import { disputeHref } from "../../aftercare/api";
import { accessLost, useVisiblePoll } from "../../messaging/hooks";
import { Pager, PAGE_SIZE } from "../../../components/pager";
import { cn } from "../../../lib/shadcn-utils";
import { localTimestamp } from "../../messaging/api";
import { AftercareSection } from "../../aftercare/section";
import { aftercareCopy } from "../../aftercare/copy";
import { fulfilmentCopy, fulfilmentState } from "../../fulfilment/copy";
import { paymentCopy, paymentState } from "../../payments/copy";
import { negotiationCopy } from "../../negotiations/copy";
import { salesHref } from "../../sales/components/seller-sales-ui";
import { commerceCopy } from "../copy";
import { orderListCopy } from "../list-copy";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { orderViewCopy, orderActivityLabel } from "../view-copy";
import { orderDetailCopy } from "../detail-copy";
import {
	commerce,
	invoiceHref,
	type Order,
	type OrderActivityEvent,
	type Page,
} from "../api";
import {
	BuyerOrderLine,
	DetailCard,
	DetailField,
	Money,
	PaymentSummaryCore,
} from "./order-ui";

type Route = "payments" | "fulfilment" | "aftercare" | "disputes";
type NextAction = {
	label: string;
	route: Route;
	href: string;
	icon: typeof Wallet;
	blocker?: string;
};

// Domain logic: the next step follows backend dimensions, never the all-false
// capabilities placeholders. Holds gate progress; advance funds gate dispatch.
function deriveNextAction(
	order: Order,
	locale: Locale,
	seller: string,
): NextAction {
	const t = orderDetailCopy[locale],
		d = order.dimensions,
		stage = d.fulfilment;
	if (d.cancellation === "pending")
		return {
			label: t.reviewCancellation,
			route: "aftercare",
			href: salesHref(locale, "aftercare", seller, order.id),
			icon: RotateCcw,
			blocker: t.cancellationBlocks,
		};
	if (d.dispute === "unresolved")
		return {
			label: t.reviewDispute,
			route: order.dispute_id ? "disputes" : "fulfilment",
			href: order.dispute_id
				? disputeHref(locale, "seller", order.dispute_id, seller)
				: salesHref(locale, "fulfilment", seller, order.id),
			icon: Shield,
			blocker: t.disputeBlocks,
		};
	if (
		order.payment_method === "advance" &&
		stage === "prepared" &&
		(d.financial === "unpaid" || d.financial === "partial")
	)
		return {
			label: t.recordPayment,
			route: "payments",
			href: salesHref(locale, "payments", seller, order.id),
			icon: Wallet,
			blocker: t.advanceRequired,
		};
	const fulfilment = salesHref(locale, "fulfilment", seller, order.id);
	if (stage === "delivered")
		return {
			label: t.reviewCompletion,
			route: "fulfilment",
			href: fulfilment,
			icon: Check,
		};
	if (stage === "dispatched")
		return {
			label: t.confirmDelivery,
			route: "fulfilment",
			href: fulfilment,
			icon: Truck,
		};
	if (stage === "prepared")
		return {
			label: t.dispatchOrder,
			route: "fulfilment",
			href: fulfilment,
			icon: Truck,
		};
	return {
		label: t.prepareOrder,
		route: "fulfilment",
		href: fulfilment,
		icon: Package,
		blocker:
			stage === "needs_preparation"
				? fulfilmentCopy[locale].needPreparation
				: undefined,
	};
}

function printHref(locale: Locale, order: Order, seller: string) {
	return `${invoiceHref(locale, "seller", order.invoice, seller).split("?")[0]}/print${seller ? `?seller=${seller}` : ""}`;
}

export function SellerOrderDetail({
	order,
	locale,
	seller,
	canInvoice,
	busy,
	onDownload,
	onRefresh,
	backHref,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canInvoice: boolean;
	busy: boolean;
	onDownload: () => void;
	onRefresh: () => void;
	backHref: string;
}) {
	const t = orderDetailCopy[locale],
		destinations = useSellerNavigation(),
		can = (route: string) => !!destinations?.some((x) => x.route === route),
		next = deriveNextAction(order, locale, seller);
	return (
		<div className="min-w-0 space-y-5">
			<OrderHeader
				order={order}
				locale={locale}
				seller={seller}
				canInvoice={canInvoice}
				busy={busy}
				onDownload={onDownload}
				onRefresh={onRefresh}
				backHref={backHref}
				next={next}
				can={can}
			/>
			<ProgressCard order={order} locale={locale} />
			<DetailTabs
				locale={locale}
				label={t.summary}
				tabs={[
					{
						id: "overview",
						label: t.overview,
						panel: (
							<div className="space-y-4">
								<p className="m-0 text-sm text-muted">
									{orderViewCopy[locale].overview}
								</p>
								<div className="grid gap-5 lg:grid-cols-3">
									<ProductsCard
										order={order}
										locale={locale}
										className="lg:col-span-2"
									/>
									<CustomerCard
										order={order}
										locale={locale}
										seller={seller}
										canFulfilment={can("fulfilment")}
									/>
								</div>
								<OverviewPanel order={order} locale={locale} />
							</div>
						),
					},
					{
						id: "payment",
						label: orderViewCopy[locale].paymentsLabel,
						panel: (
							<PaymentPanel
								order={order}
								locale={locale}
								seller={seller}
								canPayments={can("payments")}
							/>
						),
					},
					{
						id: "invoice",
						label: orderViewCopy[locale].invoiceLabel,
						panel: (
							<InvoicePanel
								{...{ order, locale, seller, canInvoice, busy, onDownload }}
							/>
						),
					},
					{
						id: "activity",
						label: t.activity,
						panel: (
							<ActivityPanel
								order={order}
								locale={locale}
								seller={seller}
								can={can}
							/>
						),
					},
				]}
			/>
		</div>
	);
}

function OrderHeader({
	order,
	locale,
	seller,
	canInvoice,
	busy,
	onDownload,
	onRefresh,
	backHref,
	next,
	can,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canInvoice: boolean;
	busy: boolean;
	onDownload: () => void;
	onRefresh: () => void;
	backHref: string;
	next: NextAction;
	can: (route: string) => boolean;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		paid =
			order.dimensions.financial === "paid" ||
			order.dimensions.financial === "overpaid",
		available = can(next.route),
		blocker = available ? next.blocker : t.roleBlocked,
		NextIcon = next.icon;
	return (
		<header className="min-w-0 space-y-4">
			<Link
				href={backHref}
				className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-muted no-underline hover:text-action"
			>
				<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
				{t.backToOrders}
			</Link>
			<div
				className={`${pageBannerClass} flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between`}
			>
				<div className="min-w-0 space-y-2">
					<h1 className="m-0 text-2xl font-bold tracking-tight">
						{list.order} · <bdi>{order.number}</bdi>
					</h1>
					<p className="m-0 max-w-xl text-sm leading-relaxed text-muted">
						{orderViewCopy[locale].subtitle}
					</p>
					<p className="m-0 text-xs text-muted">
						{c.accepted}: <bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Badge
							variant="secondary"
							className={cn(
								"border-0",
								paid
									? "bg-success-surface text-success"
									: "bg-info text-action",
							)}
						>
							{paymentState(locale, order.dimensions.financial)}
						</Badge>
						<span className="text-xs text-muted">
							{fulfilmentState(locale, order.dimensions.fulfilment)}
						</span>
						{order.dimensions.cancellation === "pending" && (
							<Badge
								variant="secondary"
								className="border-0 bg-warning-surface text-warning"
							>
								{list.cancelHold}
							</Badge>
						)}
						{order.dimensions.dispute === "unresolved" && (
							<Badge
								variant="secondary"
								className="border-0 bg-danger-surface text-danger"
							>
								{list.dispute}
							</Badge>
						)}
					</div>
				</div>
				<div className="flex w-full items-start justify-between gap-2 sm:w-auto sm:justify-end">
					<div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end">
						{available ? (
							<Button asChild className="rounded-xl">
								<Link href={next.href}>
									<NextIcon className="size-4" aria-hidden="true" />
									{next.label}
								</Link>
							</Button>
						) : (
							<Button disabled className="rounded-xl">
								<NextIcon className="size-4" aria-hidden="true" />
								{next.label}
							</Button>
						)}
						{blocker && (
							<p className="m-0 flex max-w-60 items-start gap-1.5 text-xs text-muted sm:text-end">
								<AlertTriangle
									className="size-3.5 shrink-0 text-warning"
									aria-hidden="true"
								/>
								<span>{blocker}</span>
							</p>
						)}
					</div>
					<OrderMenu
						order={order}
						locale={locale}
						seller={seller}
						canInvoice={canInvoice}
						busy={busy}
						onDownload={onDownload}
						onRefresh={onRefresh}
						can={can}
					/>
				</div>
			</div>
		</header>
	);
}

function OrderMenu({
	order,
	locale,
	seller,
	canInvoice,
	busy,
	onDownload,
	onRefresh,
	can,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canInvoice: boolean;
	busy: boolean;
	onDownload: () => void;
	onRefresh: () => void;
	can: (route: string) => boolean;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		links = [
			{
				route: "invoices",
				href: salesHref(locale, "invoices", seller, order.invoice),
				label: list.invoice,
				Icon: FileText,
				show: canInvoice,
			},
			{
				route: "payments",
				href: salesHref(locale, "payments", seller, order.id),
				label: list.payments,
				Icon: Wallet,
				show: can("payments"),
			},
			{
				route: "fulfilment",
				href: salesHref(locale, "fulfilment", seller, order.id),
				label: list.delivery,
				Icon: Truck,
				show: can("fulfilment"),
			},
			{
				route: "aftercare",
				href: salesHref(locale, "aftercare", seller, order.id),
				label: list.aftercare,
				Icon: RotateCcw,
				show: can("aftercare"),
			},
			{
				route: "disputes",
				href: disputeHref(
					locale,
					"seller",
					order.dispute_id ?? undefined,
					seller,
				),
				label: aftercareCopy[locale].disputes,
				Icon: Shield,
				show: can("disputes") && !!order.dispute_id,
			},
		];
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t.moreActions}
					title={t.moreActions}
					className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
				>
					<MoreHorizontal className="size-5" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className="w-60 rounded-xl p-1.5"
			>
				{links
					.filter((x) => x.show)
					.map(({ route, href, label, Icon: RowIcon }) => (
						<DropdownMenuItem
							key={route}
							asChild
							className="gap-2.5 no-underline"
						>
							<Link href={href}>
								<RowIcon aria-hidden="true" />
								{label}
							</Link>
						</DropdownMenuItem>
					))}
				{canInvoice && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem asChild className="gap-2.5 no-underline">
							<Link href={printHref(locale, order, seller)}>
								<Printer aria-hidden="true" />
								{c.print}
							</Link>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={busy}
							className="gap-2.5"
							onSelect={onDownload}
						>
							<Download aria-hidden="true" />
							{list.pdf}
						</DropdownMenuItem>
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={busy}
					className="gap-2.5"
					onSelect={onRefresh}
				>
					<RefreshCw aria-hidden="true" />
					{t.refresh}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProgressCard({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		stage = order.dimensions.fulfilment,
		active =
			stage === "delivered"
				? 4
				: stage === "dispatched"
					? 3
					: stage === "prepared"
						? 2
						: 1,
		stages = [
			t.stageConfirmed,
			t.stagePreparation,
			t.stageDispatch,
			t.stageDelivered,
		];
	return (
		<DetailCard title={t.progress} icon="shopping-bag">
			<ol className="m-0 grid grid-cols-2 list-none gap-2 p-0 sm:flex sm:flex-wrap sm:items-center">
				{stages.map((label, i) => {
					const done = i < active,
						current = i === active;
					return (
						<li key={label} className="flex items-center gap-2">
							{i > 0 && (
								<ChevronRight
									className="hidden size-4 text-muted sm:block rtl:rotate-180"
									aria-hidden="true"
								/>
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
											"size-1.5 rounded-full",
											current ? "bg-action" : "bg-muted",
										)}
										aria-hidden="true"
									/>
								)}
								{label}
								<span className="sr-only">
									{done
										? t.stageDone
										: current
											? t.stageCurrent
											: t.stageUpcoming}
								</span>
							</span>
						</li>
					);
				})}
			</ol>
		</DetailCard>
	);
}

function ProductsCard({
	order,
	locale,
	className,
}: {
	order: Order;
	locale: Locale;
	className?: string;
}) {
	const list = orderListCopy[locale];
	return (
		<DetailCard title={list.products} icon="box" className={className}>
			<div className="divide-y divide-border">
				{order.lines.map((line) => (
					<BuyerOrderLine
						key={line.id}
						line={line}
						order={order}
						locale={locale}
					/>
				))}
			</div>
			<div className="mt-4 flex items-center justify-between gap-3 border-0 border-t border-solid border-border pt-3">
				<span className="text-sm font-medium text-muted">{list.total}</span>
				<Money
					amount={order.goods_total}
					currency={order.currency}
					className="text-lg font-bold"
				/>
			</div>
		</DetailCard>
	);
}

function CustomerCard({
	order,
	locale,
	seller,
	canFulfilment,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canFulfilment: boolean;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		dest = order.snapshot.terms.destination;
	return (
		<DetailCard title={list.customer} icon="user">
			<dl className="m-0 space-y-3">
				<DetailField label={list.customer}>
					<span dir="auto">{order.customer?.name ?? order.snapshot.buyer}</span>
				</DetailField>
				<DetailField label={t.email}>
					<bdi dir="ltr" className="break-all">
						{order.customer?.email ?? list.unknown}
					</bdi>
				</DetailField>
				<DetailField label={c.destination}>
					<bdi>{dest.country}</bdi> · <span dir="auto">{dest.city}</span>
				</DetailField>
			</dl>
			{canFulfilment && (
				<Button asChild variant="outline" size="sm" className="mt-3 rounded-lg">
					<Link href={salesHref(locale, "fulfilment", seller, order.id)}>
						<Truck className="size-3.5" aria-hidden="true" />
						{list.delivery}
					</Link>
				</Button>
			)}
		</DetailCard>
	);
}

function OverviewPanel({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		d = order.dimensions,
		chargeLabel =
			d.delivery_charge === "settled"
				? fulfilmentCopy[locale].settled
				: d.delivery_charge === "unsettled"
					? fulfilmentCopy[locale].unsettled
					: fulfilmentCopy[locale].unknownCharge;
	return (
		<details className="rounded-xl border border-solid border-border bg-surface p-4">
			<summary className="cursor-pointer text-sm font-medium">
				{sellerSalesCopy[locale].details}
			</summary>
			<div className="mt-4 space-y-4">
				{order.snapshot.origin === "negotiated" && (
					<p className="m-0 rounded-xl bg-info p-3 text-sm">
						{negotiationCopy[locale].acceptedNotice}
					</p>
				)}
				<dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<DetailField label={c.method}>{c[order.payment_method]}</DetailField>
					<DetailField label={t.origin}>
						{order.snapshot.origin === "negotiated"
							? t.originNegotiated
							: t.originDirect}
					</DetailField>
					<DetailField label={t.termsVersion}>
						<bdi>{order.snapshot.terms.version}</bdi>
					</DetailField>
					<DetailField label={c.issued}>
						<bdi>{localTimestamp(order.issued_at, locale)}</bdi>
					</DetailField>
					<DetailField label={c.due}>
						{order.due_at ? (
							<bdi>{localTimestamp(order.due_at, locale)}</bdi>
						) : (
							list.unknown
						)}
					</DetailField>
					<DetailField label={paymentCopy[locale].allocation}>
						{paymentState(locale, d.allocation)}
					</DetailField>
					<DetailField label={t.deliveryCharge}>{chargeLabel}</DetailField>
					<DetailField label={fulfilmentCopy[locale].completion}>
						{fulfilmentState(locale, d.completion)}
					</DetailField>
				</dl>
			</div>
		</details>
	);
}

function PaymentPanel({
	order,
	locale,
	seller,
	canPayments,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canPayments: boolean;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		p = order.payment,
		zero = (value: string) => value === "0.00" || value === "0";
	return (
		<div className="space-y-4">
			<p className="m-0 text-sm text-muted">{orderViewCopy[locale].payment}</p>
			<DetailCard title={t.paymentSummary} icon="wallet">
				<PaymentSummaryCore
					order={order}
					locale={locale}
					columns={3}
					dueLabel={c.due}
					extra={
						<>
							{!zero(p.overpayment) && (
								<DetailField label={paymentCopy[locale].overpayment}>
									<Money amount={p.overpayment} currency={order.currency} />
								</DetailField>
							)}
							{!zero(p.refunded) && (
								<DetailField label={aftercareCopy[locale].refunded}>
									<Money amount={p.refunded} currency={order.currency} />
								</DetailField>
							)}
							{!zero(p.refund_due) && (
								<DetailField label={aftercareCopy[locale].refundDue}>
									<Money amount={p.refund_due} currency={order.currency} />
								</DetailField>
							)}
							<DetailField label={paymentCopy[locale].allocation}>
								{paymentState(locale, p.allocation)}
							</DetailField>
						</>
					}
				/>
			</DetailCard>
			{canPayments && (
				<Button asChild size="sm" className="rounded-lg">
					<Link href={salesHref(locale, "payments", seller, order.id)}>
						<Wallet className="size-3.5" aria-hidden="true" />
						{list.payments}
					</Link>
				</Button>
			)}
		</div>
	);
}

function InvoicePanel({
	order,
	locale,
	seller,
	canInvoice,
	busy,
	onDownload,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canInvoice: boolean;
	busy: boolean;
	onDownload: () => void;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale];
	return (
		<div className="space-y-4">
			<p className="m-0 text-sm text-muted">{orderViewCopy[locale].invoice}</p>
			<DetailCard title={orderViewCopy[locale].invoiceLabel} icon="file">
				<dl className="m-0 mb-4 grid gap-4 sm:grid-cols-3">
					<DetailField label={orderViewCopy[locale].invoiceNumber}>
						<bdi>{order.number}</bdi>
					</DetailField>
					<DetailField label={c.issued}>
						<bdi>{localTimestamp(order.issued_at, locale)}</bdi>
					</DetailField>
					<DetailField label={list.total}>
						<Money amount={order.goods_total} currency={order.currency} />
					</DetailField>
				</dl>
				<p className="m-0 text-xs text-muted">{t.invoiceHelp}</p>
				{canInvoice ? (
					<div className="flex flex-wrap gap-2">
						<Button asChild variant="outline" size="sm" className="rounded-lg">
							<Link href={salesHref(locale, "invoices", seller, order.invoice)}>
								<FileText className="size-3.5" aria-hidden="true" />
								{list.invoice}
							</Link>
						</Button>
						<Button asChild variant="outline" size="sm" className="rounded-lg">
							<Link href={printHref(locale, order, seller)}>
								<Printer className="size-3.5" aria-hidden="true" />
								{c.print}
							</Link>
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="rounded-lg"
							disabled={busy}
							onClick={onDownload}
						>
							<Download className="size-3.5" aria-hidden="true" />
							{list.pdf}
						</Button>
					</div>
				) : (
					<p className="m-0 text-xs text-muted">{t.noInvoice}</p>
				)}
			</DetailCard>
		</div>
	);
}

function OrderTimeline({ order, locale }: { order: string; locale: Locale }) {
	const t = orderViewCopy[locale],
		c = commerceCopy[locale],
		s = sellerSalesCopy[locale],
		[page, setPage] = useState(1),
		[data, setData] = useState<Page<OrderActivityEvent> | null>(null),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[revision, setRevision] = useState(0);
	useVisiblePoll(
		async (signal) => {
			try {
				const result = await commerce<Page<OrderActivityEvent>>(
					`orders/seller/orders/${order}/activity/?page=${page}`,
					undefined,
					"GET",
					signal,
				);
				if (signal.aborted) return;
				setData(result);
				setError(false);
			} catch (error) {
				if (signal.aborted) return;
				setData(null);
				setError(true);
				if (accessLost(error)) setDenied(true);
				throw error;
			}
		},
		[order, page, revision, denied],
		!denied,
	);
	const current = data?.page === page ? data : null;
	return (
		<DetailCard title={orderDetailCopy[locale].activity} icon="history">
			{denied ? (
				<p role="alert" className="m-0 text-sm">
					{t.activityDenied}
				</p>
			) : error ? (
				<div role="alert" className="space-y-3">
					<p className="m-0 text-sm">{c.error}</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setRevision((value) => value + 1)}
					>
						{c.reload}
					</Button>
				</div>
			) : !current ? (
				<p role="status" className="m-0 text-sm text-muted">
					{c.loading}
				</p>
			) : (
				<>
					{current.results.length ? (
						<ol className="m-0 list-none p-0">
							{current.results.map((event, index) => (
								<li
									key={`${event.source}:${event.id}`}
									className="relative flex gap-3 pb-5 last:pb-0"
								>
									{index < current.results.length - 1 && (
										<span
											aria-hidden="true"
											className="absolute start-3.5 top-7 bottom-0 w-px bg-border"
										/>
									)}
									<span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-info text-action">
										<Clock3 className="size-3.5" aria-hidden="true" />
									</span>
									<div className="min-w-0 space-y-1 pt-0.5">
										<p className="m-0 text-sm font-medium">
											{orderActivityLabel(locale, event)}
										</p>
										<time
											dateTime={event.created_at}
											className="text-xs text-muted"
										>
											<bdi>{localTimestamp(event.created_at, locale)}</bdi>
										</time>
									</div>
								</li>
							))}
						</ol>
					) : (
						<p className="m-0 text-sm text-muted">{t.activityEmpty}</p>
					)}
					<Pager
						locale={locale}
						page={page}
						count={current.count}
						pageSize={PAGE_SIZE}
						labels={{ prev: s.previous, next: s.next, page: s.page }}
						onPage={(next) => {
							if (next === page) return;
							setError(false);
							setData(null);
							setPage(next);
						}}
					/>
				</>
			)}
		</DetailCard>
	);
}

function ActivityPanel({
	order,
	locale,
	seller,
	can,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	can: (route: string) => boolean;
}) {
	const t = orderDetailCopy[locale],
		[issuesOpened, setIssuesOpened] = useState(false);
	return (
		<div className="space-y-4">
			<p className="m-0 text-sm text-muted">{orderViewCopy[locale].activity}</p>
			<OrderTimeline
				key={`${order.id}:${seller}:${locale}`}
				order={order.id}
				locale={locale}
			/>
			<nav aria-label={t.activity} className="flex flex-wrap gap-2">
				{can("payments") && (
					<Button asChild variant="outline" size="sm" className="rounded-lg">
						<Link href={salesHref(locale, "payments", seller, order.id)}>
							<Wallet className="size-3.5" aria-hidden="true" />
							{t.paymentHistory}
						</Link>
					</Button>
				)}
				{can("fulfilment") && (
					<Button asChild variant="outline" size="sm" className="rounded-lg">
						<Link href={salesHref(locale, "fulfilment", seller, order.id)}>
							<Truck className="size-3.5" aria-hidden="true" />
							{t.deliveryHistory}
						</Link>
					</Button>
				)}
				{can("disputes") && order.dispute_id && (
					<Button asChild variant="outline" size="sm" className="rounded-lg">
						<Link
							href={disputeHref(
								locale,
								"seller",
								order.dispute_id ?? undefined,
								seller,
							)}
						>
							<Shield className="size-3.5" aria-hidden="true" />
							{aftercareCopy[locale].disputes}
						</Link>
					</Button>
				)}
			</nav>
			<details
				onToggle={(event) => {
					if (event.currentTarget.open) setIssuesOpened(true);
				}}
				className="group/issues rounded-xl border border-solid border-border bg-surface p-4"
			>
				<summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
					<span>{orderViewCopy[locale].issues}</span>
					<ChevronRight
						className="size-4 text-muted group-open/issues:rotate-90 rtl:rotate-180"
						aria-hidden="true"
					/>
				</summary>
				<div className="mt-4">
					{issuesOpened && (
						<AftercareSection
							interactive
							locale={locale}
							context="seller"
							orderId={order.id}
							seller={seller}
						/>
					)}
				</div>
			</details>
		</div>
	);
}

function DetailTabs({
	locale,
	label,
	tabs,
}: {
	locale: Locale;
	label: string;
	tabs: { id: string; label: string; panel: ReactNode }[];
}) {
	const [active, setActive] = useState(0),
		[visited, setVisited] = useState(() => new Set([0])),
		refs = useRef<(HTMLButtonElement | null)[]>([]),
		baseId = useId(),
		rtl = locale !== "en";
	function activate(index: number) {
		setActive(index);
		setVisited((previous) => new Set([...previous, index]));
	}
	function onKeyDown(event: React.KeyboardEvent) {
		let next = active;
		if (event.key === "ArrowRight") next = rtl ? active - 1 : active + 1;
		else if (event.key === "ArrowLeft") next = rtl ? active + 1 : active - 1;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = tabs.length - 1;
		else return;
		event.preventDefault();
		next = (next + tabs.length) % tabs.length;
		activate(next);
		refs.current[next]?.focus();
	}
	return (
		<div className="min-w-0">
			<div
				role="tablist"
				aria-label={label}
				onKeyDown={onKeyDown}
				className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-border"
			>
				{tabs.map((tab, i) => (
					<button
						key={tab.id}
						ref={(el) => {
							refs.current[i] = el;
						}}
						type="button"
						role="tab"
						id={`${baseId}-tab-${i}`}
						aria-selected={active === i}
						aria-controls={`${baseId}-panel-${i}`}
						tabIndex={active === i ? 0 : -1}
						onClick={() => activate(i)}
						className={cn(
							"inline-flex min-h-11 shrink-0 cursor-pointer appearance-none items-center gap-2 border-0 border-b-2 border-solid bg-transparent px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-action motion-reduce:transition-none",
							active === i
								? "border-action font-semibold text-action"
								: "border-transparent bg-transparent text-muted hover:text-foreground",
						)}
					>
						{tab.label}
					</button>
				))}
			</div>
			{tabs.map((tab, i) => (
				<div
					key={tab.id}
					role="tabpanel"
					id={`${baseId}-panel-${i}`}
					aria-labelledby={`${baseId}-tab-${i}`}
					hidden={active !== i}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Named tab panels support focus for keyboard navigation.
					tabIndex={0}
					className="min-w-0 pt-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
				>
					{visited.has(i) ? tab.panel : null}
				</div>
			))}
		</div>
	);
}
