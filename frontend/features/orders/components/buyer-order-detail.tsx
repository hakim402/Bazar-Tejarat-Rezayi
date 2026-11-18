"use client";
import Link from "next/link";
import { Button } from "../../../components/shadcn/button";
import { Icon, type IconName } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { cn } from "../../../lib/shadcn-utils";
import type { Locale } from "../../../lib/i18n/locales";
import { localTimestamp } from "../../messaging/api";
import { aftercareHref } from "../../aftercare/api";
import { aftercareCopy } from "../../aftercare/copy";
import { fulfilmentCopy, fulfilmentState } from "../../fulfilment/copy";
import { fulfilmentHref } from "../../fulfilment/api";
import { paymentCopy, paymentState } from "../../payments/copy";
import { paymentHref } from "../../payments/api";
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
	dueText,
} from "./order-ui";
import { DetailDialog, DialogBadge, DialogLink } from "./detail-dialog";
import { Failure, Disclosure, panel } from "./controls";

export function financialVariant(state: string) {
	switch (state) {
		case "paid":
			return "success";
		case "overpaid":
			return "accent";
		case "partial":
		case "unpaid":
			return "warning";
		default:
			return "neutral";
	}
}

const zero = (value: string) => value === "0.00" || value === "0";

export function BuyerOrderDetail({
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
		order = data && !("results" in data) && !("outcomes" in data) ? data : null;
	return (
		<section className="min-w-0 space-y-4" data-testid="orders-workspace">
			<Failure locale={locale} error={error} />
			{!data && !error ? (
				<div className={`${panel} min-h-40`} role="status">
					<p className="text-sm text-muted">{c.loading}</p>
				</div>
			) : !order ? (
				<EmptyState icon="inbox" title={c.unavailable} />
			) : (
				<>
					<BuyerOrderHeader
						order={order}
						locale={locale}
						busy={busy}
						onReload={onReload}
					/>
					<BuyerProgress order={order} locale={locale} />
					<div className="grid items-start gap-4 lg:grid-cols-3">
						<div className="space-y-4 lg:col-span-2">
							<BuyerProductsCard order={order} locale={locale} />
							<BuyerInvoice
								order={order}
								locale={locale}
								busy={busy}
								onDownload={() => onDownload(order)}
							/>
						</div>
						<div className="space-y-4">
							<BuyerPayment order={order} locale={locale} />
							<BuyerDelivery order={order} locale={locale} />
							<BuyerAftercare order={order} locale={locale} />
						</div>
					</div>
				</>
			)}
		</section>
	);
}

function BuyerOrderHeader({
	order,
	locale,
	busy,
	onReload,
}: {
	order: Order;
	locale: Locale;
	busy: boolean;
	onReload: () => void;
}) {
	const t = orderDetailCopy[locale],
		c = commerceCopy[locale],
		list = orderListCopy[locale],
		p = paymentCopy[locale],
		f = fulfilmentCopy[locale],
		d = order.dimensions,
		dest = order.snapshot.terms.destination,
		done =
			d.completion === "completed" ||
			d.completion === "completed_with_exception";
	return (
		<header className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					href={`/${locale}/account/buyer/orders`}
					className="inline-flex items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
				>
					<Icon name="arrow" className="size-4 ltr:rotate-180" />
					{t.backToOrders}
				</Link>
				<ReloadButton busy={busy} label={t.refresh} onReload={onReload} />
			</div>
			<div className="flex items-start gap-3">
				<span
					className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"
					aria-hidden="true"
				>
					<Icon name="shopping-bag" className="size-5" />
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
				{done && (
					<StatusBadge
						variant={d.completion === "completed" ? "success" : "warning"}
					>
						{fulfilmentState(locale, d.completion)}
					</StatusBadge>
				)}
				{order.payment.overdue && (
					<StatusBadge variant="danger">{p.overdue}</StatusBadge>
				)}
				{order.snapshot.origin === "negotiated" && (
					<StatusBadge variant="info">{c.negotiableShort}</StatusBadge>
				)}
				{d.dispute === "unresolved" && (
					<StatusBadge variant="danger">{list.dispute}</StatusBadge>
				)}
				{d.cancellation === "pending" && (
					<StatusBadge variant="warning">{list.cancelHold}</StatusBadge>
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
					{c.accepted}: <bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
				</span>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link href={paymentHref(locale, "buyer", order.id)}>
						<Icon name="wallet" className="size-3.5" />
						{p.title}
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link href={fulfilmentHref(locale, "buyer", order.id)}>
						<Icon name="truck" className="size-3.5" />
						{f.buyerTitle}
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link href={invoiceHref(locale, "buyer", order.invoice)}>
						<Icon name="receipt" className="size-3.5" />
						{list.invoice}
					</Link>
				</Button>
			</div>
		</header>
	);
}

function BuyerProgress({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		list = orderListCopy[locale],
		f = fulfilmentCopy[locale],
		d = order.dimensions,
		stage = d.fulfilment,
		steps: { label: string; icon: IconName; done: boolean }[] = [
			{ label: t.stageConfirmed, icon: "shopping-bag", done: true },
			{
				label: list.payment,
				icon: "wallet",
				done: d.financial === "paid" || d.financial === "overpaid",
			},
			{
				label: t.stagePreparation,
				icon: "box",
				done: ["prepared", "dispatched", "delivered"].includes(stage),
			},
			{
				label: t.stageDispatch,
				icon: "truck",
				done: ["dispatched", "delivered"].includes(stage),
			},
			{ label: t.stageDelivered, icon: "map-pin", done: stage === "delivered" },
			{
				label: f.completion,
				icon: "check-circle",
				done:
					d.completion === "completed" ||
					d.completion === "completed_with_exception",
			},
		],
		firstOpen = steps.findIndex((step) => !step.done),
		current = firstOpen === -1 ? steps.length - 1 : firstOpen,
		hold =
			d.cancellation === "pending"
				? t.cancellationBlocks
				: d.dispute === "unresolved"
					? t.disputeBlocks
					: null;
	return (
		<DetailCard title={t.progress} icon="shopping-bag" compact>
			{hold && (
				<p className="m-0 rounded-lg bg-warning-surface px-3 py-2 text-caption text-warning">
					{hold}
				</p>
			)}
			<ol className="m-0 flex list-none flex-col p-0 sm:flex-row sm:items-start">
				{steps.map((step, i) => {
					const isCurrent = i === current && !step.done,
						last = i === steps.length - 1;
					return (
						<li
							key={step.label}
							className="relative flex flex-1 items-start gap-3 pb-4 last:pb-0 sm:flex-col sm:items-center sm:gap-1.5 sm:pb-0 sm:text-center"
						>
							{!last && (
								<span
									aria-hidden="true"
									className={cn(
										"absolute z-0 start-[15px] top-8 bottom-0 w-0.5 sm:start-1/2 sm:top-[15px] sm:bottom-auto sm:h-0.5 sm:w-full",
										step.done ? "bg-success" : "bg-border",
									)}
								/>
							)}
							<span
								className={cn(
									"relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
									step.done
										? "border-success bg-success-surface text-success"
										: isCurrent
											? "border-action bg-info text-action ring-2 ring-action/20"
											: "border-border bg-page text-muted",
								)}
							>
								<Icon name={step.icon} className="size-4" />
							</span>
							<span className="min-w-0 flex-1 sm:w-full sm:flex-none">
								<span
									className={cn(
										"block text-xs font-medium leading-tight",
										step.done
											? "text-success"
											: isCurrent
												? "text-action"
												: "text-muted",
									)}
								>
									{step.label}
								</span>
								{isCurrent && (
									<span className="mt-0.5 block text-[11px] text-action">
										{t.stageCurrent}
									</span>
								)}
								<span className="sr-only">
									{step.done
										? t.stageDone
										: isCurrent
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

function BuyerPayment({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		c = commerceCopy[locale],
		p = paymentCopy[locale],
		a = aftercareCopy[locale],
		list = orderListCopy[locale],
		pay = order.payment,
		due = (value: string | null) => dueText(value, locale),
		timing = order.payment_method === "advance" ? t.advanceTiming : t.codTiming,
		overdueBadge = <OverdueBadge overdue={pay.overdue} locale={locale} />;
	return (
		<DetailCard title={t.paymentSummary} icon="wallet" compact>
			<PaymentSummaryCore order={order} locale={locale} />
			<DetailDialog
				locale={locale}
				icon="wallet"
				label={t.paymentDetails}
				title={t.paymentDetails}
				wide
				footer={
					<>
						<DialogLink
							href={paymentHref(locale, "buyer", order.id)}
							icon="wallet"
						>
							{p.title}
						</DialogLink>
						<DialogLink
							href={invoiceHref(locale, "buyer", order.invoice)}
							icon="receipt"
						>
							{list.invoice}
						</DialogLink>
					</>
				}
			>
				<div className="space-y-3 rounded-xl border border-border bg-page p-3">
					<h3 className="m-0 text-xs font-semibold text-muted">{p.title}</h3>
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={t.acceptedTotal}>
							<Money amount={pay.accepted_total} currency={order.currency} />
						</DetailField>
						<DetailField label={c.received}>
							<Money amount={pay.received} currency={order.currency} />
						</DetailField>
						<DetailField label={p.confirmed}>
							<Money amount={pay.confirmed_total} currency={order.currency} />
						</DetailField>
						<DetailField label={p.remaining}>
							<Money amount={pay.remaining} currency={order.currency} />
						</DetailField>
						{!zero(pay.overpayment) && (
							<DetailField label={p.overpayment}>
								<Money amount={pay.overpayment} currency={order.currency} />
							</DetailField>
						)}
						{!zero(pay.refunded) && (
							<DetailField label={a.refunded}>
								<Money amount={pay.refunded} currency={order.currency} />
							</DetailField>
						)}
						{!zero(pay.refund_due) && (
							<DetailField label={a.refundDue}>
								<Money amount={pay.refund_due} currency={order.currency} />
							</DetailField>
						)}
						<DetailField label={p.allocation}>
							{paymentState(locale, pay.allocation)}
						</DetailField>
						<DetailField label={p.originalDue}>
							{due(pay.original_due_at)}
						</DetailField>
						<DetailField label={p.effectiveDue}>
							{due(pay.effective_due_at)}
							{overdueBadge}
						</DetailField>
					</dl>
					<p className="m-0 text-xs text-muted">{timing}</p>
				</div>
				<div className="space-y-3 rounded-xl border border-border bg-page p-3">
					<h3 className="m-0 text-xs font-semibold text-muted">{t.summary}</h3>
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={t.origin}>
							{order.snapshot.origin === "negotiated"
								? t.originNegotiated
								: t.originDirect}
						</DetailField>
						<DetailField label={t.termsVersion}>
							<bdi>{order.snapshot.terms.version}</bdi>
						</DetailField>
						<DetailField label={c.accepted}>
							<bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
						</DetailField>
						<DetailField label={c.issued}>
							<bdi>{localTimestamp(order.issued_at, locale)}</bdi>
						</DetailField>
						<DetailField label={c.method}>
							{c[order.payment_method]}
						</DetailField>
					</dl>
					{order.snapshot.origin === "negotiated" && (
						<p className="m-0 rounded-xl bg-info p-3 text-sm">
							{negotiationCopy[locale].acceptedNotice}
						</p>
					)}
				</div>
				<Disclosure locale={locale} accepted />
			</DetailDialog>
		</DetailCard>
	);
}

function BuyerDelivery({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		c = commerceCopy[locale],
		f = fulfilmentCopy[locale],
		d = order.dimensions,
		dest = order.snapshot.terms.destination,
		chargeLabel =
			d.delivery_charge === "settled"
				? f.settled
				: d.delivery_charge === "unsettled"
					? f.unsettled
					: f.unknownCharge,
		charge = (
			<>
				{d.delivery_charge_amount ? (
					<Money amount={d.delivery_charge_amount} currency={order.currency} />
				) : (
					chargeLabel
				)}
				{d.delivery_charge_amount && (
					<span className="ms-2 text-xs text-muted">({chargeLabel})</span>
				)}
			</>
		);
	return (
		<DetailCard title={f.buyerTitle} icon="truck" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={c.destination}>
					<bdi>{dest.country}</bdi> · <span dir="auto">{dest.city}</span>
				</DetailField>
				<DetailField label={c.method}>{c[order.payment_method]}</DetailField>
				<DetailField label={f.finalCharge}>{charge}</DetailField>
			</dl>
			<DetailDialog
				locale={locale}
				icon="truck"
				label={t.deliveryDetails}
				title={t.deliveryDetails}
				footer={
					<DialogLink
						href={fulfilmentHref(locale, "buyer", order.id)}
						icon="truck"
					>
						{f.buyerTitle}
					</DialogLink>
				}
			>
				<div className="rounded-xl border border-border bg-page p-3">
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={c.destination}>
							<bdi>{dest.country}</bdi> · <span dir="auto">{dest.city}</span>
						</DetailField>
						<DetailField label={c.method}>
							{c[order.payment_method]}
						</DetailField>
						<DetailField label={f.finalCharge}>{charge}</DetailField>
						{d.delivery_remaining && (
							<DetailField label={f.deliveryRemaining}>
								<Money
									amount={d.delivery_remaining}
									currency={order.currency}
								/>
							</DetailField>
						)}
						{d.delivery_provider && (
							<DetailField label={f.provider}>
								<span dir="auto">{d.delivery_provider}</span>
							</DetailField>
						)}
						<DetailField label={f.completion}>
							{fulfilmentState(locale, d.completion)}
							{d.completed_at && (
								<span className="ms-2 text-xs text-muted">
									<bdi>{localTimestamp(d.completed_at, locale)}</bdi>
								</span>
							)}
						</DetailField>
						{d.dispatch_problem && (
							<DetailField label={f.blockers}>
								<span className="text-warning">
									{fulfilmentState(locale, d.dispatch_problem)}
								</span>
							</DetailField>
						)}
					</dl>
				</div>
				<p className="m-0 text-xs text-muted">{t.recipientNote}</p>
			</DetailDialog>
		</DetailCard>
	);
}

function BuyerInvoice({
	order,
	locale,
	busy,
	onDownload,
}: {
	order: Order;
	locale: Locale;
	busy: boolean;
	onDownload: () => void;
}) {
	const t = orderDetailCopy[locale],
		c = commerceCopy[locale],
		list = orderListCopy[locale],
		v = orderViewCopy[locale];
	return (
		<DetailCard title={v.invoiceLabel} icon="file" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={v.invoiceNumber}>
					<bdi>{order.number}</bdi>
				</DetailField>
				<DetailField label={c.issued}>
					<bdi>{localTimestamp(order.issued_at, locale)}</bdi>
				</DetailField>
				<DetailField label={list.total}>
					<Money
						amount={order.goods_total}
						currency={order.currency}
						className="font-semibold"
					/>
				</DetailField>
			</dl>
			<p className="m-0 text-xs text-muted">{t.invoiceHelp}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					className="rounded-lg"
					disabled={busy}
					onClick={onDownload}
				>
					<Icon name="arrow-down" className="size-3.5" />
					{list.pdf}
				</Button>
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link href={invoiceHref(locale, "buyer", order.invoice)}>
						<Icon name="eye" className="size-3.5" />
						{list.invoice}
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm" className="rounded-lg">
					<Link
						href={`${invoiceHref(locale, "buyer", order.invoice).split("?")[0]}/print`}
					>
						<Icon name="file" className="size-3.5" />
						{c.print}
					</Link>
				</Button>
			</div>
		</DetailCard>
	);
}

function BuyerAftercare({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderDetailCopy[locale],
		a = aftercareCopy[locale],
		p = paymentCopy[locale],
		list = orderListCopy[locale],
		d = order.dimensions,
		pay = order.payment,
		pending = d.cancellation === "pending",
		dispute = d.dispute === "unresolved",
		badge = pending ? (
			<DialogBadge variant="warning">{list.cancelHold}</DialogBadge>
		) : dispute ? (
			<DialogBadge variant="danger">{list.dispute}</DialogBadge>
		) : undefined,
		due = (value: string | null) =>
			value ? <bdi>{localTimestamp(value, locale)}</bdi> : list.unknown;
	return (
		<DetailCard title={a.buyerTitle} icon="return" compact>
			<p className="m-0 text-xs text-muted">{t.aftercareHelp}</p>
			<DetailDialog
				locale={locale}
				icon="return"
				label={t.aftercareDetails}
				title={a.title}
				wide
				badge={badge}
				footer={
					<DialogLink
						href={aftercareHref(locale, "buyer", order.id)}
						icon="return"
					>
						{a.openWorkspace}
					</DialogLink>
				}
			>
				<p className="m-0 text-sm text-muted">{a.intro}</p>
				{pending && (
					<p
						role="status"
						className="m-0 rounded-lg bg-warning-surface px-3 py-2 text-caption text-warning"
					>
						{a.cancellation_hold}
					</p>
				)}
				{dispute && (
					<p
						role="status"
						className="m-0 rounded-lg bg-danger-surface px-3 py-2 text-caption text-danger"
					>
						{t.disputeBlocks}
					</p>
				)}
				<div className="space-y-3 rounded-xl border border-border bg-page p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="text-sm text-muted">{a.originalTotal}</span>
						<Money
							amount={order.goods_total}
							currency={order.currency}
							className="font-semibold"
						/>
					</div>
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={a.acceptedTotal}>
							<Money amount={pay.accepted_total} currency={order.currency} />
						</DetailField>
						<DetailField label={a.received}>
							<Money amount={pay.received} currency={order.currency} />
						</DetailField>
						<DetailField label={a.refunded}>
							<Money amount={pay.refunded} currency={order.currency} />
						</DetailField>
						<DetailField label={a.refundDue}>
							<Money
								amount={pay.refund_due}
								currency={order.currency}
								className={
									zero(pay.refund_due)
										? undefined
										: "font-semibold text-warning"
								}
							/>
						</DetailField>
						<DetailField label={a.remainingDue}>
							<Money
								amount={pay.remaining}
								currency={order.currency}
								className="font-semibold"
							/>
						</DetailField>
						<DetailField label={a.balance}>
							<Money amount={pay.overpayment} currency={order.currency} />
						</DetailField>
					</dl>
					<dl className="m-0 grid gap-3 border-0 border-t border-solid border-border pt-3 sm:grid-cols-2">
						<DetailField label={p.originalDue}>
							{due(pay.original_due_at)}
						</DetailField>
						<DetailField label={p.effectiveDue}>
							{due(pay.effective_due_at)}
						</DetailField>
					</dl>
				</div>
			</DetailDialog>
		</DetailCard>
	);
}
