"use client";
import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { localTimestamp } from "../../messaging/api";
import { salesAction, salesHref, salesPanel } from "../../sales/components/seller-sales-ui";
import { aftercareCopy, aftercareState } from "../copy";
import { sellerAftercareCopy } from "../seller-copy";
import { availableModes, modeLabel } from "../draft";
import type { Workspace } from "../types";

export function SellerIssueSummary({
	locale,
	data,
	seller,
}: {
	locale: Locale;
	data: Workspace;
	seller: string;
}) {
	const t = aftercareCopy[locale],
		s = sellerAftercareCopy[locale],
		order = data.order,
		modes = availableModes(data),
		issues = [
			...order.cancellations.map((row) => ({
				key: `cancel:${row.id}`,
				type: t.cancellation,
				state: row.state,
				date: row.created_at,
			})),
			...order.amendments.map((row) => ({
				key: `amend:${row.id}`,
				type: t.amendment,
				state: row.state,
				date: row.created_at,
			})),
			...(order.refund_dues ?? []).map((row) => ({
				key: `due:${row.id}`,
				type: t.dues,
				state: row.state,
				date: row.created_at,
			})),
			...(order.disputes ?? []).map((row) => ({
				key: `dispute:${row.id}`,
				type: t.disputes,
				state: row.state,
				date: row.created_at,
			})),
		],
		states = issues.map((row) => row.state),
		awaiting = states.some((state) => state === "pending" || state === "reported"),
		outcome = states.some((state) =>
			[
				"approved",
				"rejected",
				"confirmed",
				"withdrawn",
				"dismissed",
				"resolved_non_monetary",
				"refund_ordered",
			].includes(state),
		),
		stage = awaiting ? 2 : outcome ? 3 : 1,
		phases = [s.phaseRequest, s.phaseReview, s.phaseOutcome];
	return (
		<section className={salesPanel}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<p className="m-0 text-sm text-muted">
						{s.customer}: <span dir="auto">{order.buyer_name}</span>
					</p>
					<p className="m-0 flex flex-wrap items-center gap-2 text-sm">
						{s.nextAction}:{" "}
						<strong className="font-semibold">
							{modes.length ? modeLabel(locale, modes[0]) : t.noActions}
						</strong>
					</p>
				</div>
				<Link className={salesAction} href={salesHref(locale, "orders", seller, order.id)}>
					{s.openOrder}
				</Link>
			</div>
			<ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
				{phases.map((label, i) => {
					const n = i + 1,
						done = n < stage,
						current = n === stage;
					return (
						<li key={label} className="flex items-center gap-2">
							{i > 0 && <span className="text-muted" aria-hidden="true">→</span>}
							<span
								className={cn(
									"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
									done
										? "bg-success-surface text-success"
										: current
											? "bg-info text-action"
											: "bg-page text-muted",
								)}
							>
								{n}. {label}
							</span>
						</li>
					);
				})}
			</ol>
			{issues.length > 0 && (
				<ul className="m-0 list-none space-y-1.5 p-0">
					{issues.map((issue) => (
						<li key={issue.key} className="flex flex-wrap items-center gap-2 text-sm">
							<span className="font-medium">{issue.type}</span>
							<span className="text-muted">
								{aftercareState(locale, issue.state)} ·{" "}
								<bdi>{localTimestamp(issue.date, locale)}</bdi>
							</span>
						</li>
					))}
				</ul>
			)}
			{(order.disputes?.length ?? 0) > 0 && (
				<div className="space-y-2 border-t border-border pt-3">
					<h3 className="m-0 text-sm font-semibold">{t.disputes}</h3>
					{order.disputes!.map((dispute) => (
						<article
							key={dispute.id}
							className="space-y-1 rounded-xl border border-border p-3 text-sm"
						>
							<p className="m-0 flex flex-wrap items-center gap-2 font-medium">
								{aftercareState(locale, dispute.state)} ·{" "}
								<bdi className="text-muted">
									{localTimestamp(dispute.created_at, locale)}
								</bdi>
							</p>
							<p className="m-0 whitespace-pre-wrap break-words" dir="auto">
								{dispute.reason}
							</p>
							{dispute.response && (
								<p className="m-0 whitespace-pre-wrap break-words text-muted" dir="auto">
									{t.disputeResponse}: {dispute.response.text}
								</p>
							)}
							{dispute.decision && (
								<p className="m-0 text-muted">
									{t.disputeAction}:{" "}
									{aftercareState(locale, dispute.decision.action)}
									{dispute.decision.amount
										? ` · ${t.disputeAmount}: ${dispute.decision.amount} ${order.currency}`
										: ""}
									{dispute.decision.reason ? ` · ${dispute.decision.reason}` : ""}
								</p>
							)}
						</article>
					))}
				</div>
			)}
		</section>
	);
}
