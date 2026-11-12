"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Input } from "../../../components/shadcn/input";
import { Textarea } from "../../../components/shadcn/textarea";
import { cn } from "../../../lib/shadcn-utils";
import type { Locale } from "../../../lib/i18n/locales";
import { useCommerceGuard } from "../../orders/components/unsaved";
import {
	action as buyerAction,
	control as buyerControl,
	panel as buyerPanel,
} from "../../orders/components/controls";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import {
	salesAction,
	salesControl,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { fulfilmentCopy } from "../copy";
import { aftercareCopy } from "../../aftercare/copy";
import { fulfilment } from "../api";
import { actualTime, moneyUnits } from "../validation";
import { buildAction, type Mode, type Draft } from "../draft";
import { availableModes } from "../modes";
import type {
	Context,
	Capability,
	Detail,
	DisplayLine,
	Preview,
	Reviewed,
	Receipt,
} from "../types";
import { StockSelection } from "./stock-selection";
import { DeliveryEvidence } from "./evidence";
export function DeliveryActionForm({
	locale,
	context,
	row,
	locked,
	uploaded,
	review,
	upload,
	onDenied,
	guided = false,
	fixedMode,
	initialDraft,
	onDraftChange,
}: {
	locale: Locale;
	context: Context;
	row: Detail;
	locked: boolean;
	uploaded: { id: string; purpose: string } | null;
	review: (review: Reviewed, opener: HTMLElement | null) => void;
	upload: (file: File, purpose: "claim" | "correction" | "refund") => void;
	onDenied: () => void;
	guided?: boolean;
	fixedMode?: Mode;
	initialDraft?: Draft;
	onDraftChange?: (draft: Draft) => void;
}) {
	const required: Record<Mode, Capability> = {
		recipient: "recipient_edit",
		arrange: "prepare",
		prepare: "prepare",
		partial: "partial",
		charge: "prepare",
		claim: "claim",
		refund: "refund",
		correction: "claim",
		withdraw: "claim",
		tracking: "tracking",
		deliver: "deliver",
		dispatch: "dispatch",
	};
	const t = fulfilmentCopy[locale],
		r = aftercareCopy[locale],
		s = sellerSalesCopy[locale],
		isSeller = context === "seller",
		action = isSeller
			? cn(salesAction, "min-h-10 rounded-lg text-sm shadow-none")
			: buyerAction,
		control = isSeller
			? cn(
					salesControl,
					"h-10 min-h-10 rounded-lg border-solid text-sm shadow-none",
				)
			: buyerControl,
		FieldInput = isSeller ? Input : "input",
		FieldTextarea = isSeller ? Textarea : "textarea",
		panel = isSeller ? salesPanel : buyerPanel,
		prefix = useId(),
		c = row.capabilities,
		modes = availableModes(row, context, locale);
	const [mode, setMode] = useState<Mode>(
			() => fixedMode ?? modes[0]?.[0] ?? "recipient",
		),
		[dirty, setDirty] = useState(() => Boolean(initialDraft)),
		[busy, setBusy] = useState(false),
		[invalid, setInvalid] = useState(false),
		[previewError, setPreviewError] = useState(false);
	const [name, setName] = useState(
			initialDraft?.name ?? row.recipient?.name ?? "",
		),
		[phone, setPhone] = useState(
			initialDraft?.phone ?? row.recipient?.phone ?? "",
		),
		[address, setAddress] = useState(
			initialDraft?.address ?? row.recipient?.address ?? "",
		),
		[instructions, setInstructions] = useState(
			initialDraft?.instructions ??
				(context === "buyer"
					? (row.recipient?.instructions ?? "")
					: (row.arrangement?.instructions ?? "")),
		);
	const [provider, setProvider] = useState(initialDraft?.provider ?? ""),
		[selfDelivery, setSelfDelivery] = useState(
			initialDraft?.selfDelivery ?? false,
		),
		[amount, setAmount] = useState(initialDraft?.amount ?? ""),
		[description, setDescription] = useState(initialDraft?.description ?? ""),
		[reason, setReason] = useState(initialDraft?.reason ?? ""),
		[reference, setReference] = useState(initialDraft?.reference ?? "");
	const [at, setAt] = useState(initialDraft?.at ?? ""),
		[target, setTarget] = useState(initialDraft?.target ?? ""),
		[receipt, setReceipt] = useState<Receipt | undefined>(
			initialDraft?.receipt,
		),
		[lines, setLines] = useState<DisplayLine[]>(initialDraft?.lines ?? []),
		[images, setImages] = useState<string[]>(initialDraft?.images ?? []),
		[file, setFile] = useState<File | null>(null);
	const [base, setBase] = useState(() => ({
		version: row.version,
		goods_version: row.goods_version,
		recipient_revision: row.recipient_revision,
		recipient: row.recipient?.id,
		arrangement: row.arrangement?.id,
		provider: row.arrangement?.provider_id,
		charge: row.charge_id,
		preparation: row.preparation?.id,
	}));
	const guard = useCommerceGuard(locale, dirty),
		owner = useRef<object | null>(null),
		live = useRef(true),
		seenUpload = useRef<string | null>(null);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
			owner.current = null;
		};
	}, []);
	useEffect(() => {
		if (
			uploaded &&
			uploaded.id !== seenUpload.current &&
			uploaded.purpose === mode &&
			(mode === "refund" ? context === "seller" && c.refund : c.claim)
		) {
			seenUpload.current = uploaded.id;
			setImages((old) =>
				old.includes(uploaded.id) ? old : [...old, uploaded.id].slice(0, 3),
			);
			setFile(null);
			setDirty(true);
		}
	}, [uploaded, mode, context, c.refund, c.claim]);
	useEffect(() => {
		if (!onDraftChange || !dirty) return;
		onDraftChange({
			name,
			phone,
			address,
			instructions,
			provider,
			selfDelivery,
			amount,
			description,
			reason,
			reference,
			at,
			target,
			receipt,
			lines,
			images,
		});
	}, [
		onDraftChange,
		dirty,
		name,
		phone,
		address,
		instructions,
		provider,
		selfDelivery,
		amount,
		description,
		reason,
		reference,
		at,
		target,
		receipt,
		lines,
		images,
	]);
	function reload() {
		setBase({
			version: row.version,
			goods_version: row.goods_version,
			recipient_revision: row.recipient_revision,
			recipient: row.recipient?.id,
			arrangement: row.arrangement?.id,
			provider: row.arrangement?.provider_id,
			charge: row.charge_id,
			preparation: row.preparation?.id,
		});
		setPreviewError(false);
	}
	function discard(next: Mode) {
		setMode(next);
		setName(row.recipient?.name ?? "");
		setPhone(row.recipient?.phone ?? "");
		setAddress(row.recipient?.address ?? "");
		setProvider("");
		setSelfDelivery(false);
		setInstructions(
			next === "recipient"
				? (row.recipient?.instructions ?? "")
				: next === "arrange"
					? (row.arrangement?.instructions ?? "")
					: "",
		);
		setDirty(false);
		setImages([]);
		setFile(null);
		setAmount("");
		setDescription("");
		setReason("");
		setReference("");
		setAt("");
		setTarget("");
		setReceipt(undefined);
		setLines([]);
		setInvalid(false);
		setPreviewError(false);
		reload();
	}
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (locked || owner.current || !modes.some(([value]) => value === mode))
			return;
		const built = buildAction(locale, row, mode, base, {
			name,
			phone,
			address,
			instructions,
			provider,
			selfDelivery,
			amount,
			description,
			reason,
			reference,
			at,
			target,
			receipt,
			lines,
			images,
		});
		if (!built) {
			setInvalid(true);
			return;
		}
		const { intent, fields } = built,
			label = modes.find(([value]) => value === mode)?.[1] ?? t.error,
			body = intent.body as Record<string, unknown>;
		setInvalid(false);
		if (mode !== "dispatch") {
			review(
				{
					intent,
					capability: required[mode],
					label,
					fields,
					images: [...images],
					receipt,
					lines:
						mode === "prepare"
							? row.payment_method === "cod"
								? structuredClone(lines)
								: structuredClone(row.held_lines)
							: undefined,
				},
				document.activeElement as HTMLElement,
			);
			return;
		}
		if (!base.preparation) {
			setInvalid(true);
			return;
		}
		const token = {};
		owner.current = token;
		setBusy(true);
		setPreviewError(false);
		const opener = document.activeElement as HTMLElement;
		try {
			const preview = await fulfilment<Preview>(
				context,
				`orders/${row.id}/dispatch/review/`,
				{ ...body, preparation: base.preparation },
			);
			if (!live.current || owner.current !== token) return;
			review(
				{
					intent: { ...intent, body: preview.packet },
					capability: required[mode],
					label,
					fields,
					images: [],
					preview,
				},
				opener,
			);
		} catch (error) {
			if (live.current && owner.current === token) {
				setPreviewError(true);
				const { accessLost } = await import("../../messaging/hooks");
				if (accessLost(error)) onDenied();
			}
		} finally {
			if (live.current && owner.current === token) {
				owner.current = null;
				setBusy(false);
			}
		}
	}
	const available = modes.some(([value]) => value === mode);
	if (!modes.length && !dirty) return null;
	const money = ["charge", "claim", "correction", "refund"].includes(mode),
		timed = ["claim", "correction", "tracking", "deliver", "refund"].includes(
			mode,
		),
		financial = ["claim", "correction", "refund"].includes(mode),
		timeLabel =
			mode === "refund"
				? r.sentAt
				: mode === "tracking" || mode === "deliver"
					? t.occurredAt
					: t.paidAt;
	const refundProvider = row.refund_providers.find(
			(item) => item.id === provider,
		),
		refundAmount = moneyUnits(amount),
		refundBound = refundProvider
			? moneyUnits(refundProvider.refundable, true)
			: null;
	const selector = (
		<label
			className={isSeller ? "block min-w-0 max-w-2xl space-y-2" : undefined}
		>
			{t.exact}
			<select
				aria-label={t.exact}
				className={control}
				value={available ? mode : ""}
				disabled={locked || busy}
				onChange={(event) => {
					const next = event.target.value as Mode;
					guard.choose(() => discard(next));
				}}
			>
				{!available && (
					<option value="" disabled>
						{t.exact}
					</option>
				)}
				{modes.map(([value, label]) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
		</label>
	);
	const form = (
		<form
			onSubmit={submit}
			onChange={() => setDirty(true)}
			className="space-y-4"
			noValidate
		>
			<fieldset
				disabled={locked || busy || !available}
				className={
					isSeller
						? guided
							? "m-0 min-w-0 space-y-4 border-0 p-0 text-sm [&_label]:block [&_label]:space-y-1.5 [&_label]:font-medium [&_label:has(input[type=checkbox])]:flex [&_p]:m-0 [&_p]:text-xs [&_p]:leading-relaxed [&_p]:text-muted"
							: "m-0 min-w-0 space-y-4 rounded-xl border border-solid border-border p-4 text-sm sm:p-5 [&_label]:block [&_label]:space-y-1.5 [&_label]:font-medium [&_label:has(input[type=checkbox])]:flex [&_p]:text-xs [&_p]:text-muted"
						: "space-y-4"
				}
			>
				{isSeller && !guided && (
					<legend className="px-2 text-sm font-semibold">
						{modes.find(([value]) => value === mode)?.[1] ?? t.exact}
					</legend>
				)}
				{mode === "recipient" && (
					<>
						<label htmlFor={`${prefix}-name`}>{t.recipientName}</label>
						<FieldInput
							id={`${prefix}-name`}
							className={control}
							value={name}
							maxLength={120}
							autoComplete="off"
							onChange={(event) => setName(event.target.value)}
						/>
						<label htmlFor={`${prefix}-phone`}>{t.phone}</label>
						<FieldInput
							id={`${prefix}-phone`}
							className={control}
							dir="ltr"
							value={phone}
							maxLength={40}
							autoComplete="off"
							onChange={(event) => setPhone(event.target.value)}
						/>
						<label htmlFor={`${prefix}-address`}>{t.address}</label>
						<FieldTextarea
							id={`${prefix}-address`}
							className={
								isSeller ? cn(control, "h-auto min-h-24 resize-y") : control
							}
							value={address}
							maxLength={1500}
							autoComplete="off"
							onChange={(event) => setAddress(event.target.value)}
						/>
						<p>{t.unchangedDestination}</p>
					</>
				)}
				{mode === "arrange" && (
					<>
						<label htmlFor={`${prefix}-field-1`}>
							{t.provider}
							<FieldInput
								id={`${prefix}-field-1`}
								className={control}
								value={provider}
								maxLength={160}
								onChange={(event) => setProvider(event.target.value)}
							/>
						</label>
						<label
							className="flex items-center gap-3"
							htmlFor={`${prefix}-field-2`}
						>
							<FieldInput
								id={`${prefix}-field-2`}
								type="checkbox"
								className={
									isSeller
										? "size-4 shrink-0 rounded border-control p-0 accent-action shadow-none"
										: undefined
								}
								checked={selfDelivery}
								onChange={(event) => setSelfDelivery(event.target.checked)}
							/>
							{t.selfDelivery}
						</label>
					</>
				)}
				{mode === "recipient" || mode === "arrange" ? (
					<label htmlFor={`${prefix}-field-3`}>
						{t.instructions}
						<FieldTextarea
							id={`${prefix}-field-3`}
							className={
								isSeller ? cn(control, "h-auto min-h-24 resize-y") : control
							}
							aria-label={t.instructions}
							value={instructions}
							maxLength={1000}
							onChange={(event) => setInstructions(event.target.value)}
						/>
					</label>
				) : null}
				{mode === "prepare" && (
					<>
						{!guided ? (
							<>
								<p>{t.stockNote}</p>
								<ul>
									{row.goods.map((g) => (
										<li key={`${g.variant}:${g.tier}`}>
											<bdi>
												{g.sku} · {g.quantity} {g.unit_labels[locale] ?? g.unit}
											</bdi>
										</li>
									))}
								</ul>
							</>
						) : row.payment_method === "cod" ? (
							<p>{t.stockNote}</p>
						) : null}
						{row.payment_method === "cod" && (
							<StockSelection
								{...{
									locale,
									context,
									id: row.id,
									disabled: locked || busy,
									lines,
								}}
								change={(value) => {
									setLines(value);
									setDirty(true);
								}}
							/>
						)}
					</>
				)}
				{mode === "partial" && <p>{t.partialNote}</p>}
				{mode === "correction" && (
					<label>
						{t.receipts}
						<select
							className={control}
							aria-label={t.receipts}
							value={target}
							onChange={(event) => {
								const next = event.target.value;
								guard.choose(() => {
									const chosen = row.receipts.find(
										(receipt) => receipt.id === next,
									);
									setReceipt(chosen ? structuredClone(chosen) : undefined);
									setTarget(next);
									setAmount(chosen?.amount ?? "");
									setDescription(chosen?.description ?? "");
									setAt(
										chosen
											? new Date(
													Date.parse(chosen.paid_at) -
														new Date().getTimezoneOffset() * 60000,
												)
													.toISOString()
													.slice(0, 19)
											: "",
									);
									setImages([]);
									setFile(null);
									setReason("");
									setDirty(false);
								});
							}}
						>
							<option value="">—</option>
							{row.receipts
								.filter((receipt) => receipt.can_correct)
								.map((receipt) => (
									<option key={receipt.id} value={receipt.id}>
										{receipt.amount} {row.currency} · v{receipt.version} ·{" "}
										{receipt.id}
									</option>
								))}
						</select>
					</label>
				)}
				{mode === "withdraw" && (
					<label>
						{t.claims}
						<select
							className={control}
							aria-label={t.claims}
							value={target}
							onChange={(event) => {
								const next = event.target.value;
								guard.choose(() => {
									setTarget(next);
									setReason("");
									setDirty(false);
								});
							}}
						>
							<option value="">—</option>
							{row.claims
								.filter((claim) => claim.can_withdraw)
								.map((claim) => (
									<option key={claim.id} value={claim.id}>
										{claim.amount} {claim.currency} · {claim.description}
									</option>
								))}
						</select>
					</label>
				)}
				{mode === "refund" && (
					<>
						<label>
							{t.provider}
							<select
								className={control}
								value={provider}
								onChange={(event) => {
									const next = event.target.value;
									guard.choose(() => {
										discard("refund");
										setProvider(next);
										setDirty(true);
									});
								}}
							>
								<option value="">—</option>
								{row.refund_providers.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name} · {item.id} · {r.limit}: {item.refundable}{" "}
										{row.currency}
									</option>
								))}
							</select>
						</label>
						{refundProvider && (
							<p>
								{r.limit}:{" "}
								<bdi>
									{refundProvider.refundable} {row.currency}
								</bdi>
							</p>
						)}
						<p>{r.deliveryNote}</p>
					</>
				)}
				{money && (
					<label htmlFor={`${prefix}-field-4`}>
						{t.amount} (<bdi>{row.currency}</bdi>)
						<FieldInput
							id={`${prefix}-field-4`}
							className={control}
							dir="ltr"
							inputMode="decimal"
							value={amount}
							maxLength={25}
							onChange={(event) => setAmount(event.target.value)}
							aria-invalid={
								invalid &&
								(mode === "refund"
									? refundAmount === null ||
										refundBound === null ||
										refundAmount > refundBound
									: moneyUnits(amount, mode !== "claim") === null)
							}
						/>
					</label>
				)}
				{timed && (
					<label htmlFor={`${prefix}-field-5`}>
						{timeLabel}
						<FieldInput
							id={`${prefix}-field-5`}
							className={control}
							dir="ltr"
							type="datetime-local"
							step="1"
							aria-label={timeLabel}
							value={at}
							onChange={(event) => setAt(event.target.value)}
							aria-invalid={invalid && !actualTime(at)}
						/>
						<span className="text-sm text-muted">{t.inputTimezone}</span>
					</label>
				)}
				{(mode === "tracking" || mode === "refund") && (
					<label htmlFor={`${prefix}-field-6`}>
						{mode === "refund" ? r.reference : t.tracking}
						<FieldInput
							id={`${prefix}-field-6`}
							className={control}
							value={reference}
							maxLength={160}
							onChange={(event) => setReference(event.target.value)}
						/>
					</label>
				)}
				{financial && (
					<>
						<label htmlFor={`${prefix}-field-7`}>
							{t.description}
							<FieldTextarea
								id={`${prefix}-field-7`}
								className={
									isSeller ? cn(control, "h-auto min-h-24 resize-y") : control
								}
								aria-label={t.description}
								value={description}
								maxLength={500}
								onChange={(event) => setDescription(event.target.value)}
							/>
						</label>
						{mode !== "refund" && <p>{t.claimNote}</p>}
						<label htmlFor={`${prefix}-field-8`}>
							{t.evidence}
							<FieldInput
								id={`${prefix}-field-8`}
								className={
									isSeller
										? "h-auto min-h-10 w-full rounded-lg border border-solid border-border p-2 text-sm file:me-3 file:rounded-md file:border-0 file:bg-info file:px-3 file:py-1.5 file:text-action"
										: undefined
								}
								type="file"
								accept="image/jpeg,image/png,image/webp"
								disabled={images.length >= 3}
								onChange={(event) => setFile(event.target.files?.[0] ?? null)}
							/>
						</label>
						<p className="text-sm text-muted">{t.filesNote}</p>
						<button
							type="button"
							className={action}
							disabled={!file || images.length >= 3}
							onClick={() => {
								if (
									!file ||
									file.size > 5 * 1024 * 1024 ||
									!["image/jpeg", "image/png", "image/webp"].includes(file.type)
								) {
									setInvalid(true);
									return;
								}
								upload(
									file,
									mode === "refund"
										? "refund"
										: mode === "correction"
											? "correction"
											: "claim",
								);
							}}
						>
							{t.uploads}
						</button>
						<div className="flex flex-wrap gap-3">
							{images.map((id) => (
								<div key={id}>
									<DeliveryEvidence {...{ id, context, locale }} />
									<button
										type="button"
										className={action}
										onClick={() =>
											setImages((values) =>
												values.filter((value) => value !== id),
											)
										}
									>
										{t.removeImage}
									</button>
								</div>
							))}
						</div>
					</>
				)}
				{mode !== "arrange" && mode !== "claim" && mode !== "refund" && (
					<label htmlFor={`${prefix}-field-9`}>
						{t.reason}
						<FieldTextarea
							id={`${prefix}-field-9`}
							className={
								isSeller ? cn(control, "h-auto min-h-24 resize-y") : control
							}
							aria-label={t.reason}
							value={reason}
							minLength={3}
							maxLength={1000}
							onChange={(event) => setReason(event.target.value)}
						/>
					</label>
				)}
				{invalid && <p role="alert">{t.error}</p>}
				{previewError && <p role="alert">{t.notReady}</p>}
				{base.version !== row.version ||
				base.goods_version !== row.goods_version ? (
					<p role="status">{t.stale}</p>
				) : null}
				<div className="flex flex-wrap gap-3">
					<button
						type="button"
						className={action}
						onClick={reload}
						title={isSeller ? t.reload : undefined}
					>
						{isSeller ? t.refresh : t.reload}
					</button>
					<button
						className={
							isSeller
								? cn(
										action,
										"border-action bg-action text-white hover:bg-action/90 hover:text-white",
									)
								: action
						}
						type="submit"
					>
						{modes.find(([value]) => value === mode)?.[1] ?? t.review}
					</button>
				</div>
			</fieldset>
		</form>
	);
	if (guided)
		return (
			<>
				{guard.feedback}
				{!available && <p role="status">{t.actionChanged}</p>}
				{form}
			</>
		);
	return (
		<section className={panel}>
			<h2 className="text-xl font-bold" tabIndex={-1} data-fulfilment-actions>
				{isSeller ? s.actions : t.exact}
			</h2>
			{isSeller && <p className="text-sm text-muted">{t.exact}</p>}
			{guard.feedback}
			{!available && <p role="status">{t.actionChanged}</p>}
			{selector}
			{form}
		</section>
	);
}
