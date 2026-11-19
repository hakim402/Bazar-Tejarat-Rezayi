"use client";
import Image from "next/image";
import { Package } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "../../../components/shadcn/badge";
import { Card } from "../../../components/shadcn/card";
import { Icon, type IconName } from "../../../components/ui/icon";
import { apiOrigin } from "../../../lib/api/client";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { localTimestamp } from "../../messaging/api";
import { negotiationCopy } from "../../negotiations/copy";
import { paymentCopy } from "../../payments/copy";
import type { Order, OrderLine } from "../api";
import { commerceCopy } from "../copy";
import { orderDetailCopy } from "../detail-copy";
import { orderListCopy } from "../list-copy";

// List payloads may omit line images; the buyer order-scoped endpoint still
// serves them, with a graceful placeholder when no image exists.
export const buyerLineImage = (order: Order, line: OrderLine) =>
	line.image ??
	`/api/v1/orders/buyer/orders/${order.id}/lines/${line.id}/image/`;

export function ProductThumbnail({
	src,
	className,
}: {
	src?: string | null;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<span
			className={cn(
				"relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-solid border-border bg-page text-muted",
				className,
			)}
		>
			{src && !failed ? (
				<Image
					src={apiOrigin(process.env.NEXT_PUBLIC_API_URL) + src}
					alt=""
					fill
					sizes="48px"
					unoptimized
					className="object-cover"
					onError={() => setFailed(true)}
				/>
			) : (
				<Package className="size-5" aria-hidden="true" />
			)}
		</span>
	);
}

export function DetailCard({
	title,
	icon,
	action,
	children,
	className,
	compact = false,
}: {
	title: string;
	icon?: IconName;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	compact?: boolean;
}) {
	return (
		<Card
			className={cn(
				"gap-0 rounded-xl border-solid border-border bg-surface py-0 shadow-none",
				className,
			)}
		>
			<div
				className={cn(
					"flex items-center justify-between gap-3 border-0 border-b border-solid border-border px-4",
					compact ? "py-2.5" : "py-3.5 sm:px-5",
				)}
			>
				<h2
					className={cn(
						"m-0 flex items-center gap-2 font-semibold",
						compact ? "text-caption" : "text-sm",
					)}
				>
					{icon && (
						<Icon
							name={icon}
							className={cn("text-muted", compact ? "size-3.5" : "size-4")}
						/>
					)}
					{title}
				</h2>
				{action}
			</div>
			<div
				className={cn(
					"flex flex-1 flex-col gap-6 px-4 py-4 [&>button]:mt-auto",
					!compact && "sm:px-5",
				)}
			>
				{children}
			</div>
		</Card>
	);
}

export function DetailField({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0 space-y-1", className)}>
			<dt className="text-xs font-medium text-muted">{label}</dt>
			<dd className="m-0 text-sm font-medium text-foreground">{children}</dd>
		</div>
	);
}

export function Money({
	amount,
	currency,
	className,
}: {
	amount: string;
	currency: string;
	className?: string;
}) {
	return (
		<bdi className={cn("tabular-nums", className)}>
			{amount} {currency}
		</bdi>
	);
}

export const dueText = (value: string | null, locale: Locale) =>
	value ? (
		<bdi>{localTimestamp(value, locale)}</bdi>
	) : (
		orderListCopy[locale].unknown
	);

export function OverdueBadge({
	overdue,
	locale,
}: {
	overdue: boolean;
	locale: Locale;
}) {
	if (!overdue) return null;
	return (
		<Badge
			variant="secondary"
			className="ms-2 border-0 bg-danger-surface text-danger"
		>
			{paymentCopy[locale].overdue}
		</Badge>
	);
}

export function ReloadButton({
	busy,
	label,
	onReload,
}: {
	busy: boolean;
	label: string;
	onReload: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onReload}
			disabled={busy}
			aria-label={label}
			title={label}
			className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-action transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
		>
			<Icon
				name="history"
				className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
			/>
		</button>
	);
}

// One line-item row for the buyer order and invoice records; the invoice
// variant resolves thumbnails through the order-scoped endpoint and shows the
// increment/minimum/source terms.
export function BuyerOrderLine({
	line,
	order,
	locale,
	invoice = false,
}: {
	line: OrderLine;
	order: Order;
	locale: Locale;
	invoice?: boolean;
}) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		c = commerceCopy[locale],
		title =
			line.snapshot.titles[locale] ??
			line.snapshot.titles[line.snapshot.source_locale] ??
			line.snapshot.sku,
		unit = line.snapshot.unit_labels[locale] ?? line.snapshot.unit,
		attrs = Object.entries(line.snapshot.definition.attributes ?? {}),
		source = line.snapshot.titles[locale]
			? locale
			: line.snapshot.source_locale,
		image = invoice ? buyerLineImage(order, line) : line.image;
	return (
		<div className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
			<ProductThumbnail key={image} src={image} className="size-14" />
			<div className="min-w-0 flex-1 space-y-1">
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
				{line.snapshot.definition.contents && (
					<p
						className="m-0 break-words text-xs text-muted"
						dir="auto"
						lang={line.snapshot.source_locale}
					>
						{c.source} · <bdi>{line.snapshot.source_locale}</bdi>:{" "}
						{line.snapshot.definition.contents}
					</p>
				)}
				{invoice && (
					<p className="m-0 text-xs text-muted">
						{c.increment}: <bdi>{line.snapshot.increment}</bdi>
						{line.tier === "wholesale" && (
							<>
								{" · "}
								{c.minimum}: <bdi>{line.snapshot.minimum}</bdi>
							</>
						)}
						{source !== locale && (
							<>
								{" · "}
								{c.source}: <bdi>{source}</bdi>
							</>
						)}
					</p>
				)}
				<dl className="m-0 grid grid-cols-3 gap-2">
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
				{order.snapshot.origin === "negotiated" &&
					line.snapshot.max_quantity && (
						<p className="m-0 text-xs text-muted">
							{negotiationCopy[locale].limits}:{" "}
							<bdi>
								{line.snapshot.max_quantity} {unit} ·{" "}
								{line.snapshot.max_unit_price} {order.currency}
							</bdi>
						</p>
					)}
				{line.snapshot.price_changed && (
					<p role="status" className="m-0 text-xs font-medium text-action">
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

export function BuyerProductsCard({
	order,
	locale,
	invoice = false,
	className,
}: {
	order: Order;
	locale: Locale;
	invoice?: boolean;
	className?: string;
}) {
	const list = orderListCopy[locale];
	return (
		<DetailCard title={list.products} icon="box" className={className} compact>
			<div className="divide-y divide-border">
				{order.lines.map((line) => (
					<BuyerOrderLine
						key={line.id}
						line={line}
						order={order}
						locale={locale}
						invoice={invoice}
					/>
				))}
			</div>
			<div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-page px-3 py-2">
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

export function PaymentSummaryCore({
	order,
	locale,
	extra,
	columns = 2,
	dueLabel,
}: {
	order: Order;
	locale: Locale;
	extra?: ReactNode;
	columns?: 2 | 3;
	dueLabel?: string;
}) {
	const t = orderDetailCopy[locale],
		p = paymentCopy[locale],
		pay = order.payment,
		timing = order.payment_method === "advance" ? t.advanceTiming : t.codTiming;
	return (
		<>
			<dl
				className={cn(
					"m-0 grid gap-3 sm:grid-cols-2",
					columns === 3 && "lg:grid-cols-3",
				)}
			>
				<DetailField label={t.acceptedTotal}>
					<Money amount={pay.accepted_total} currency={order.currency} />
				</DetailField>
				<DetailField label={p.confirmed}>
					<Money amount={pay.confirmed_total} currency={order.currency} />
				</DetailField>
				<DetailField label={p.remaining}>
					<Money
						amount={pay.remaining}
						currency={order.currency}
						className="font-semibold"
					/>
				</DetailField>
				{extra}
				<DetailField label={dueLabel ?? p.effectiveDue}>
					{dueText(pay.effective_due_at, locale)}
					<OverdueBadge overdue={pay.overdue} locale={locale} />
				</DetailField>
			</dl>
			<p className="m-0 text-xs text-muted">{timing}</p>
		</>
	);
}
