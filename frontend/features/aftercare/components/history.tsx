import Link from "next/link";
import { disputeHref } from "../api";
import type { ReactNode } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { localTimestamp } from "../../messaging/api";
import { salesPanel } from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { aftercareCopy, aftercareState } from "../copy";
import { StatusBadge } from "../../../components/ui/status-badge";
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
		<section
			className={
				seller
					? salesPanel
					: "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4"
			}
		>
			<h2
				className={seller ? "text-xl font-bold" : "m-0 text-sm font-semibold"}
			>
				{title}
			</h2>
			{children}
		</section>
	);
}
function HistoryState({
	locale,
	state,
	time,
	seller,
}: {
	locale: Locale;
	state: string;
	time?: string;
	seller: boolean;
}) {
	const label = aftercareState(locale, state);
	if (seller)
		return (
			<p className="m-0">
				{label}
				{time ? (
					<>
						{" · "}
						<bdi>{time}</bdi>
					</>
				) : null}
			</p>
		);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<StatusBadge size="sm" variant="neutral">
				{label}
			</StatusBadge>
			{time && (
				<time className="text-xs text-muted">
					<bdi>{time}</bdi>
				</time>
			)}
		</div>
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
					: "flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-page p-3"
			}
		>
			<HistoryState
				locale={locale}
				state={row.state}
				time={localTimestamp(row.created_at, locale)}
				seller={seller}
			/>
			{seller && (
				<p className="break-words text-sm text-muted">
					<bdi>{row.id}</bdi> · v{row.version}
				</p>
			)}
			<p
				dir="auto"
				className="m-0 whitespace-pre-wrap break-words text-sm text-muted"
			>
				{row.reason}
			</p>
			{row.decision && (
				<div className="border-s-2 border-border ps-3">
					<p className="m-0 text-sm">
						{t.review}: {aftercareState(locale, row.decision)}
					</p>
					<p
						dir="auto"
						className="m-0 whitespace-pre-wrap break-words text-sm text-muted"
					>
						{row.decision_reason}
					</p>
					{row.decided_at && (
						<p className="m-0 text-xs text-muted">
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
			<HistoryGroup title={t.disputes} seller={seller}>
				<p>{t.disputeNote}</p>
				{row.disputes?.length ? (
					row.disputes.map((item) => (
						<article
							key={item.id}
							className="min-w-0 space-y-3 border-t border-border pt-3"
						>
							<Link
								prefetch={false}
								className="inline-flex min-h-11 items-center font-semibold text-action"
								href={disputeHref(
									locale,
									seller ? "seller" : "buyer",
									item.id,
									row.seller,
								)}
							>
								<bdi>{seller ? item.id : item.number}</bdi>
							</Link>
							<HistoryState
								locale={locale}
								state={item.state}
								time={localTimestamp(item.created_at, locale)}
								seller={seller}
							/>
							<p className="m-0 text-sm text-muted">
								{item.assigned ? t.assigned : t.unassigned}
							</p>
							<p dir="auto" className="whitespace-pre-wrap break-words">
								{item.reason}
							</p>
							<div className="flex flex-wrap gap-3">
								{item.evidence?.map((id) => (
									<AftercareEvidence
										key={id}
										locale={locale}
										context={seller ? "seller" : "buyer"}
										domain="orders"
										id={id}
									/>
								))}
							</div>
							{item.response && (
								<div className="space-y-2 border-s-2 border-border ps-3">
									<h3 className="font-semibold">{t.disputeResponse}</h3>
									<p dir="auto" className="whitespace-pre-wrap break-words">
										{item.response.text}
									</p>
									<bdi>{localTimestamp(item.response.created_at, locale)}</bdi>
								</div>
							)}
							{item.decision && (
								<div className="space-y-2 border-s-2 border-border ps-3">
									<h3 className="font-semibold">
										{t.disputeAction}:{" "}
										{aftercareState(locale, item.decision.action)}
									</h3>
									<p dir="auto" className="whitespace-pre-wrap break-words">
										{item.decision.reason}
									</p>
									{item.decision.amount && (
										<p>
											<bdi>
												{item.decision.amount} {row.currency}
											</bdi>
										</p>
									)}
									{item.decision.refund_due && (
										<p>
											{t.refundDue}: <bdi>{item.decision.refund_due}</bdi>
										</p>
									)}
									<bdi>{localTimestamp(item.decision.created_at, locale)}</bdi>
								</div>
							)}
						</article>
					))
				) : (
					<p>{t.disputeEmpty}</p>
				)}
			</HistoryGroup>
			<HistoryGroup title={t.reviews} seller={seller}>
				<p>{t.reviewNote}</p>
				{row.review ? (
					<article className="min-w-0 space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<HistoryState
								locale={locale}
								state={`review_${row.review.state}`}
								seller={seller}
							/>
							<bdi className="text-xs text-muted">{row.review.rating}/5</bdi>
						</div>
						<p
							lang={row.review.language}
							dir="auto"
							className="whitespace-pre-wrap break-words"
						>
							{row.review.text}
						</p>
						<p>
							<bdi>{row.review.language}</bdi> ·{" "}
							<bdi>{localTimestamp(row.review.created_at, locale)}</bdi>
						</p>
						{row.review.decisions.map((decision) => (
							<div
								key={`${decision.created_at}:${decision.action}`}
								className="space-y-2 border-s-2 border-border ps-3"
							>
								<p>{aftercareState(locale, decision.action)}</p>
								<p dir="auto" className="whitespace-pre-wrap break-words">
									{decision.reason}
								</p>
								<bdi>{localTimestamp(decision.created_at, locale)}</bdi>
							</div>
						))}
					</article>
				) : (
					<p>{t.reviewEmpty}</p>
				)}
			</HistoryGroup>
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
							<HistoryState
								locale={locale}
								state={item.cause}
								time={localTimestamp(item.created_at, locale)}
								seller={seller}
							/>
							{seller && (
								<p className="break-words text-sm text-muted">
									<bdi>{item.id}</bdi>
								</p>
							)}
							{seller && (item.cancellation || item.amendment) && (
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
						{seller ? (
							<p className="m-0">
								{aftercareState(locale, due.cause)} ·{" "}
								{aftercareState(locale, due.state)}
							</p>
						) : (
							<div className="flex flex-wrap items-center gap-2">
								<StatusBadge size="sm" variant="neutral">
									{aftercareState(locale, due.cause)}
								</StatusBadge>
								<StatusBadge size="sm" variant="neutral">
									{aftercareState(locale, due.state)}
								</StatusBadge>
							</div>
						)}
						<p>
							<bdi>
								{due.amount} {due.currency} ·{" "}
								{localTimestamp(due.created_at, locale)}
							</bdi>
						</p>
						{seller && (
							<p className="break-words text-sm text-muted">
								<bdi>{due.id}</bdi> · v{due.version}
							</p>
						)}
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
						<div className="flex flex-wrap items-center gap-2">
							<HistoryState
								locale={locale}
								state={report.state}
								seller={seller}
							/>
							<bdi className="text-sm font-medium">
								{report.amount} {row.currency}
							</bdi>
						</div>
						<p>
							{t.sentAt}: <bdi>{localTimestamp(report.sent_at, locale)}</bdi>
						</p>
						{seller && (
							<p className="break-words text-sm text-muted">
								<bdi>{report.id}</bdi>
							</p>
						)}
						{seller && (
							<p className="break-words">
								{t.target}: <bdi>{report.due}</bdi>
							</p>
						)}
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
						? "m-0 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"
						: "m-0 space-y-2"
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
								seller ? "m-0 font-semibold tabular-nums wrap-anywhere" : "m-0"
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
						<div className="flex flex-wrap items-center gap-2">
							<HistoryState
								locale={locale}
								state={refund.state}
								seller={seller}
							/>
							<bdi className="text-sm font-medium">
								{refund.amount} {refund.currency}
							</bdi>
						</div>
						<p>
							{t.provider}: <bdi>{refund.provider_name}</bdi>
						</p>
						<p>
							{t.sentAt}: <bdi>{localTimestamp(refund.sent_at, locale)}</bdi>
						</p>
						<p>
							{t.reference}: <bdi>{refund.reference}</bdi>
						</p>
						{seller && (
							<p className="break-words text-sm text-muted">
								<bdi>{refund.id}</bdi>
							</p>
						)}
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
