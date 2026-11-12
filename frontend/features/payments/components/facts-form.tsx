"use client";
import { useId, useState } from "react";
import toast from "react-hot-toast";
import { Input } from "../../../components/shadcn/input";
import { Textarea } from "../../../components/shadcn/textarea";
import { cn } from "../../../lib/shadcn-utils";
import { sellerPaymentCopy } from "../seller-copy";
import type { Locale } from "../../../lib/i18n/locales";
import type { Detail, Receipt, Claim } from "../api";
import { PaymentEvidence } from "./evidence";
import type { Context } from "../../messaging/api";
import { paymentCopy } from "../copy";
import { actualTime, moneyUnits } from "../validation";
import {
	action as defaultAction,
	control as defaultControl,
	panel as defaultPanel,
} from "../../orders/components/controls";
import {
	salesAction,
	salesControl,
} from "../../sales/components/seller-sales-ui";
// Normalize user input as a decimal string; never round or use floating point.
function paymentAmount(raw: string, zero: boolean) {
	const value = raw.trim();
	if (!/^(0|[1-9]\d{0,21})(?:\.\d{1,2})?$/.test(value)) return null;
	const [whole, fraction = ""] = value.split(".");
	const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
	return moneyUnits(normalized, zero) === null ? null : normalized;
}
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
		amountId = useId(),
		paidId = useId(),
		fileId = useId(),
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
		claim = row.capabilities.claim && !correction,
		seller = context === "seller",
		action = seller
			? cn(salesAction, "min-h-10 rounded-lg shadow-none")
			: defaultAction,
		control = seller
			? cn(
					salesControl,
					"min-h-10! h-10 rounded-lg! border-solid text-sm! shadow-none",
				)
			: defaultControl,
		FieldInput = seller ? Input : "input",
		FieldTextarea = seller ? Textarea : "textarea",
		panel = seller
			? "min-w-0 space-y-4 rounded-xl border border-solid border-border bg-surface p-4 shadow-none sm:p-5"
			: defaultPanel;
	return (
		<form
			className={panel}
			onChange={onDirty}
			onSubmit={(e) => {
				e.preventDefault();
				const at = actualTime(paidAt),
					normalizedAmount = paymentAmount(amount, correction);
				if (
					normalizedAmount === null ||
					!at ||
					!description.trim() ||
					description.length > 500 ||
					(correction && reason.trim().length < 3)
				) {
					setInvalid(true);
					toast.error(t.error);
					return;
				}
				onReview(
					correction
						? `receipts/${receipt.id}/corrections/`
						: `orders/${row.id}/${claim ? "claims" : "receipts"}/`,
					{
						amount: normalizedAmount,
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
			<h3
				className={
					seller
						? "m-0 text-base font-semibold tracking-tight"
						: "font-semibold"
				}
			>
				{correction
					? t.correction
					: claim
						? t.claim
						: seller
							? sellerPaymentCopy[locale].recordPayment
							: t.receipt}
			</h3>
			<p className="m-0 text-sm leading-relaxed text-muted">
				{correction
					? t.correctionNote
					: claim
						? t.claimNote
						: seller
							? sellerPaymentCopy[locale].recordHelp
							: t.receiptNote}
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
			<fieldset
				disabled={disabled}
				className={
					seller
						? "m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2"
						: "space-y-3"
				}
			>
				<label
					className={
						seller ? "block min-w-0 space-y-2 text-sm font-medium" : "block"
					}
					htmlFor={amountId}
				>
					{t.amount} <bdi>{row.currency}</bdi>
					<FieldInput
						id={amountId}
						required
						dir="ltr"
						inputMode="decimal"
						placeholder="0.00"
						aria-invalid={invalid && paymentAmount(amount, correction) === null}
						aria-describedby={invalid ? errorId : undefined}
						className={control}
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
						maxLength={25}
					/>
					<span className="block text-xs font-normal leading-relaxed text-muted">
						{seller ? sellerPaymentCopy[locale].amountHelp : ""}
					</span>
				</label>
				<label
					className={
						seller ? "block min-w-0 space-y-2 text-sm font-medium" : "block"
					}
					htmlFor={paidId}
				>
					{t.paidAt}
					<FieldInput
						id={paidId}
						required
						type="datetime-local"
						aria-invalid={invalid && !actualTime(paidAt)}
						aria-describedby={invalid ? errorId : undefined}
						className={control}
						value={paidAt}
						onChange={(e) => setPaidAt(e.target.value)}
					/>
				</label>
				<div className={seller ? "min-w-0 space-y-2 sm:col-span-2" : "block"}>
					<label htmlFor={descriptionId}>{t.description}</label>
					<FieldTextarea
						id={descriptionId}
						required
						maxLength={500}
						aria-invalid={invalid && !description.trim()}
						aria-describedby={invalid ? errorId : undefined}
						className={
							seller ? cn(control, "h-auto min-h-24! resize-y") : control
						}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</div>
				{correction && (
					<div className={seller ? "min-w-0 space-y-2 sm:col-span-2" : "block"}>
						<label htmlFor={reasonId}>{t.reason}</label>
						<FieldTextarea
							id={reasonId}
							required
							minLength={3}
							aria-invalid={invalid && reason.trim().length < 3}
							aria-describedby={invalid ? errorId : undefined}
							maxLength={1000}
							className={
								seller ? cn(control, "h-auto min-h-24! resize-y") : control
							}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>
				)}
				<label
					className={
						seller
							? "block min-w-0 space-y-2 border-t border-border pt-4 text-sm font-semibold sm:col-span-2"
							: "block"
					}
					htmlFor={fileId}
				>
					{t.evidence}
					<FieldInput
						id={fileId}
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
				<p
					className={
						seller
							? "text-xs leading-relaxed text-muted sm:col-span-2"
							: "text-sm text-muted"
					}
				>
					{t.evidenceNote} ({evidence.length}/3)
				</p>
				<p
					className={
						seller
							? "text-xs leading-relaxed text-muted sm:col-span-2"
							: "text-sm text-muted"
					}
				>
					{t.inputTimezone}
				</p>
				<div
					className={
						seller
							? "flex min-w-0 flex-wrap gap-3 sm:col-span-2"
							: "flex flex-wrap gap-3"
					}
				>
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
					<p
						role="alert"
						id={errorId}
						className={
							seller
								? "rounded-xl border border-warning bg-warning-surface p-3 text-sm text-warning sm:col-span-2"
								: undefined
						}
					>
						{t.error}
					</p>
				)}
				<button
					type="submit"
					data-payment-facts-review
					className={
						seller
							? cn(
									action,
									"justify-self-start border-action bg-action text-white hover:bg-action/90 hover:text-white sm:col-span-2",
								)
							: action
					}
				>
					{t.exact}
				</button>
			</fieldset>
		</form>
	);
}
