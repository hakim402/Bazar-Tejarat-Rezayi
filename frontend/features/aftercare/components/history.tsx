import type { ReactNode } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { localTimestamp } from "../../messaging/api";
import { panel } from "../../orders/components/controls";
import { salesPanel } from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { aftercareCopy, aftercareState } from "../copy";
import type {
	Context,
	DeliveryDetail,
	Detail,
	RefundDetail,
	RequestRow,
} from "../types";
import { AftercareEvidence } from "./evidence";
import { AcceptedLines, MoneySummary } from "./summary";

function HistoryGroup({
	title,
	children,
	seller = false,
}: {
	title: string;
	children: ReactNode;
	seller?: boolean;
}) {
	return (
		<section className={seller ? salesPanel : `${panel} space-y-4`}>
			<h2 className="text-xl font-bold">{title}</h2>
			{children}
		</section>
	);
}
function RequestHistory({
	locale,
	row,
	seller = false,
}: {
	locale: Locale;
	row: RequestRow;
	seller?: boolean;
}) {
	const t = aftercareCopy[locale];
	return (
		<div
			className={
				seller
					? "min-w-0 space-y-3 rounded-xl border border-border p-4"
					: "space-y-2"
			}
		>
			<p>
				{aftercareState(locale, row.state)} ·{" "}
				<bdi>{localTimestamp(row.created_at, locale)}</bdi>
			</p>
			<p className="break-words text-sm text-muted">
				<bdi>{row.id}</bdi> · v{row.version}
			</p>
			<p dir="auto" className="whitespace-pre-wrap break-words">
				{row.reason}
			</p>
			{row.decision && (
				<div className="border-s-2 border-border ps-3">
					<p>
						{t.review}: {aftercareState(locale, row.decision)}
					</p>
					<p dir="auto" className="whitespace-pre-wrap break-words">
						{row.decision_reason}
					</p>
					{row.decided_at && (
						<p>
							<bdi>{localTimestamp(row.decided_at, locale)}</bdi>
						</p>
					)}
				</div>
			)}
		</div>
	);
}
export function OrderHistory({
	locale,
	row,
	seller = false,
}: {
	locale: Locale;
	row: Detail;
	seller?: boolean;
}) {
	const t = aftercareCopy[locale];
	return (
		<div
			className={
				seller
					? "min-w-0 space-y-5 [&_summary]:min-h-11 [&_summary]:font-semibold [&_summary]:text-action [&_summary]:focus-visible:outline-2 [&_summary]:focus-visible:outline-offset-2 [&_summary]:focus-visible:outline-action"
					: "space-y-5"
			}
		>
			{seller && (
				<h2 className="text-xl font-bold">{sellerSalesCopy[locale].history}</h2>
			)}
			<p className="text-sm text-muted">{t.recentHistory}</p>
			<HistoryGroup title={t.cancellations} seller={seller}>
				{row.cancellations.length ? (
					row.cancellations.map((item) => (
						<RequestHistory key={item.id} {...{ locale, row: item, seller }} />
					))
				) : (
					<p>{t.empty}</p>
				)}
			</HistoryGroup>
			<HistoryGroup title={t.amendments} seller={seller}>
				{row.amendments.length ? (
					row.amendments.map((item) => (
						<div key={item.id} className="space-y-3">
							<RequestHistory {...{ locale, row: item, seller }} />
							<p>
								{t.after}:{" "}
								<bdi>
									{item.after_total} {row.currency}
								</bdi>
							</p>
							<details>
								<summary className="cursor-pointer py-2">
									{t.effectiveLines}
								</summary>
								<AcceptedLines
									{...{
										locale,
										lines: item.lines,
										currency: row.currency,
										seller,
									}}
								/>
							</details>
						</div>
					))
				) : (
					<p>{t.empty}</p>
				)}
			</HistoryGroup>
			<HistoryGroup title={t.adjustments} seller={seller}>
				<p>{t.immutable}</p>
				{row.adjustments.length ? (
					row.adjustments.map((item) => (
						<article
							key={item.id}
							className={
								seller
									? "min-w-0 space-y-3 rounded-xl border border-border p-4"
									: "space-y-3 border-t border-border pt-3"
							}
						>
							<p>
								{aftercareState(locale, item.cause)} ·{" "}
								<bdi>{localTimestamp(item.created_at, locale)}</bdi>
							</p>
							<p className="break-words text-sm text-muted">
								<bdi>{item.id}</bdi>
							</p>
							{(item.cancellation || item.amendment) && (
								<p className="break-words">
									{t.target}: <bdi>{item.cancellation ?? item.amendment}</bdi>
								</p>
							)}
							<p dir="auto" className="whitespace-pre-wrap break-words">
								{item.reason}
							</p>
							<details>
								<summary className="cursor-pointer py-2">
									{t.before}:{" "}
									<bdi>
										{item.before_total} {row.currency}
									</bdi>
								</summary>
								<AcceptedLines
									{...{
										locale,
										lines: item.before_lines,
										currency: row.currency,
										seller,
									}}
								/>
							</details>
							<details>
								<summary className="cursor-pointer py-2">
									{t.after}:{" "}
									<bdi>
										{item.after_total} {row.currency}
									</bdi>
								</summary>
								<AcceptedLines
									{...{
										locale,
										lines: item.after_lines,
										currency: row.currency,
										seller,
									}}
								/>
							</details>
						</article>
					))
				) : (
					<p>{t.empty}</p>
				)}
			</HistoryGroup>
		</div>
	);
}
export function GoodsRefundHistory({
	locale,
	context,
	row,
}: {
	locale: Locale;
	context: Context;
	row: RefundDetail;
}) {
	const t = aftercareCopy[locale],
		seller = context === "seller";
	return (
		<HistoryGroup title={t.dues} seller={seller}>
			<MoneySummary
				{...{ locale, money: row, currency: row.currency, seller }}
			/>
			<p>
				{t.limit}:{" "}
				<bdi>
					{row.refundable_excess} {row.currency}
				</bdi>
			</p>
			<p>{t.refundNote}</p>
			{row.refund_dues.length ? (
				row.refund_dues.map((due) => (
					<article
						key={due.id}
						className={
							seller
								? "min-w-0 space-y-3 rounded-xl border border-border p-4"
								: "space-y-2 border-t border-border pt-3"
						}
					>
						<p>
							{aftercareState(locale, due.cause)} ·{" "}
							{aftercareState(locale, due.state)}
						</p>
						<p>
							<bdi>
								{due.amount} {due.currency} ·{" "}
								{localTimestamp(due.created_at, locale)}
							</bdi>
						</p>
						<p className="break-words text-sm text-muted">
							<bdi>{due.id}</bdi> · v{due.version}
						</p>
						{due.previous && (
							<p className="break-words">
								{t.before}: <bdi>{due.previous}</bdi>
							</p>
						)}
					</article>
				))
			) : (
				<p>{t.empty}</p>
			)}
			<h3 className="text-lg font-bold">{t.reports}</h3>
			{row.refund_reports.length ? (
				row.refund_reports.map((report) => (
					<article
						key={report.id}
						className={
							seller
								? "min-w-0 space-y-3 rounded-xl border border-border p-4"
								: "space-y-2 border-t border-border pt-3"
						}
					>
						<p>
							{aftercareState(locale, report.state)} ·{" "}
							<bdi>
								{report.amount} {row.currency}
							</bdi>
						</p>
						<p>
							{t.sentAt}: <bdi>{localTimestamp(report.sent_at, locale)}</bdi>
						</p>
						<p className="break-words text-sm text-muted">
							<bdi>{report.id}</bdi>
						</p>
						<p className="break-words">
							{t.target}: <bdi>{report.due}</bdi>
						</p>
						{report.previous && (
							<p className="break-words">
								{t.before}: <bdi>{report.previous}</bdi>
							</p>
						)}
						<p>
							{t.reference}: <bdi>{report.reference}</bdi>
						</p>
						<p dir="auto" className="whitespace-pre-wrap break-words">
							{report.description}
						</p>
						{report.reason && (
							<p dir="auto" className="whitespace-pre-wrap break-words">
								{t.reason}: {report.reason}
							</p>
						)}
						<div className="flex flex-wrap gap-3">
							{row.capabilities.evidence &&
								report.evidence.map((id) => (
									<AftercareEvidence
										key={id}
										{...{ id, locale, context, domain: "payments" }}
									/>
								))}
						</div>
					</article>
				))
			) : (
				<p>{t.empty}</p>
			)}
		</HistoryGroup>
	);
}
export function DeliveryRefundHistory({
	locale,
	context,
	row,
	currency,
}: {
	locale: Locale;
	context: Context;
	row: DeliveryDetail;
	currency: string;
}) {
	const t = aftercareCopy[locale],
		seller = context === "seller";
	return (
		<HistoryGroup title={t.deliveryRefunds} seller={seller}>
			<p>{t.deliveryNote}</p>
			<dl
				className={
					seller
						? "grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"
						: "space-y-2"
				}
			>
				{[
					[t.provider, row.provider],
					[t.chargePayee, row.charge_provider],
					[t.deliveryConfirmed, `${row.delivery_confirmed} ${currency}`],
					[t.providerRefunded, `${row.delivery_refunded} ${currency}`],
					[
						t.deliveryRemaining,
						row.delivery_remaining === null
							? "—"
							: `${row.delivery_remaining} ${currency}`,
					],
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
							<bdi>{value}</bdi>
						</dd>
					</div>
				))}
			</dl>
			{row.refund_providers.map((provider) => (
				<p key={provider.id}>
					{t.provider}: <bdi>{provider.name}</bdi> · {t.limit}:{" "}
					<bdi>
						{provider.refundable} {currency}
					</bdi>
				</p>
			))}
			{row.delivery_refunds.length ? (
				row.delivery_refunds.map((refund) => (
					<article
						key={refund.id}
						className={
							seller
								? "min-w-0 space-y-3 rounded-xl border border-border p-4"
								: "space-y-2 border-t border-border pt-3"
						}
					>
						<p>
							{aftercareState(locale, refund.state)} ·{" "}
							<bdi>
								{refund.amount} {refund.currency}
							</bdi>
						</p>
						<p>
							{t.provider}: <bdi>{refund.provider_name}</bdi>
						</p>
						<p>
							{t.sentAt}: <bdi>{localTimestamp(refund.sent_at, locale)}</bdi>
						</p>
						<p>
							{t.reference}: <bdi>{refund.reference}</bdi>
						</p>
						<p className="break-words text-sm text-muted">
							<bdi>{refund.id}</bdi>
						</p>
						<p dir="auto" className="whitespace-pre-wrap break-words">
							{refund.description}
						</p>
						<div className="flex flex-wrap gap-3">
							{refund.evidence.map((id) => (
								<AftercareEvidence
									key={id}
									{...{ id, locale, context, domain: "fulfilment" }}
								/>
							))}
						</div>
					</article>
				))
			) : (
				<p>{t.empty}</p>
			)}
		</HistoryGroup>
	);
}
