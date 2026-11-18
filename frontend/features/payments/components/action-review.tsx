"use client";
import { Button } from "../../../components/shadcn/button";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context } from "../../messaging/api";
import { localTimestamp } from "../../messaging/api";
import { Confirmation } from "../../negotiations/components/confirmation";
import { DetailField, Money } from "../../orders/components/order-ui";
import { paymentCopy } from "../copy";
import { sellerPaymentCopy } from "../seller-copy";
import { moneyUnits } from "../validation";
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
	liveRow,
	selection,
	busy,
	opener,
	cancel,
	confirm,
}: {
	locale: Locale;
	context: Context;
	review: ReviewedAction;
	liveRow: Detail | null;
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
	const liveReceipt = (liveRow ?? row).receipts.find(
		(r) => r.id === receipt?.id,
	);
	const staleReceipt =
		!!receipt && liveReceipt?.version !== body.receipt_version;
	const lines = body.lines as
		| { variant: string; batch: string | null; quantity: string }[]
		| undefined;
	const images = Array.isArray(facts.evidence)
		? facts.evidence.filter((x): x is string => typeof x === "string")
		: [];
	const path = review.packet.path,
		addsMoney = /\/receipts\/$/.test(path) || /\/confirm\/$/.test(path),
		amountUnits =
			typeof facts.amount === "string" ? moneyUnits(facts.amount) : null,
		confirmedUnits = moneyUnits(row.confirmed_total, true),
		remainingUnits = moneyUnits(row.remaining, true),
		overUnits = moneyUnits(row.overpayment, true),
		projected =
			addsMoney &&
			amountUnits !== null &&
			confirmedUnits !== null &&
			remainingUnits !== null &&
			overUnits !== null
				? (() => {
						const applied =
								amountUnits > remainingUnits ? remainingUnits : amountUnits,
							fmt = (n: bigint) =>
								`${n / BigInt(100)}.${String(n % BigInt(100)).padStart(2, "0")}`;
						return {
							confirmed: fmt(confirmedUnits + amountUnits),
							remaining: fmt(remainingUnits - applied),
							overpayment: fmt(overUnits + (amountUnits - applied)),
						};
					})()
				: null;
	return (
		<Confirmation label={t.exact} close={cancel} returnFocus={opener}>
			<div className="flex min-w-0 flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="m-0 text-lg font-semibold">{review.label}</h2>
					<p className="m-0 text-sm text-muted">
						<bdi>
							{row.number} · {row.currency}
						</bdi>{" "}
						· v{row.version}
					</p>
				</div>
				<div className="grid grid-cols-2 gap-3 rounded-lg bg-page p-3">
					<div className="min-w-0">
						<p className="m-0 text-xs text-muted">{t.confirmed}</p>
						<Money
							amount={row.confirmed_total}
							currency={row.currency}
							className="text-sm font-bold"
						/>
					</div>
					<div className="min-w-0">
						<p className="m-0 text-xs text-muted">{t.remaining}</p>
						<Money
							amount={row.remaining}
							currency={row.currency}
							className="text-sm font-bold"
						/>
					</div>
				</div>
				{context === "seller" && projected && (
					<p className="m-0 rounded-lg border border-solid border-border bg-page p-3 text-sm font-semibold">
						{sellerPaymentCopy[locale].projected}: {t.confirmed}{" "}
						<bdi>
							{projected.confirmed} {row.currency}
						</bdi>{" "}
						· {t.remaining}{" "}
						<bdi>
							{projected.remaining} {row.currency}
						</bdi>
						{projected.overpayment !== "0.00" && (
							<>
								{" "}
								· {t.overpayment}{" "}
								<bdi>
									{projected.overpayment} {row.currency}
								</bdi>
							</>
						)}
					</p>
				)}
				{receipt && (
					<section
						className="flex flex-col gap-2 rounded-lg border border-solid border-border bg-page p-3"
						aria-label={t.originalAmount}
					>
						<p className="m-0 text-sm">
							{t.effectiveAmount}:{" "}
							<Money
								amount={receipt.amount}
								currency={row.currency}
								className="font-semibold"
							/>{" "}
							· v{receipt.version}
						</p>
						<p className="m-0 text-xs text-muted">
							<bdi>{localTimestamp(receipt.paid_at, locale)}</bdi>
						</p>
						<p
							className="m-0 break-words whitespace-pre-wrap text-sm"
							dir="auto"
						>
							{receipt.description}
						</p>
						{staleReceipt && (
							<p
								role="alert"
								className="m-0 rounded-lg bg-warning-surface px-2.5 py-1.5 text-sm text-warning"
							>
								{t.error}
							</p>
						)}
					</section>
				)}
				<dl className="m-0 grid gap-3 sm:grid-cols-2">
					{(
						[
							["amount", t.amount],
							["description", t.description],
							["reason", t.reason],
						] as const
					).map(
						([key, label]) =>
							facts[key] !== undefined && (
								<DetailField
									key={key}
									label={label}
									className={key === "amount" ? undefined : "sm:col-span-2"}
								>
									{key === "amount" ? (
										<Money
											amount={String(facts[key])}
											currency={row.currency}
										/>
									) : (
										<span
											dir="auto"
											className="break-words whitespace-pre-wrap"
										>
											{String(facts[key])}
										</span>
									)}
								</DetailField>
							),
					)}
					{(["paid_at", "due_at"] as const).map(
						(key) =>
							typeof facts[key] === "string" && (
								<DetailField
									key={key}
									label={key === "paid_at" ? t.paidAt : t.laterDue}
								>
									<bdi>{localTimestamp(facts[key], locale)}</bdi>
								</DetailField>
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
								<DetailField
									key={key}
									label={
										key === "claim_version"
											? t.claimState
											: key === "receipt_version"
												? t.review
												: key === "intent_version"
													? t.selection
													: t.effectiveDue
									}
								>
									<bdi>v{String(facts[key])}</bdi>
								</DetailField>
							),
					)}
				</dl>
				{lines && (
					<div className="flex flex-col gap-2 rounded-lg border border-solid border-border p-3">
						{lines.map((line, i) => (
							<p
								key={`${line.variant}:${line.batch ?? i}`}
								className="m-0 text-sm"
							>
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
											(b) =>
												b.variant === line.variant && b.batch === line.batch,
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
				<div className="flex flex-col gap-2">
					<p className="m-0 text-xs text-muted">
						{t.evidence}: <bdi>{images.length}</bdi>
					</p>
					{images.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{images.map((id) => (
								<PaymentEvidence key={id} {...{ id, context, locale }} />
							))}
						</div>
					)}
				</div>
				<p className="m-0 text-xs leading-relaxed text-muted">
					{t.receiptNote}
				</p>
				<div className="flex flex-wrap justify-end gap-2 border-0 border-t border-solid border-border pt-4">
					<Button
						type="button"
						variant="outline"
						className="rounded-lg"
						onClick={cancel}
					>
						{t.cancel}
					</Button>
					<Button
						type="button"
						className="rounded-lg"
						disabled={busy || staleReceipt}
						onClick={confirm}
					>
						{t.confirm}
					</Button>
				</div>
			</div>
		</Confirmation>
	);
}
