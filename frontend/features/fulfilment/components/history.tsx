import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context, Detail } from "../types";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import { aftercareCopy, aftercareState } from "../../aftercare/copy";
import { fulfilmentHref } from "../api";
import { localTimestamp } from "../../messaging/api";
import {
	action as buyerAction,
	panel as buyerPanel,
} from "../../orders/components/controls";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import type { QueryReader } from "../../../lib/routes/account-routes";
import {
	salesAction,
	salesPanel,
	salesHistoryHref,
} from "../../sales/components/seller-sales-ui";
import { DeliveryEvidence } from "./evidence";
export function DeliveryHistory({
	locale,
	context,
	row,
	seller,
	page,
	returnParams,
	embedded = false,
}: {
	locale: Locale;
	context: Context;
	row: Detail;
	seller: string;
	page: number;
	returnParams?: QueryReader;
	embedded?: boolean;
}) {
	const t = fulfilmentCopy[locale],
		r = aftercareCopy[locale],
		s = sellerSalesCopy[locale],
		isSeller = context === "seller",
		action = isSeller ? salesAction : buyerAction,
		panel = isSeller ? salesPanel : buyerPanel;
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
	return (
		<>
			{isSeller && !embedded && <h2 className="text-lg font-semibold">{s.history}</h2>}
			{row.proposals.length > 0 && (
				<section className={panel}>
					<h2 className="text-xl font-bold">{t.proposeCharge}</h2>
					{row.proposals.map((proposal) => (
						<article key={proposal.id} className="space-y-2">
							<p>
								<bdi>
									{proposal.provider} · {proposal.amount} {proposal.currency}
								</bdi>{" "}
								· {fulfilmentState(locale, proposal.state)}
							</p>
							<p>{proposal.reason}</p>
						</article>
					))}
				</section>
			)}
			{(row.capabilities.financial_details ||
				(context === "seller" && row.capabilities.refund)) &&
				row.delivery_refunds.length > 0 && (
					<section className={panel}>
						<h2 className="text-xl font-bold">{r.deliveryRefunds}</h2>
						<p>{r.deliveryNote}</p>
						{row.delivery_refunds.map((refund) => (
							<article
								key={refund.id}
								className="space-y-2 rounded-control border border-border p-3"
							>
								<p>
									{t.provider}: <bdi>{refund.provider_name}</bdi> ·{" "}
									<bdi>{refund.provider}</bdi>
								</p>
								<p>
									<bdi>
										{refund.amount} {refund.currency}
									</bdi>{" "}
									· {aftercareState(locale, refund.state)}
								</p>
								<p>
									{r.target}: <bdi>{refund.id}</bdi>
								</p>
								<p>
									{r.sentAt}:{" "}
									<bdi>{localTimestamp(refund.sent_at, locale)}</bdi>
								</p>
								<p className="break-words">
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
					<section className={panel}>
						<h2 className="text-xl font-bold">{t.claims}</h2>
						<p>{t.claimNote}</p>
						{row.claims.map((claim) => (
							<article
								key={claim.id}
								className="space-y-2 rounded-control border border-border p-3"
							>
								<p>
									<bdi>
										{claim.amount} {claim.currency}
									</bdi>{" "}
									· {fulfilmentState(locale, claim.state)}
								</p>
								<p>
									<bdi>{localTimestamp(claim.paid_at, locale)}</bdi>
								</p>
								<p className="break-words whitespace-pre-wrap">
									{claim.description}
								</p>
								{row.capabilities.evidence && (
									<div className="flex flex-wrap gap-3">
										{claim.evidence.map((id) => (
											<DeliveryEvidence key={id} {...{ id, context, locale }} />
										))}
									</div>
								)}
							</article>
						))}
					</section>
					<section className={panel}>
						<h2 className="text-xl font-bold">{t.receipts}</h2>
						{row.receipts.map((receipt) => (
							<article
								key={receipt.id}
								className="space-y-2 rounded-control border border-border p-3"
							>
								<p>
									{t.effectiveAmount}:{" "}
									<bdi>
										{receipt.amount} {row.currency}
									</bdi>{" "}
									· v{receipt.version}
								</p>
								<p>
									{t.originalAmount}:{" "}
									<bdi>
										{receipt.original_amount} {row.currency}
									</bdi>
								</p>
								<p>
									<bdi>{localTimestamp(receipt.paid_at, locale)}</bdi>
								</p>
								<p className="break-words whitespace-pre-wrap">
									{receipt.description}
								</p>
							</article>
						))}
					</section>
					<section className={panel}>
						<h2 className="text-xl font-bold">{t.corrections}</h2>
						{row.corrections.map((correction) => (
							<article key={correction.id} className="space-y-2">
								<p>
									<bdi>
										{correction.amount} {row.currency}
									</bdi>{" "}
									· {fulfilmentState(locale, correction.state)} ·{" "}
									{correction.reason}
								</p>
								{row.capabilities.evidence && (
									<div className="flex flex-wrap gap-3">
										{correction.evidence.map((id) => (
											<DeliveryEvidence key={id} {...{ id, context, locale }} />
										))}
									</div>
								)}
							</article>
						))}
					</section>
				</>
			)}
			<section className={panel}>
				<h2 className="text-xl font-bold">{t.tracking}</h2>
				{row.tracking.map((tracking) => (
					<article key={tracking.id}>
						<p>
							<bdi>{tracking.reference}</bdi> ·{" "}
							<bdi>{localTimestamp(tracking.occurred_at, locale)}</bdi> ·{" "}
							{fulfilmentState(locale, tracking.source)}
						</p>
						<p>{tracking.reason}</p>
					</article>
				))}
				{row.delivery && (
					<p>
						{t.actualDelivery}: {fulfilmentState(locale, row.delivery.source)} ·{" "}
						<bdi>{localTimestamp(row.delivery.occurred_at, locale)}</bdi> ·{" "}
						{row.delivery.reason}
					</p>
				)}
			</section>
			<section className={panel}>
				<h2 className="text-xl font-bold">{t.history}</h2>
				{isSeller && (
					<p className="text-sm text-muted">
						{s.results}:{" "}
						<bdi>{new Intl.NumberFormat(locale).format(row.history_count)}</bdi>{" "}
						· {s.page} <bdi>{new Intl.NumberFormat(locale).format(page)}</bdi>
					</p>
				)}
				{row.history.map((event) => (
					<p key={event.id}>
						<bdi>v{event.version}</bdi> · {events[event.action] ?? t.review} ·{" "}
						{fulfilmentState(locale, event.context)} ·{" "}
						<bdi>{localTimestamp(event.created_at, locale)}</bdi>
					</p>
				))}
				<div className="flex flex-wrap gap-3">
					{page > 1 && (
						<Link className={action} href={historyHref(page - 1)}>
							{t.previous}
						</Link>
					)}
					{page * 50 < row.history_count && (
						<Link className={action} href={historyHref(page + 1)}>
							{t.next}
						</Link>
					)}
				</div>
			</section>
		</>
	);
}
