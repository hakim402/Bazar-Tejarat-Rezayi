"use client";
import { useId, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import type { Detail, Receipt, Claim } from "../api";
import { PaymentEvidence } from "./evidence";
import type { Context } from "../../messaging/api";
import { paymentCopy } from "../copy";
import { actualTime, moneyUnits } from "../validation";
import { action, control, panel } from "../../orders/components/controls";
export function FactsForm({
	locale,
	row,
	receipt,
	prior,
	context,
	onRemove,
	disabled,
	evidence,
	onEvidence,
	onReview,
	onDirty,
}: {
	locale: Locale;
	row: Detail;
	receipt?: Receipt;
	prior?: Claim;
	context: Context;
	onRemove: (id: string) => void;
	disabled: boolean;
	evidence: string[];
	onEvidence: (file: File) => void;
	onReview: (
		path: string,
		body: Record<string, unknown>,
		label: string,
	) => void;
	onDirty: () => void;
}) {
	const initial = receipt ?? prior;
	const errorId = useId(),
		descriptionId = useId(),
		reasonId = useId();
	const t = paymentCopy[locale],
		[amount, setAmount] = useState(receipt?.amount ?? prior?.amount ?? ""),
		[paidAt, setPaidAt] = useState(
			initial
				? new Date(
						Date.parse(initial.paid_at) -
							new Date(initial.paid_at).getTimezoneOffset() * 60000,
					)
						.toISOString()
						.slice(0, 16)
				: "",
		),
		[description, setDescription] = useState(
			receipt?.description ?? prior?.description ?? "",
		),
		[reason, setReason] = useState(""),
		[invalid, setInvalid] = useState(false);
	const correction = !!receipt,
		claim = row.capabilities.claim && !correction;
	return (
		<form
			className={panel}
			onChange={onDirty}
			onSubmit={(e) => {
				e.preventDefault();
				const at = actualTime(paidAt);
				if (
					moneyUnits(amount, correction) === null ||
					!at ||
					!description.trim() ||
					description.length > 500 ||
					(correction && reason.trim().length < 3)
				) {
					setInvalid(true);
					return;
				}
				onReview(
					correction
						? `receipts/${receipt.id}/corrections/`
						: `orders/${row.id}/${claim ? "claims" : "receipts"}/`,
					{
						amount,
						currency: row.currency,
						paid_at: at,
						description: description.trim(),
						evidence,
						...(prior ? { previous: prior.id } : {}),
						...(correction
							? { receipt_version: receipt.version, reason: reason.trim() }
							: {}),
					},
					correction ? t.correction : claim ? t.submitClaim : t.receipt,
				);
			}}
		>
			<h3 className="font-semibold">
				{correction ? t.correction : claim ? t.claim : t.receipt}
			</h3>
			<p className="text-sm text-muted">
				{correction ? t.correctionNote : claim ? t.claimNote : t.receiptNote}
			</p>
			{receipt && (
				<p>
					{t.originalAmount}:{" "}
					<bdi>
						{receipt.original_amount} {row.currency}
					</bdi>{" "}
					· {t.effectiveAmount}:{" "}
					<bdi>
						{receipt.amount} {row.currency}
					</bdi>{" "}
					· v{receipt.version}
				</p>
			)}
			<fieldset disabled={disabled} className="space-y-3">
				<label className="block">
					{t.amount} <bdi>{row.currency}</bdi>
					<input
						required
						dir="ltr"
						inputMode="decimal"
						placeholder="0.00"
						aria-invalid={invalid && moneyUnits(amount, correction) === null}
						aria-describedby={invalid ? errorId : undefined}
						className={control}
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
						maxLength={25}
					/>
				</label>
				<label className="block">
					{t.paidAt}
					<input
						required
						type="datetime-local"
						aria-invalid={invalid && !actualTime(paidAt)}
						aria-describedby={invalid ? errorId : undefined}
						className={control}
						value={paidAt}
						onChange={(e) => setPaidAt(e.target.value)}
					/>
				</label>
				<div className="block">
					<label htmlFor={descriptionId}>{t.description}</label>
					<textarea
						id={descriptionId}
						required
						maxLength={500}
						aria-invalid={invalid && !description.trim()}
						aria-describedby={invalid ? errorId : undefined}
						className={control}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</div>
				{correction && (
					<div className="block">
						<label htmlFor={reasonId}>{t.reason}</label>
						<textarea
							id={reasonId}
							required
							minLength={3}
							aria-invalid={invalid && reason.trim().length < 3}
							aria-describedby={invalid ? errorId : undefined}
							maxLength={1000}
							className={control}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>
				)}
				<label className="block">
					{t.evidence}
					<input
						type="file"
						accept="image/jpeg,image/png,image/webp"
						disabled={evidence.length >= 3}
						className={control}
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (
								file &&
								file.size <= 5 * 1024 * 1024 &&
								["image/jpeg", "image/png", "image/webp"].includes(file.type)
							)
								onEvidence(file);
							else if (file) setInvalid(true);
						}}
					/>
				</label>
				<p className="text-sm text-muted">
					{t.evidenceNote} ({evidence.length}/3)
				</p>
				<p className="text-sm text-muted">{t.inputTimezone}</p>
				<div className="flex flex-wrap gap-3">
					{evidence.map((id) => (
						<div key={id}>
							<PaymentEvidence {...{ id, context, locale }} />
							<button
								type="button"
								className={action}
								onClick={() => onRemove(id)}
							>
								{t.removeImage}
							</button>
						</div>
					))}
				</div>
				{invalid && (
					<p role="alert" id={errorId}>
						{t.error}
					</p>
				)}
				<button type="submit" data-payment-facts-review className={action}>
					{t.exact}
				</button>
			</fieldset>
		</form>
	);
}
