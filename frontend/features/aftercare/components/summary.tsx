import type { Locale } from "../../../lib/i18n/locales";
import { localTimestamp } from "../../messaging/api";
import { panel } from "../../orders/components/controls";
import { salesPanel } from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { aftercareCopy } from "../copy";
import type { Detail, Line, Money } from "../types";

export function MoneySummary({
	locale,
	money,
	currency,
	seller = false,
}: {
	locale: Locale;
	money: Money;
	currency: string;
	seller?: boolean;
}) {
	const t = aftercareCopy[locale];
	return (
		<dl
			className={
				seller
					? "grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"
					: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
			}
		>
			{[
				[t.acceptedTotal, money.accepted_total],
				[t.received, money.received],
				[t.refunded, money.refunded],
				[t.refundDue, money.refund_due],
				[t.remainingDue, money.remaining],
				[t.balance, money.overpayment],
			].map(([label, value]) => (
				<div
					key={label}
					className={
						seller
							? "min-w-0 space-y-1 rounded-xl border border-border p-3"
							: undefined
					}
				>
					<dt className="text-sm text-muted">{label}</dt>
					<dd
						className={
							seller ? "font-semibold tabular-nums wrap-anywhere" : undefined
						}
					>
						<bdi>
							{value} {currency}
						</bdi>
					</dd>
				</div>
			))}
		</dl>
	);
}
export function AftercareSummary({
	locale,
	row,
	compact = false,
	seller = false,
}: {
	locale: Locale;
	row: Detail;
	compact?: boolean;
	seller?: boolean;
}) {
	const t = aftercareCopy[locale];
	return (
		<div
			className={
				compact ? "space-y-3" : seller ? salesPanel : `${panel} space-y-4`
			}
		>
			{seller && !compact && (
				<h2 className="text-xl font-bold">{sellerSalesCopy[locale].details}</h2>
			)}
			{seller ? (
				<dl className="rounded-xl border border-border bg-info p-3">
					<dt className="text-sm text-muted">{t.originalTotal}</dt>
					<dd className="mt-1 font-semibold tabular-nums wrap-anywhere">
						<bdi>
							{row.goods_total} {row.currency}
						</bdi>
					</dd>
				</dl>
			) : (
				<p>
					{t.originalTotal}:{" "}
					<bdi>
						{row.goods_total} {row.currency}
					</bdi>
				</p>
			)}
			<MoneySummary
				{...{ locale, money: row.payment, currency: row.currency, seller }}
			/>
			{row.aftercare.cancelled && <p role="status">{t.cancelled}</p>}
			{row.cancellations.some((item) => item.state === "pending") && (
				<p role="status">{t.cancellation_hold}</p>
			)}
			{!compact && (
				<dl className="flex flex-wrap gap-5">
					{[
						[t.originalDue, row.payment.original_due_at],
						[t.effectiveDue, row.payment.effective_due_at],
					].map(([label, date]) => (
						<div key={label}>
							<dt className="text-sm text-muted">{label}</dt>
							<dd>
								<bdi>{date ? localTimestamp(date, locale) : "—"}</bdi>
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}
export function AcceptedLines({
	locale,
	lines,
	currency,
	seller = false,
}: {
	locale: Locale;
	lines: Line[];
	currency: string;
	seller?: boolean;
}) {
	const t = aftercareCopy[locale];
	return (
		<ul className={seller ? "grid min-w-0 gap-3 lg:grid-cols-2" : "space-y-3"}>
			{lines.map((line) => (
				<li
					key={line.line}
					className={
						seller
							? "min-w-0 space-y-3 rounded-xl border border-border p-4"
							: "rounded-control border border-border p-3"
					}
				>
					<p
						dir="auto"
						className={seller ? "font-semibold wrap-anywhere" : undefined}
					>
						{line.titles?.[locale] ?? line.sku ?? line.line}
					</p>
					<p
						className={
							seller ? "text-sm text-muted wrap-anywhere" : "break-words"
						}
					>
						<bdi>{line.sku ?? line.line}</bdi>
					</p>
					{seller ? (
						<dl className="grid gap-3 sm:grid-cols-2">
							<div>
								<dt className="text-sm text-muted">{t.quantity}</dt>
								<dd className="tabular-nums wrap-anywhere">
									<bdi>
										{line.quantity} {line.unit_labels?.[locale] ?? line.unit}
									</bdi>
								</dd>
							</div>
							<div>
								<dt className="text-sm text-muted">{t.unitPrice}</dt>
								<dd className="tabular-nums wrap-anywhere">
									<bdi>
										{line.unit_price} {currency}
									</bdi>
								</dd>
							</div>
							{line.goods_amount && (
								<div>
									<dt className="text-sm text-muted">{t.total}</dt>
									<dd className="font-semibold tabular-nums wrap-anywhere">
										<bdi>
											{line.goods_amount} {currency}
										</bdi>
									</dd>
								</div>
							)}
						</dl>
					) : (
						<>
							<p>
								{t.quantity}:{" "}
								<bdi>
									{line.quantity} {line.unit_labels?.[locale] ?? line.unit}
								</bdi>
							</p>
							<p>
								{t.unitPrice}:{" "}
								<bdi>
									{line.unit_price} {currency}
								</bdi>
							</p>
							{line.goods_amount && (
								<p>
									{t.total}:{" "}
									<bdi>
										{line.goods_amount} {currency}
									</bdi>
								</p>
							)}
						</>
					)}
				</li>
			))}
		</ul>
	);
}
