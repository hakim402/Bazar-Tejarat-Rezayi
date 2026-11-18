"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
	Download,
	Eye,
	Printer,
	RotateCcw,
	ShoppingBag,
	Truck,
	Wallet,
} from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { cn } from "../../../lib/shadcn-utils";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { localTimestamp } from "../../messaging/api";
import { aftercareHref } from "../../aftercare/api";
import { aftercareCopy } from "../../aftercare/copy";
import { fulfilmentHref } from "../../fulfilment/api";
import { fulfilmentCopy, fulfilmentState } from "../../fulfilment/copy";
import { deliveryListCopy } from "../../fulfilment/list-copy";
import { paymentHref } from "../../payments/api";
import { paymentCopy, paymentState } from "../../payments/copy";
import { negotiationCopy } from "../../negotiations/copy";
import { commerceCopy } from "../copy";
import { orderDetailCopy } from "../detail-copy";
import { orderListCopy } from "../list-copy";
import { orderViewCopy } from "../view-copy";
import { invoiceHref, type Order, type Page, type Submission } from "../api";
import {
	BuyerProductsCard,
	DetailCard,
	DetailField,
	Money,
	OverdueBadge,
	PaymentSummaryCore,
	ReloadButton,
	buyerLineImage,
	dueText,
} from "./order-ui";
import { DialogBadge } from "./detail-dialog";
import { OrderProducts, OrderStatuses } from "./seller-orders-table";
import { financialVariant } from "./buyer-order-detail";
import { Failure, Disclosure, panel } from "./controls";
import {
	BuyerTableFrame,
	BuyerToolbar,
	BuyerTableRegion,
	BuyerRowMenu,
	buyerRow,
	buyerCell,
} from "./buyer-ui";

const withImages = (order: Order): Order => ({
	...order,
	lines: order.lines.map((line) => ({
		...line,
		image: buyerLineImage(order, line),
	})),
});

export function BuyerInvoices({
	locale,
	data,
	error,
	page,
	busy,
	onDownload,
	onReload,
}: {
	locale: Locale;
	data: Page<Order> | Order | Page<Submission> | Submission | null;
	error: unknown;
	page: number;
	busy: boolean;
	onDownload: (order: Order) => void;
	onReload: () => void;
}) {
	const t = commerceCopy[locale],
		p = paymentCopy[locale],
		ol = orderListCopy[locale],
		l = deliveryListCopy[locale],
		router = useRouter(),
		search = useSearchParams(),
		q = search.get("q") ?? "",
		state = search.get("state") ?? "",
		[searchDraft, setSearchDraft] = useState(q),
		list = data && "results" in data ? data : null,
		rows = list
			? list.results.filter((r): r is Order => !("outcomes" in r))
			: [],
		filtered = Boolean(q || state),
		href = (next: number, nextState = state, nextQ = q) =>
			`?page=${next}${nextState ? `&state=${encodeURIComponent(nextState)}` : ""}${nextQ ? `&q=${encodeURIComponent(nextQ)}` : ""}`,
		tabs: [string, string][] = [
			["", p.all],
			["unpaid", paymentState(locale, "unpaid")],
			["partial", paymentState(locale, "partial")],
			["paid", paymentState(locale, "paid")],
			["overpaid", paymentState(locale, "overpaid")],
			["overdue", paymentState(locale, "overdue")],
		],
		detailHref = (order: Order) => invoiceHref(locale, "buyer", order.invoice),
		withReturn = (target: string) => {
			const extra = new URLSearchParams();
			if (page > 1) extra.set("list_page", String(page));
			if (state) extra.set("list_state", state);
			if (q) extra.set("list_q", q);
			return extra.size
				? `${target}${target.includes("?") ? "&" : "?"}${extra}`
				: target;
		},
		identity = (order: Order) => (
			<div className="flex min-w-0 flex-col gap-1">
				<Link
					href={withReturn(detailHref(order))}
					className="text-sm font-semibold text-action no-underline hover:text-foreground"
				>
					<bdi>{order.number}</bdi>
				</Link>
				<span
					className="max-w-44 truncate text-xs text-muted"
					dir="auto"
					title={order.snapshot.seller}
				>
					{order.snapshot.seller}
				</span>
				<time
					dateTime={order.issued_at}
					className="block text-xs leading-relaxed text-muted"
				>
					{localTimestamp(order.issued_at, locale)}
				</time>
			</div>
		),
		amount = (order: Order) => (
			<div className="flex flex-col gap-1">
				<p className="m-0 whitespace-nowrap text-sm font-semibold tabular-nums">
					<Money amount={order.goods_total} currency={order.currency} />
				</p>
				<p className="m-0 text-xs text-muted">
					{order.payment_method === "cod" ? t.cod : t.advance}
				</p>
				<p className="m-0 text-xs text-muted">
					{p.remaining}:{" "}
					<Money amount={order.payment.remaining} currency={order.currency} />
				</p>
			</div>
		),
		due = (order: Order) => (
			<span
				className={cn(
					"whitespace-nowrap text-sm",
					order.payment.overdue ? "font-medium text-danger" : "text-muted",
				)}
			>
				{dueText(order.payment.effective_due_at, locale)}
			</span>
		),
		menu = (order: Order) => (
			<BuyerRowMenu
				locale={locale}
				label={`${ol.actions}: ${order.number}`}
				links={[
					{
						href: withReturn(detailHref(order)),
						label: ol.invoice,
						Icon: Eye,
					},
					{
						href: `/${locale}/account/buyer/orders/${order.id}`,
						label: t.viewOrder,
						Icon: ShoppingBag,
					},
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
						href: aftercareHref(locale, "buyer", order.id),
						label: ol.aftercare,
						Icon: RotateCcw,
					},
				]}
				actions={[
					{
						label: ol.pdf,
						Icon: Download,
						onSelect: () => onDownload(order),
						disabled: busy,
					},
				]}
			/>
		);
	return (
		<section
			className="flex min-w-0 flex-col gap-4"
			data-testid="orders-workspace"
		>
			<header className="min-w-0">
				<h1 className="m-0 text-2xl font-bold">{t.invoices}</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.invoicesDescription}</p>
			</header>
			<BuyerToolbar
				locale={locale}
				tabs={tabs}
				state={state}
				onTab={(value) => router.push(href(1, value, q))}
				searchPlaceholder={t.searchInvoice}
				searchAction={l.searchAction}
				searchDraft={searchDraft}
				setSearchDraft={setSearchDraft}
				onSearch={() => router.push(href(1, state, searchDraft.trim()))}
				onClear={() => {
					setSearchDraft("");
					router.push(href(1, "", ""));
				}}
			/>
			<Failure locale={locale} error={error} />
			<BuyerTableFrame
				locale={locale}
				title={t.invoices}
				count={list?.count ?? null}
				page={page}
				onPage={(next) => router.push(href(next))}
				pageHref={href}
				onRefresh={onReload}
				busy={busy || (!data && !error)}
			>
				{!data && !error ? (
					<p role="status" className="m-0 px-5 py-10 text-sm text-muted">
						{t.loading}
					</p>
				) : rows.length === 0 ? (
					<div className="px-5 py-6">
						<EmptyState
							borderless
							icon="receipt"
							title={
								filtered ? sellerSalesCopy[locale].noMatches : t.invoicesEmpty
							}
							description={
								filtered ? sellerSalesCopy[locale].noMatchesHelp : undefined
							}
						/>
					</div>
				) : (
					<>
						<BuyerTableRegion
							label={t.invoices}
							minWidth="68rem"
							head={[
								t.invoice,
								ol.products,
								ol.total,
								ol.status,
								p.effectiveDue,
								ol.actions,
							]}
						>
							{rows.map((order) => (
								<tr key={order.id} className={buyerRow}>
									<td className={buyerCell}>{identity(order)}</td>
									<td className={`${buyerCell} min-w-72`}>
										<OrderProducts order={withImages(order)} locale={locale} />
									</td>
									<td className={buyerCell}>{amount(order)}</td>
									<td className={buyerCell}>
										<OrderStatuses order={order} locale={locale} />
									</td>
									<td className={buyerCell}>{due(order)}</td>
									<td className="px-4 py-3 text-end align-top">
										<div className="flex items-center justify-end">
											{menu(order)}
										</div>
									</td>
								</tr>
							))}
						</BuyerTableRegion>
						<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
							{rows.map((order) => (
								<li key={order.id} className="flex flex-col gap-3 p-4">
									<div className="flex items-start justify-between gap-3">
										{identity(order)}
										{menu(order)}
									</div>
									<OrderProducts order={withImages(order)} locale={locale} />
									<div className="grid grid-cols-1 gap-3 rounded-xl border border-solid border-border p-3 sm:grid-cols-2">
										{amount(order)}
										<OrderStatuses order={order} locale={locale} />
										{due(order)}
									</div>
								</li>
							))}
						</ul>
					</>
				)}
			</BuyerTableFrame>
		</section>
	);
}

export function BuyerInvoiceDetail({
	locale,
	data,
	error,
	busy,
	onDownload,
	onReload,
}: {
	locale: Locale;
	data: Page<Order> | Order | Page<Submission> | Submission | null;
	error: unknown;
	busy: boolean;
	onDownload: (order: Order) => void;
	onReload: () => void;
}) {
	const c = commerceCopy[locale],
		search = useSearchParams(),
		order = data && !("results" in data) && !("outcomes" in data) ? data : null,
		backHref = (() => {
			const backPage = Number(search.get("list_page") ?? 1),
				backState = search.get("list_state") ?? "",
				backQ = search.get("list_q") ?? "",
				params = new URLSearchParams();
			if (Number.isInteger(backPage) && backPage > 1 && backPage <= 10000)
				params.set("page", String(backPage));
			if (
				["unpaid", "partial", "paid", "overpaid", "overdue"].includes(backState)
			)
				params.set("state", backState);
			if (backQ) params.set("q", backQ.slice(0, 100));
			const query = params.toString();
			return `/${locale}/account/buyer/invoices${query ? `?${query}` : ""}`;
		})();
	return (
		<section
			className="flex min-w-0 flex-col gap-4"
			data-testid="orders-workspace"
		>
			<Failure locale={locale} error={error} />
			{!data && !error ? (
				<div className={`${panel} min-h-40`} role="status">
					<p className="m-0 text-sm text-muted">{c.loading}</p>
				</div>
			) : !order ? (
				<EmptyState icon="inbox" title={c.unavailable} />
			) : (
				<>
					<InvoiceHeader
						order={order}
						locale={locale}
						busy={busy}
						backHref={backHref}
						onDownload={() => onDownload(order)}
						onReload={onReload}
					/>
					<div className="grid items-start gap-4 lg:grid-cols-3">
						<div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
							<BuyerProductsCard order={order} locale={locale} invoice />
							<InvoiceDocument order={order} locale={locale} />
						</div>
						<div className="flex min-w-0 flex-col gap-4">
							<InvoicePayment order={order} locale={locale} />
							<InvoiceDelivery order={order} locale={locale} />
							<InvoiceAftercare order={order} locale={locale} />
						</div>
					</div>
				</>
			)}
		</section>
	);
}

function InvoiceHeader({
	order,
	locale,
	busy,
	backHref,
	onDownload,
	onReload,
}: {
	order: Order;
	locale: Locale;
	busy: boolean;
	backHref: string;
	onDownload: () => void;
	onReload: () => void;
}) {
	const c = commerceCopy[locale],
		ol = orderListCopy[locale],
		p = paymentCopy[locale],
		d = order.dimensions,
		dest = order.snapshot.terms.destination;
	return (
		<header className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					href={backHref}
					className="inline-flex items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
				>
					<Icon name="arrow" className="size-4 ltr:rotate-180" />
					{c.backToInvoices}
				</Link>
				<ReloadButton busy={busy} label={c.reload} onReload={onReload} />
			</div>
			<div className="flex items-start gap-3">
				<span
					className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"
					aria-hidden="true"
				>
					<Icon name="receipt" className="size-5" />
				</span>
				<div className="min-w-0 flex-1 space-y-1">
					<h1 className="m-0 text-page-title font-bold">
						<bdi>{order.number}</bdi>
					</h1>
					<p className="m-0 text-sm text-muted" dir="auto">
						{order.snapshot.seller}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-1.5">
				<StatusBadge variant={financialVariant(d.financial)}>
					{paymentState(locale, d.financial)}
				</StatusBadge>
				<StatusBadge variant={statusVariant(d.fulfilment)}>
					{fulfilmentState(locale, d.fulfilment)}
				</StatusBadge>
				{order.payment.overdue && (
					<StatusBadge variant="danger">{p.overdue}</StatusBadge>
				)}
				{order.snapshot.origin === "negotiated" && (
					<StatusBadge variant="info">{c.negotiableShort}</StatusBadge>
				)}
				{d.dispute === "unresolved" && (
					<StatusBadge variant="danger">{ol.dispute}</StatusBadge>
				)}
				{d.cancellation === "pending" && (
					<StatusBadge variant="warning">{ol.cancelHold}</StatusBadge>
				)}
			</div>
			<div className="flex flex-wrap gap-2 text-caption text-muted">
				{(dest.country || dest.city) && (
					<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
						<Icon name="map-pin" className="size-3.5" />
						<bdi>{dest.country}</bdi>
						{dest.city && (
							<>
								{" · "}
								<span dir="auto">{dest.city}</span>
							</>
						)}
					</span>
				)}
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="wallet" className="size-3.5" />
					{c[order.payment_method]}
				</span>
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="clock" className="size-3.5" />
					{c.issued}: <bdi>{localTimestamp(order.issued_at, locale)}</bdi>
				</span>
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="clock" className="size-3.5" />
					{c.accepted}: <bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
				</span>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					className="rounded-lg"
					disabled={busy}
					onClick={onDownload}
				>
					<Download className="size-3.5" />
					{ol.pdf}
				</Button>
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link
						href={`${invoiceHref(locale, "buyer", order.invoice).split("?")[0]}/print`}
					>
						<Printer className="size-3.5" />
						{c.print}
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link href={`/${locale}/account/buyer/orders/${order.id}`}>
						<ShoppingBag className="size-3.5" />
						{c.viewOrder}
					</Link>
				</Button>
			</div>
		</header>
	);
}

function InvoiceDocument({ order, locale }: { order: Order; locale: Locale }) {
	const c = commerceCopy[locale],
		t = orderDetailCopy[locale],
		v = orderViewCopy[locale],
		p = paymentCopy[locale],
		dest = order.snapshot.terms.destination,
		overdueBadge = (
			<OverdueBadge overdue={order.payment.overdue} locale={locale} />
		);
	return (
		<DetailCard title={v.invoiceLabel} icon="file" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={v.invoiceNumber}>
					<bdi>{order.number}</bdi>
				</DetailField>
				<DetailField label={c.issued}>
					<bdi>{localTimestamp(order.issued_at, locale)}</bdi>
				</DetailField>
				<DetailField label={c.accepted}>
					<bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
				</DetailField>
				<DetailField label={t.termsVersion}>
					<bdi>{order.snapshot.terms.version}</bdi>
				</DetailField>
				<DetailField label={t.origin}>
					{order.snapshot.origin === "negotiated"
						? t.originNegotiated
						: t.originDirect}
				</DetailField>
				<DetailField label={c.method}>{c[order.payment_method]}</DetailField>
				<DetailField label={c.destination}>
					<bdi>{dest.country}</bdi> · <span dir="auto">{dest.city}</span>
				</DetailField>
				<DetailField label={p.effectiveDue}>
					{dueText(order.payment.effective_due_at, locale)}
					{overdueBadge}
				</DetailField>
			</dl>
			{order.snapshot.origin === "negotiated" && (
				<p className="m-0 rounded-xl bg-info p-3 text-sm">
					{negotiationCopy[locale].acceptedNotice}
				</p>
			)}
			<Disclosure locale={locale} accepted />
			<p className="m-0 text-xs text-muted">{t.invoiceHelp}</p>
		</DetailCard>
	);
}

function InvoicePayment({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		p = paymentCopy[locale];
	return (
		<DetailCard title={t.paymentSummary} icon="wallet" compact>
			<PaymentSummaryCore order={order} locale={locale} />
			<Button asChild variant="outline" size="sm" className="rounded-lg">
				<Link href={paymentHref(locale, "buyer", order.id)}>
					<Wallet className="size-3.5" />
					{p.title}
				</Link>
			</Button>
		</DetailCard>
	);
}

function InvoiceDelivery({ order, locale }: { order: Order; locale: Locale }) {
	const c = commerceCopy[locale],
		f = fulfilmentCopy[locale],
		d = order.dimensions,
		dest = order.snapshot.terms.destination,
		chargeLabel =
			d.delivery_charge === "settled"
				? f.settled
				: d.delivery_charge === "unsettled"
					? f.unsettled
					: f.unknownCharge;
	return (
		<DetailCard title={f.buyerTitle} icon="truck" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={c.destination}>
					<bdi>{dest.country}</bdi> · <span dir="auto">{dest.city}</span>
				</DetailField>
				<DetailField label={c.method}>{c[order.payment_method]}</DetailField>
				<DetailField label={f.finalCharge}>
					{d.delivery_charge_amount ? (
						<Money
							amount={d.delivery_charge_amount}
							currency={order.currency}
						/>
					) : (
						chargeLabel
					)}
					{d.delivery_charge_amount && (
						<span className="ms-2 text-xs text-muted">({chargeLabel})</span>
					)}
				</DetailField>
				<DetailField label={f.completion}>
					{fulfilmentState(locale, d.completion)}
					{d.completed_at && (
						<span className="ms-2 text-xs text-muted">
							<bdi>{localTimestamp(d.completed_at, locale)}</bdi>
						</span>
					)}
				</DetailField>
			</dl>
			<Button asChild variant="outline" size="sm" className="rounded-lg">
				<Link href={fulfilmentHref(locale, "buyer", order.id)}>
					<Truck className="size-3.5" />
					{f.buyerTitle}
				</Link>
			</Button>
		</DetailCard>
	);
}

function InvoiceAftercare({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		a = aftercareCopy[locale],
		ol = orderListCopy[locale],
		d = order.dimensions,
		pending = d.cancellation === "pending",
		dispute = d.dispute === "unresolved";
	return (
		<DetailCard title={a.buyerTitle} icon="return" compact>
			<p className="m-0 text-xs text-muted">{t.aftercareHelp}</p>
			{(pending || dispute) && (
				<div className="flex flex-wrap gap-1.5">
					{pending && (
						<DialogBadge variant="warning">{ol.cancelHold}</DialogBadge>
					)}
					{dispute && <DialogBadge variant="danger">{ol.dispute}</DialogBadge>}
				</div>
			)}
			<Button asChild variant="outline" size="sm" className="rounded-lg">
				<Link href={aftercareHref(locale, "buyer", order.id)}>
					<RotateCcw className="size-3.5" />
					{a.openWorkspace}
				</Link>
			</Button>
		</DetailCard>
	);
}
