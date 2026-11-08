import { fulfilmentCopy, fulfilmentState } from "../copy";
import { aftercareCopy } from "../../aftercare/copy";
import { panel } from "../../orders/components/controls";
import type { Locale } from "../../../lib/i18n/locales";
import type { Summary } from "../types";
import { localTimestamp } from "../../messaging/api";
import { salesPanel } from "../../sales/components/seller-sales-ui";
export function DeliverySummary({
	locale,
	row,
	seller = false,
	compact = false,
}: {
	locale: Locale;
	row: Summary;
	seller?: boolean;
	compact?: boolean;
}) {
	const t = fulfilmentCopy[locale];
	if (seller) {
		const money = (fields: readonly (readonly [string, string | null])[]) => (
			<dl className="grid min-w-0 grid-cols-2 gap-4">
				{fields.map(([label, value]) => (
					<div key={label} className="min-w-0 space-y-1">
						<dt className="text-xs leading-relaxed text-muted">{label}</dt>
						<dd className="font-semibold tabular-nums wrap-anywhere">
							{value === null ? (
								<span className="text-warning">{t.unknownCharge}</span>
							) : (
								<bdi>
									{value} {row.currency}
								</bdi>
							)}
						</dd>
					</div>
				))}
			</dl>
		);
		return (
			<section className={salesPanel} aria-label={t.physical}>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 space-y-1">
						<h2
							className={compact ? "text-lg font-bold" : "text-xl font-bold"}
							tabIndex={-1}
							data-fulfilment-summary
						>
							<bdi>{row.number}</bdi>
						</h2>
						<p className="text-sm text-muted">
							<bdi>{row.destination.country ?? ""}</bdi> ·{" "}
							<span dir="auto">{row.destination.city ?? ""}</span>
						</p>
					</div>
					<strong className="rounded-full bg-info px-3 py-1 text-sm text-action">
						{fulfilmentState(locale, row.stage)}
					</strong>
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
					<p>
						{t.completion}:{" "}
						<span className="font-medium">
							{fulfilmentState(locale, row.completion)}
						</span>
					</p>
					<p>
						{t.method}:{" "}
						<span className="font-medium">
							{fulfilmentState(locale, row.payment_method)}
						</span>
					</p>
					<p>
						{t.allocation}:{" "}
						<span className="font-medium">
							{fulfilmentState(locale, row.allocation)}
						</span>
					</p>
				</div>
				<div
					className={
						compact
							? "grid min-w-0 gap-4 sm:grid-cols-2"
							: "grid min-w-0 gap-4 desktop:grid-cols-2"
					}
				>
					<div className="min-w-0 space-y-4 rounded-xl border border-border p-4">
						<h3 className="text-sm font-semibold">{t.title}</h3>
						{money([
							[t.total, row.goods_total],
							[t.goodsConfirmed, row.goods_confirmed],
							[t.goodsRemaining, row.goods_remaining],
						])}
					</div>
					<div className="min-w-0 space-y-4 rounded-xl border border-border p-4">
						<h3 className="text-sm font-semibold">{t.finalCharge}</h3>
						{money([
							[t.finalCharge, row.charge],
							[t.deliveryConfirmed, row.delivery_confirmed],
							[aftercareCopy[locale].providerRefunded, row.delivery_refunded],
							[t.deliveryRemaining, row.delivery_remaining],
							[t.deliveryExcess, row.delivery_excess],
						])}
						<dl className="space-y-3 border-t border-border pt-3 text-sm">
							<div>
								<dt className="text-xs text-muted">{t.provider}</dt>
								<dd className="mt-1 wrap-anywhere">
									<bdi>{row.provider || "—"}</bdi>
								</dd>
							</div>
							<div>
								<dt className="text-xs text-muted">{t.chargePayee}</dt>
								<dd className="mt-1 wrap-anywhere">
									<bdi>{row.charge_provider || "—"}</bdi>
								</dd>
							</div>
						</dl>
						<p className="text-sm font-medium">
							{row.charge === null
								? t.unknownCharge
								: row.charge === "0.00"
									? t.zero
									: row.delivery_settled
										? t.settled
										: t.unsettled}
						</p>
					</div>
				</div>
				{row.completed_at && (
					<p className="text-sm text-muted">
						{t.completion}:{" "}
						<bdi>{localTimestamp(row.completed_at, locale)}</bdi>
					</p>
				)}
				{row.cancellation_hold && (
					<p role="status" className="text-warning">
						{t.cancellation}
					</p>
				)}
				{row.dispute_open && (
					<p role="status" className="text-warning">
						{t.dispute}
					</p>
				)}
				{row.overdue && <p className="text-warning">{t.overdue}</p>}
				{row.dispatch_problem && (
					<p
						role="status"
						className="rounded-xl border border-warning bg-warning-surface p-3 text-sm"
					>
						{t.lastAttempt}: {fulfilmentState(locale, row.dispatch_problem)}
					</p>
				)}
				<p className="text-xs leading-relaxed text-muted">{t.noAuto}</p>
			</section>
		);
	}
	return (
		<section className={panel} aria-label={t.physical}>
			<p>
				<bdi>{row.destination.country ?? ""}</bdi> ·{" "}
				<span dir="auto">{row.destination.city ?? ""}</span>
			</p>
			<h2 className="text-xl font-bold" tabIndex={-1} data-fulfilment-summary>
				<bdi>{row.number}</bdi>
			</h2>
			<div className="flex flex-wrap gap-3">
				<strong className="rounded-control bg-info px-3 py-1">
					{fulfilmentState(locale, row.stage)}
				</strong>
				<span>{fulfilmentState(locale, row.completion)}</span>
				<span>
					{t.method}: {fulfilmentState(locale, row.payment_method)}
				</span>
			</div>
			<dl className="grid gap-4 sm:grid-cols-2 desktop:grid-cols-3">
				{[
					[t.goodsConfirmed, row.goods_confirmed],
					[t.goodsRemaining, row.goods_remaining],
					[t.finalCharge, row.charge],
					[t.deliveryConfirmed, row.delivery_confirmed],
					[aftercareCopy[locale].providerRefunded, row.delivery_refunded],
					[t.deliveryRemaining, row.delivery_remaining],
					[t.deliveryExcess, row.delivery_excess],
				].map(([label, value]) => (
					<div key={label}>
						<dt className="text-sm text-muted">{label}</dt>
						<dd className="font-bold break-words">
							{value === null ? (
								t.unknownCharge
							) : (
								<bdi>
									{value} {row.currency}
								</bdi>
							)}
						</dd>
					</div>
				))}
			</dl>
			<p>
				{t.provider}: <bdi>{row.provider || "—"}</bdi>
			</p>
			<p>
				{t.chargePayee}: <bdi>{row.charge_provider || "—"}</bdi> ·{" "}
				{row.delivery_settled ? t.settled : t.unsettled}
			</p>
			{row.completed_at && (
				<p>
					<bdi>{localTimestamp(row.completed_at, locale)}</bdi>
				</p>
			)}
			{row.cancellation_hold && (
				<p role="status" className="text-warning">
					{t.cancellation}
				</p>
			)}
			{row.dispute_open && (
				<p role="status" className="text-warning">
					{t.dispute}
				</p>
			)}
			<p>
				{t.allocation}: {fulfilmentState(locale, row.allocation)}
			</p>
			{row.overdue && <p className="text-warning">{t.overdue}</p>}
			{row.dispatch_problem && (
				<p
					role="status"
					className="rounded-control border border-warning bg-warning-surface p-3"
				>
					{t.lastAttempt}: {fulfilmentState(locale, row.dispatch_problem)}
				</p>
			)}
			<p className="text-sm text-muted">{t.noAuto}</p>
		</section>
	);
}
