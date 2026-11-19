import Link from "next/link";
import { Clock3 } from "lucide-react";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context, Detail } from "../types";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import { aftercareCopy, aftercareState } from "../../aftercare/copy";
import { fulfilmentHref } from "../api";
import { localTimestamp } from "../../messaging/api";
import { StatusBadge } from "../../../components/ui/status-badge";
import { buttonVariants } from "../../../components/shadcn/button";
import { cn } from "../../../lib/shadcn-utils";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import type { QueryReader } from "../../../lib/routes/account-routes";
import {
	salesAction,
	salesHistoryHref,
} from "../../sales/components/seller-sales-ui";
import { DeliveryEvidence } from "./evidence";

const recordPanel =
	"flex min-w-0 flex-col gap-3 rounded-xl border border-solid border-border p-4 shadow-none [&_h2]:m-0 [&_h2]:text-sm [&_h2]:font-semibold [&_p]:m-0 [&_p]:text-sm [&_article]:text-sm [&_article]:leading-relaxed";
const recordCard =
	"flex flex-col gap-2 rounded-lg border border-solid border-border bg-surface p-3";
const pagerButton = buttonVariants({ variant: "outline", size: "sm" });

function recordVariant(
	state: string,
): "success" | "warning" | "danger" | "neutral" {
	if (state === "confirmed" || state === "accepted" || state === "applied")
		return "success";
	if (state === "pending") return "warning";
	if (state === "rejected") return "danger";
	return "neutral";
}

export function DeliveryHistory({
	locale,
	context,
	row,
	seller,
	page,
	returnParams,
	embedded = false,
	onPage,
}: {
	locale: Locale;
	context: Context;
	row: Detail;
	seller: string;
	page: number;
	returnParams?: QueryReader;
	embedded?: boolean;
	onPage?: (page: number) => void;
}) {
	const t = fulfilmentCopy[locale],
		r = aftercareCopy[locale],
		s = sellerSalesCopy[locale],
		isSeller = context === "seller",
		action = isSeller ? salesAction : pagerButton,
		panel = isSeller
			? cn(recordPanel, "bg-surface")
			: cn(recordPanel, "bg-page p-3 sm:p-4");
	const historyHref = (next: number) => {
		const href = fulfilmentHref(locale, context, row.id, seller, next);
		return isSeller && returnParams
			? salesHistoryHref(href, returnParams)
			: href;
	};
	const events: Record<string, string> = {
		recipient_revised: t.recipient,
		arrangement_proposed: t.arrangement,
		prepared: t.preparation,
		partial_authorized: t.partial,
		charge_proposed: t.proposeCharge,
		delivery_claimed: t.claimDelivery,
		claim_withdrawn: t.withdrawClaim,
		correction_proposed: t.correctionDelivery,
		delivery_refund_reported: r.deliveryRefund,
		operational_hold: t.blockers,
		dispatched: t.dispatch,
		dispatch_blocked: t.notReady,
		tracking_recorded: t.recordTracking,
		delivered: t.deliver,
		completed: t.completed,
	};
	const timeline = (
		<section className={isSeller && embedded ? "space-y-3" : panel}>
			{(!isSeller || !embedded) && <h2>{t.history}</h2>}
			{isSeller && (
				<p className="m-0 text-xs text-muted">
					{s.results}:{" "}
					<bdi>{new Intl.NumberFormat(locale).format(row.history_count)}</bdi>{" "}
					· {s.page} <bdi>{new Intl.NumberFormat(locale).format(page)}</bdi>
				</p>
			)}
			{row.history.length ? (
				<ol className="m-0 list-none p-0">
					{row.history.map((event, index) => (
						<li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
							{index < row.history.length - 1 && (
								<span
									aria-hidden="true"
									className="absolute start-3.5 top-7 bottom-0 w-px bg-border"
								/>
							)}
							<span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-info text-action">
								<Clock3 className="size-3.5" aria-hidden="true" />
							</span>
							<div className="min-w-0 flex-1 space-y-1 pt-0.5">
								<p className="font-medium text-foreground">
									{events[event.action] ?? t.review}
								</p>
								<div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
									{!isSeller && (
										<>
											<span>
												<bdi>v{event.version}</bdi>
											</span>
											<span aria-hidden="true">·</span>
										</>
									)}
									<time dateTime={event.created_at}>
										<bdi>{localTimestamp(event.created_at, locale)}</bdi>
									</time>
									<span aria-hidden="true">·</span>
									<span>{fulfilmentState(locale, event.context)}</span>
								</div>
							</div>
						</li>
					))}
				</ol>
			) : (
				<p className="text-muted">{s.empty}</p>
			)}
			<div className="flex flex-wrap gap-3">
				{page > 1 &&
					(onPage ? (
						<button
							type="button"
							className={action}
							onClick={() => onPage(page - 1)}
						>
							{t.previous}
						</button>
					) : (
						<Link className={action} href={historyHref(page - 1)}>
							{t.previous}
						</Link>
					))}
				{page * 50 < row.history_count &&
					(onPage ? (
						<button
							type="button"
							className={action}
							onClick={() => onPage(page + 1)}
						>
							{t.next}
						</button>
					) : (
						<Link className={action} href={historyHref(page + 1)}>
							{t.next}
						</Link>
					))}
			</div>
		</section>
	);
	return (
		<div className="space-y-4">
			{isSeller && !embedded && (
				<h2 className="text-lg font-semibold">{s.history}</h2>
			)}
			{embedded && timeline}
			{row.proposals.length > 0 && (
				<section className={panel}>
					<h2>{t.proposeCharge}</h2>
					{row.proposals.map((proposal) => (
						<article key={proposal.id} className={recordCard}>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="font-semibold tabular-nums">
									<bdi>
										{proposal.provider} · {proposal.amount} {proposal.currency}
									</bdi>
								</p>
								<StatusBadge variant={recordVariant(proposal.state)}>
									{fulfilmentState(locale, proposal.state)}
								</StatusBadge>
							</div>
							<p className="text-muted">{proposal.reason}</p>
						</article>
					))}
				</section>
			)}
			{(row.capabilities.financial_details ||
				(context === "seller" && row.capabilities.refund)) &&
				row.delivery_refunds.length > 0 && (
					<section className={panel}>
						<h2>{r.deliveryRefunds}</h2>
						<p className="text-muted">{r.deliveryNote}</p>
						{row.delivery_refunds.map((refund) => (
							<article key={refund.id} className={recordCard}>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="font-semibold tabular-nums">
										<bdi>
											{refund.amount} {refund.currency}
										</bdi>
									</p>
									<StatusBadge variant={recordVariant(refund.state)}>
										{aftercareState(locale, refund.state)}
									</StatusBadge>
								</div>
								<p className="text-muted">
									{t.provider}: <bdi>{refund.provider_name}</bdi> ·{" "}
									<bdi>{refund.provider}</bdi>
								</p>
								<p className="text-muted">
									{r.target}: <bdi>{refund.id}</bdi>
								</p>
								<p className="text-muted">
									{r.sentAt}:{" "}
									<bdi>{localTimestamp(refund.sent_at, locale)}</bdi>
								</p>
								<p className="break-words text-muted">
									{r.reference}: <bdi>{refund.reference}</bdi>
								</p>
								<p className="break-words whitespace-pre-wrap">
									{refund.description}
								</p>
								<div className="flex flex-wrap gap-3">
									{/* Returned refund IDs include own logistics proof without general evidence access. */}
									{refund.evidence.map((id) => (
										<DeliveryEvidence key={id} {...{ id, context, locale }} />
									))}
								</div>
							</article>
						))}
					</section>
				)}
			{row.capabilities.financial_details && (
				<>
					{(!isSeller || row.claims.length > 0) && (
						<section className={panel}>
							<h2>{t.claims}</h2>
							<p className="text-muted">{t.claimNote}</p>
							{row.claims.map((claim) => (
								<article key={claim.id} className={recordCard}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-semibold tabular-nums">
											<bdi>
												{claim.amount} {claim.currency}
											</bdi>
										</p>
										<StatusBadge variant={recordVariant(claim.state)}>
											{fulfilmentState(locale, claim.state)}
										</StatusBadge>
									</div>
									<p className="text-muted">
										<bdi>{localTimestamp(claim.paid_at, locale)}</bdi>
									</p>
									<p className="break-words whitespace-pre-wrap">
										{claim.description}
									</p>
									{row.capabilities.evidence && (
										<div className="flex flex-wrap gap-3">
											{claim.evidence.map((id) => (
												<DeliveryEvidence
													key={id}
													{...{ id, context, locale }}
												/>
											))}
										</div>
									)}
								</article>
							))}
						</section>
					)}
					{(!isSeller || row.receipts.length > 0) && (
						<section className={panel}>
							<h2>{t.receipts}</h2>
							{row.receipts.map((receipt) => (
								<article key={receipt.id} className={recordCard}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-semibold tabular-nums">
											<bdi>
												{receipt.amount} {row.currency}
											</bdi>
										</p>
										<span className="rounded-control bg-page px-2 py-0.5 text-xs text-muted">
											v{receipt.version}
										</span>
									</div>
									<p className="text-muted">
										{t.originalAmount}:{" "}
										<bdi>
											{receipt.original_amount} {row.currency}
										</bdi>
									</p>
									<p className="text-muted">
										<bdi>{localTimestamp(receipt.paid_at, locale)}</bdi>
									</p>
									<p className="break-words whitespace-pre-wrap">
										{receipt.description}
									</p>
								</article>
							))}
						</section>
					)}
					{(!isSeller || row.corrections.length > 0) && (
						<section className={panel}>
							<h2>{t.corrections}</h2>
							{row.corrections.map((correction) => (
								<article key={correction.id} className={recordCard}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-semibold tabular-nums">
											<bdi>
												{correction.amount} {row.currency}
											</bdi>
										</p>
										<StatusBadge variant={recordVariant(correction.state)}>
											{fulfilmentState(locale, correction.state)}
										</StatusBadge>
									</div>
									<p className="text-muted">{correction.reason}</p>
									{row.capabilities.evidence && (
										<div className="flex flex-wrap gap-3">
											{correction.evidence.map((id) => (
												<DeliveryEvidence
													key={id}
													{...{ id, context, locale }}
												/>
											))}
										</div>
									)}
								</article>
							))}
						</section>
					)}
				</>
			)}
			{(!isSeller || row.tracking.length > 0 || row.delivery) && (
				<section className={panel}>
					<h2>{t.tracking}</h2>
					{row.tracking.map((tracking) => (
						<article key={tracking.id} className={recordCard}>
							<p className="font-medium">
								<bdi>{tracking.reference}</bdi>
							</p>
							<p className="text-muted">
								<bdi>{localTimestamp(tracking.occurred_at, locale)}</bdi> ·{" "}
								{fulfilmentState(locale, tracking.source)}
							</p>
							<p className="text-muted">{tracking.reason}</p>
						</article>
					))}
					{row.delivery && (
						<article className={recordCard}>
							<p className="font-medium">{t.actualDelivery}</p>
							<p className="text-muted">
								{fulfilmentState(locale, row.delivery.source)} ·{" "}
								<bdi>{localTimestamp(row.delivery.occurred_at, locale)}</bdi>
							</p>
							<p className="text-muted">{row.delivery.reason}</p>
						</article>
					)}
				</section>
			)}
			{!embedded && timeline}
		</div>
	);
}
