"use client";
import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import {
	AlertTriangle,
	Check,
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
import type { Locale } from "../../../lib/i18n/locales";
import { sellerHref } from "../../../lib/routes/account-routes";
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
import { orderDetailCopy } from "../detail-copy";
import { invoiceHref, type Order, type OrderLine } from "../api";
import { DetailCard, DetailField, Money, ProductThumbnail } from "./order-ui";

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
		stage = d.fulfilment,
		dispatched = stage === "dispatched" || stage === "delivered";
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
			route: "disputes",
			href: sellerHref(locale, "disputes", seller),
			icon: Shield,
			blocker: t.disputeBlocks,
		};
	if (
		order.payment_method === "advance" &&
		!dispatched &&
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
			<DetailTabs
				locale={locale}
				label={t.summary}
				tabs={[
					{
						id: "overview",
						label: t.overview,
						panel: <OverviewPanel order={order} locale={locale} />,
					},
					{
						id: "payment",
						label: t.paymentInvoice,
						panel: (
							<PaymentPanel
								order={order}
								locale={locale}
								seller={seller}
								canInvoice={canInvoice}
								busy={busy}
								onDownload={onDownload}
								canPayments={can("payments")}
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
				className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action"
			>
				<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
				{t.backToOrders}
			</Link>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-2">
					<h1 className="text-2xl font-bold tracking-tight">
						{c.orders} · <bdi>{order.number}</bdi>
					</h1>
					<p className="m-0 text-sm text-muted">
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
				href: sellerHref(locale, "disputes", seller),
				label: aftercareCopy[locale].disputes,
				Icon: Shield,
				show: can("disputes"),
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
		c = commerceCopy[locale],
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
		],
		paid =
			order.dimensions.financial === "paid" ||
			order.dimensions.financial === "overpaid";
	return (
		<DetailCard title={t.progress} icon="shopping-bag">
			<ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
				{stages.map((label, i) => {
					const done = i < active,
						current = i === active;
					return (
						<li key={label} className="flex items-center gap-2">
							{i > 0 && (
								<ChevronRight
									className="size-4 text-muted rtl:rotate-180"
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
									{done ? t.stageDone : current ? t.stageCurrent : t.stageUpcoming}
								</span>
							</span>
						</li>
					);
				})}
			</ol>
			<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-solid border-border pt-3">
				<Wallet className="size-4 text-muted" aria-hidden="true" />
				<span className="text-xs font-medium text-muted">{c.method}:</span>
				<Badge
					variant="secondary"
					className={cn(
						"border-0",
						paid ? "bg-success-surface text-success" : "bg-info text-action",
					)}
				>
					{paymentState(locale, order.dimensions.financial)}
				</Badge>
				<span className="text-xs text-muted">
					{order.payment_method === "advance" ? t.advanceTiming : t.codTiming}
				</span>
				{order.payment.overdue && (
					<Badge
						variant="secondary"
						className="border-0 bg-danger-surface text-danger"
					>
						{paymentCopy[locale].overdue}
					</Badge>
				)}
			</div>
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
	const list = orderListCopy[locale],
		c = commerceCopy[locale];
	return (
		<DetailCard title={list.products} icon="box" className={className}>
			<div className="space-y-4">
				{order.lines.map((line) => (
					<ProductLine
						key={line.id}
						line={line}
						order={order}
						locale={locale}
					/>
				))}
			</div>
			<div className="mt-4 flex items-center justify-between gap-3 border-t border-solid border-border pt-3">
				<span className="text-sm font-medium text-muted">{list.total}</span>
				<Money
					amount={order.goods_total}
					currency={order.currency}
					className="text-lg font-bold"
				/>
			</div>
			<p className="m-0 mt-3 text-xs text-muted">{c.frozen}</p>
		</DetailCard>
	);
}

function ProductLine({
	line,
	order,
	locale,
}: {
	line: OrderLine;
	order: Order;
	locale: Locale;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		title =
			line.snapshot.titles[locale] ??
			line.snapshot.titles[line.snapshot.source_locale] ??
			line.snapshot.sku,
		unit = line.snapshot.unit_labels[locale] ?? line.snapshot.unit,
		attrs = Object.entries(line.snapshot.definition.attributes ?? {});
	return (
		<div className="flex min-w-0 items-start gap-3">
			<ProductThumbnail key={line.image} src={line.image} className="size-14" />
			<div className="min-w-0 flex-1 space-y-1.5">
				<p className="m-0 break-words text-sm font-semibold" dir="auto">
					{title}
				</p>
				<p className="m-0 text-xs text-muted">
					{list.sku}: <bdi>{line.snapshot.sku}</bdi>
					<span aria-hidden="true" className="mx-1.5">
						·
					</span>
					{t.sellingOption}: {c[line.tier]}
					<span aria-hidden="true" className="mx-1.5">
						·
					</span>
					{unit}
				</p>
				{attrs.length > 0 && (
					<p className="m-0 break-words text-xs text-muted" dir="auto">
						{attrs.map(([key, value], i) => (
							<span key={key}>
								{i > 0 && (
									<span aria-hidden="true" className="mx-1.5">
										·
									</span>
								)}
								{line.snapshot.attribute_labels?.[key]?.[locale] ??
									line.snapshot.attribute_labels?.[key]?.["fa-AF"] ??
									key}
								: <bdi>{String(value)}</bdi>
							</span>
						))}
					</p>
				)}
				<dl className="m-0 grid grid-cols-3 gap-3">
					<DetailField label={list.quantity}>
						<bdi>{line.quantity.replace(/\.000$/, "")}</bdi> {unit}
					</DetailField>
					<DetailField label={list.unitPrice}>
						<Money amount={line.unit_price} currency={order.currency} />
					</DetailField>
					<DetailField label={t.lineTotal}>
						<Money
							amount={line.goods_amount}
							currency={order.currency}
							className="font-semibold"
						/>
					</DetailField>
				</dl>
				{line.snapshot.price_changed && (
					<p
						role="status"
						className="m-0 text-xs font-medium text-action"
					>
						{c.priceChanged}
						{line.snapshot.shown_price != null && (
							<>
								{" · "}
								{c.shownEstimate}:{" "}
								<Money
									amount={line.snapshot.shown_price}
									currency={order.currency}
								/>
							</>
						)}
						{" · "}
						{c.acceptedUnitPrice}:{" "}
						<Money amount={line.unit_price} currency={order.currency} />
					</p>
				)}
			</div>
		</div>
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
			<p className="m-0 mt-3 flex items-start gap-1.5 text-xs text-muted">
				<Icon name="lock" className="size-3.5 shrink-0" />
				<span>{t.recipientNote}</span>
			</p>
			{canFulfilment && (
				<Button
					asChild
					variant="outline"
					size="sm"
					className="mt-3 rounded-lg"
				>
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
		<div className="space-y-4">
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
			<p className="m-0 text-xs text-muted">{c.frozen}</p>
		</div>
	);
}

function PaymentPanel({
	order,
	locale,
	seller,
	canInvoice,
	busy,
	onDownload,
	canPayments,
}: {
	order: Order;
	locale: Locale;
	seller: string;
	canInvoice: boolean;
	busy: boolean;
	onDownload: () => void;
	canPayments: boolean;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		p = order.payment,
		zero = (value: string) => value === "0.00" || value === "0";
	return (
		<div className="space-y-4">
			<dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<DetailField label={t.acceptedTotal}>
					<Money amount={p.accepted_total} currency={order.currency} />
				</DetailField>
				<DetailField label={paymentCopy[locale].confirmed}>
					<Money amount={p.confirmed_total} currency={order.currency} />
				</DetailField>
				<DetailField label={paymentCopy[locale].remaining}>
					<Money amount={p.remaining} currency={order.currency} />
				</DetailField>
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
				<DetailField label={c.due}>
					{p.effective_due_at ? (
						<bdi>{localTimestamp(p.effective_due_at, locale)}</bdi>
					) : (
						list.unknown
					)}
					{p.overdue && (
						<Badge
							variant="secondary"
							className="ms-2 border-0 bg-danger-surface text-danger"
						>
							{paymentCopy[locale].overdue}
						</Badge>
					)}
				</DetailField>
			</dl>
			<p className="m-0 text-xs text-muted">
				{order.payment_method === "advance" ? t.advanceTiming : t.codTiming}
			</p>
			<div className="space-y-3 rounded-xl border border-solid border-border bg-page p-3">
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
			</div>
			{canPayments && (
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link href={salesHref(locale, "payments", seller, order.id)}>
						<Wallet className="size-3.5" aria-hidden="true" />
						{list.payments}
					</Link>
				</Button>
			)}
		</div>
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
	const t = orderDetailCopy[locale];
	return (
		<div className="space-y-4">
			<p className="m-0 text-xs text-muted">{t.activityHelp}</p>
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
				{can("disputes") && (
					<Button asChild variant="outline" size="sm" className="rounded-lg">
						<Link href={sellerHref(locale, "disputes", seller)}>
							<Shield className="size-3.5" aria-hidden="true" />
							{aftercareCopy[locale].disputes}
						</Link>
					</Button>
				)}
			</nav>
			<AftercareSection
				interactive
				locale={locale}
				context="seller"
				orderId={order.id}
				seller={seller}
			/>
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
		refs = useRef<(HTMLButtonElement | null)[]>([]),
		baseId = useId(),
		rtl = locale !== "en";
	function onKeyDown(event: React.KeyboardEvent) {
		let next = active;
		if (event.key === "ArrowRight") next = rtl ? active - 1 : active + 1;
		else if (event.key === "ArrowLeft") next = rtl ? active + 1 : active - 1;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = tabs.length - 1;
		else return;
		event.preventDefault();
		next = (next + tabs.length) % tabs.length;
		setActive(next);
		refs.current[next]?.focus();
	}
	return (
		<div className="min-w-0">
			<div
				role="tablist"
				aria-label={label}
				onKeyDown={onKeyDown}
				className="flex flex-wrap gap-1 border-b border-solid border-border"
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
						onClick={() => setActive(i)}
						className={cn(
							"-mb-px inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none",
							active === i
								? "border-border bg-surface text-action"
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
					tabIndex={0}
					className="min-w-0 rounded-b-2xl border border-t-0 border-border bg-surface p-4 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:p-6"
				>
					{active === i ? tab.panel : null}
				</div>
			))}
		</div>
	);
}