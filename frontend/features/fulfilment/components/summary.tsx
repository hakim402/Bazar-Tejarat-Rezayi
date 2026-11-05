import { fulfilmentCopy, fulfilmentState } from "../copy";
import { panel } from "../../orders/components/controls";
import type { Locale } from "../../../lib/i18n/locales";
import type { Summary } from "../types";
import { localTimestamp } from "../../messaging/api";
export function DeliverySummary({
	locale,
	row,
}: {
	locale: Locale;
	row: Summary;
}) {
	const t = fulfilmentCopy[locale];
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
