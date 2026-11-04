"use client";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context } from "../../messaging/api";
import { localTimestamp } from "../../messaging/api";
import { Confirmation } from "../../negotiations/components/confirmation";
import { action } from "../../orders/components/controls";
import { paymentCopy } from "../copy";
import type { Detail, Intent, Selection, SelectionPreview } from "../api";
import { PaymentEvidence } from "./evidence";
export type ReviewedAction = {
	packet: Intent;
	label: string;
	row: Detail;
	preview?: SelectionPreview[];
};
export function ActionReview({
	locale,
	context,
	review,
	selection,
	busy,
	opener,
	cancel,
	confirm,
}: {
	locale: Locale;
	context: Context;
	review: ReviewedAction;
	selection: Selection | null;
	busy: boolean;
	opener: HTMLElement | null;
	cancel: () => void;
	confirm: () => void;
}) {
	const t = paymentCopy[locale],
		body = review.packet.body as Record<string, unknown>,
		row = review.row,
		claim = row.claims.find((c) =>
			review.packet.path.startsWith(`claims/${c.id}/`),
		);
	const facts = claim
		? {
				...body,
				amount: claim.amount,
				currency: claim.currency,
				paid_at: claim.paid_at,
				description: claim.description,
				evidence: claim.evidence,
			}
		: body;
	const receipt = row.receipts.find((r) =>
		review.packet.path.startsWith(`receipts/${r.id}/corrections/`),
	);
	const staleReceipt = !!receipt && receipt.version !== body.receipt_version;
	const lines = body.lines as
		| { variant: string; batch: string | null; quantity: string }[]
		| undefined;
	const images = Array.isArray(facts.evidence)
		? facts.evidence.filter((x): x is string => typeof x === "string")
		: [];
	return (
		<Confirmation label={t.exact} close={cancel} returnFocus={opener}>
			<h2 className="text-xl font-bold">{review.label}</h2>
			<p>
				<bdi>
					{row.number} · {row.currency}
				</bdi>{" "}
				· v{row.version}
			</p>
			<p>
				{t.confirmed}:{" "}
				<bdi>
					{row.confirmed_total} {row.currency}
				</bdi>{" "}
				· {t.remaining}:{" "}
				<bdi>
					{row.remaining} {row.currency}
				</bdi>
			</p>
			{receipt && (
				<section
					className="space-y-2 rounded-control border border-border p-3"
					aria-label={t.originalAmount}
				>
					<p>
						{t.effectiveAmount}:{" "}
						<bdi>
							{receipt.amount} {row.currency}
						</bdi>{" "}
						· v{receipt.version}
					</p>
					<p>
						<bdi>{localTimestamp(receipt.paid_at, locale)}</bdi>
					</p>
					<p className="break-words whitespace-pre-wrap">
						{receipt.description}
					</p>
					{staleReceipt && <p role="alert">{t.error}</p>}
				</section>
			)}
			<dl className="space-y-3">
				{(
					[
						["amount", t.amount],
						["description", t.description],
						["reason", t.reason],
					] as const
				).map(
					([key, label]) =>
						facts[key] !== undefined && (
							<div key={key}>
								<dt className="text-sm text-muted">{label}</dt>
								<dd className="break-words whitespace-pre-wrap">
									<bdi>
										{String(facts[key])}
										{key === "amount" ? ` ${row.currency}` : ""}
									</bdi>
								</dd>
							</div>
						),
				)}
				{(["paid_at", "due_at"] as const).map(
					(key) =>
						typeof facts[key] === "string" && (
							<div key={key}>
								<dt>{key === "paid_at" ? t.paidAt : t.laterDue}</dt>
								<dd>
									<bdi>{localTimestamp(facts[key], locale)}</bdi>
								</dd>
							</div>
						),
				)}
				{(
					[
						"claim_version",
						"receipt_version",
						"intent_version",
						"deadline_generation",
					] as const
				).map(
					(key) =>
						facts[key] !== undefined && (
							<div key={key}>
								<dt>
									{key === "claim_version"
										? t.claimState
										: key === "receipt_version"
											? t.review
											: key === "intent_version"
												? t.selection
												: t.effectiveDue}
								</dt>
								<dd>
									<bdi>v{String(facts[key])}</bdi>
								</dd>
							</div>
						),
				)}
			</dl>
			{lines && (
				<div className="space-y-3">
					{lines.map((line, i) => (
						<p key={`${line.variant}:${line.batch ?? i}`}>
							<bdi>
								{review.preview?.[i]?.sku ??
									selection?.goods.find((g) => g.variant === line.variant)
										?.sku ??
									line.variant}
							</bdi>{" "}
							· {t.batch}:{" "}
							<bdi>
								{(review.preview?.[i]?.code || undefined) ??
									selection?.results.find(
										(b) => b.variant === line.variant && b.batch === line.batch,
									)?.code ??
									line.batch ??
									"—"}
							</bdi>{" "}
							· {t.quantity}:{" "}
							<bdi>
								{line.quantity} {review.preview?.[i]?.unit}
							</bdi>
						</p>
					))}
				</div>
			)}
			<p>
				{t.evidence}: <bdi>{images.length}</bdi>
			</p>
			<div className="flex flex-wrap gap-3">
				{images.map((id) => (
					<PaymentEvidence key={id} {...{ id, context, locale }} />
				))}
			</div>
			<p>{t.receiptNote}</p>
			<div className="flex flex-wrap gap-3">
				<button type="button" className={action} onClick={cancel}>
					{t.cancel}
				</button>
				<button
					type="button"
					className={action}
					disabled={busy || staleReceipt}
					onClick={confirm}
				>
					{t.confirm}
				</button>
			</div>
		</Confirmation>
	);
}
