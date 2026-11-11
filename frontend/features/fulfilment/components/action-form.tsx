"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
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
import { buildAction, type Mode } from "../draft";
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
}: {
	locale: Locale;
	context: Context;
	row: Detail;
	locked: boolean;
	uploaded: { id: string; purpose: string } | null;
	review: (review: Reviewed, opener: HTMLElement | null) => void;
	upload: (file: File, purpose: "claim" | "correction" | "refund") => void;
	onDenied: () => void;
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
		action = isSeller ? salesAction : buyerAction,
		control = isSeller ? salesControl : buyerControl,
		panel = isSeller ? salesPanel : buyerPanel,
		prefix = useId(),
		c = row.capabilities,
		preDispatch = !["dispatched", "delivered"].includes(row.stage);
	const modes: [Mode, string][] = [];
	if (c.recipient_edit && preDispatch)
		modes.push(["recipient", t.saveRecipient]);
	if (c.prepare && preDispatch)
		modes.push(
			["arrange", t.saveArrangement],
			["prepare", t.prepare],
			["charge", t.proposeCharge],
		);
	if (
		c.partial &&
		preDispatch &&
		row.payment_method === "advance" &&
		row.goods_confirmed !== "0.00" &&
		row.goods_remaining !== "0.00"
	)
		modes.push(["partial", t.partial]);
	if (c.dispatch && preDispatch && row.preparation?.current)
		modes.push(["dispatch", t.reviewDispatch]);
	if (c.claim && row.charge_id && row.charge !== "0.00")
		modes.push(["claim", t.claimDelivery]);
	if (c.claim && row.receipts.some((receipt) => receipt.can_correct))
		modes.push(["correction", t.correctionDelivery]);
	if (c.claim && row.claims.some((claim) => claim.can_withdraw))
		modes.push(["withdraw", t.withdrawClaim]);
	if (context === "seller" && c.refund && row.refund_providers.length > 0)
		modes.push(["refund", r.deliveryRefund]);
	if (c.tracking && !preDispatch) modes.push(["tracking", t.recordTracking]);
	if (c.deliver && row.stage === "dispatched")
		modes.push(["deliver", t.deliver]);
	const [mode, setMode] = useState<Mode>(() => modes[0]?.[0] ?? "recipient"),
		[dirty, setDirty] = useState(false),
		[busy, setBusy] = useState(false),
		[invalid, setInvalid] = useState(false),
		[previewError, setPreviewError] = useState(false);
	const [name, setName] = useState(row.recipient?.name ?? ""),
		[phone, setPhone] = useState(row.recipient?.phone ?? ""),
		[address, setAddress] = useState(row.recipient?.address ?? ""),
		[instructions, setInstructions] = useState(
			context === "buyer"
				? (row.recipient?.instructions ?? "")
				: (row.arrangement?.instructions ?? ""),
		);
	const [provider, setProvider] = useState(""),
		[selfDelivery, setSelfDelivery] = useState(false),
		[amount, setAmount] = useState(""),
		[description, setDescription] = useState(""),
		[reason, setReason] = useState(""),
		[reference, setReference] = useState("");
	const [at, setAt] = useState(""),
		[target, setTarget] = useState(""),
		[receipt, setReceipt] = useState<Receipt | undefined>(),
		[lines, setLines] = useState<DisplayLine[]>([]),
		[images, setImages] = useState<string[]>([]),
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
	return (
		<section className={panel}>
			<h2 className="text-xl font-bold" tabIndex={-1} data-fulfilment-actions>
				{isSeller ? s.actions : t.exact}
			</h2>
			{isSeller && <p className="text-sm text-muted">{t.exact}</p>}
			{guard.feedback}
			{!available && <p role="status">{t.actionChanged}</p>}
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
							? "min-w-0 space-y-4 rounded-xl border border-border p-4 sm:p-5 [&_label]:block [&_label]:space-y-2 [&_label:has(input[type=checkbox])]:flex"
							: "space-y-4"
					}
				>
					{isSeller && (
						<legend className="px-2 text-sm font-semibold">
							{modes.find(([value]) => value === mode)?.[1] ?? t.exact}
						</legend>
					)}
					{mode === "recipient" && (
						<>
							<label htmlFor={`${prefix}-name`}>{t.recipientName}</label>
							<input
								id={`${prefix}-name`}
								className={control}
								value={name}
								maxLength={120}
								autoComplete="off"
								onChange={(event) => setName(event.target.value)}
							/>
							<label htmlFor={`${prefix}-phone`}>{t.phone}</label>
							<input
								id={`${prefix}-phone`}
								className={control}
								dir="ltr"
								value={phone}
								maxLength={40}
								autoComplete="off"
								onChange={(event) => setPhone(event.target.value)}
							/>
							<label htmlFor={`${prefix}-address`}>{t.address}</label>
							<textarea
								id={`${prefix}-address`}
								className={control}
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
							<label>
								{t.provider}
								<input
									className={control}
									value={provider}
									maxLength={160}
									onChange={(event) => setProvider(event.target.value)}
								/>
							</label>
							<label className="flex items-center gap-3">
								<input
									type="checkbox"
									checked={selfDelivery}
									onChange={(event) => setSelfDelivery(event.target.checked)}
								/>
								{t.selfDelivery}
							</label>
						</>
					)}
					{mode === "recipient" || mode === "arrange" ? (
						<label>
							{t.instructions}
							<textarea
								className={control}
								aria-label={t.instructions}
								value={instructions}
								maxLength={1000}
								onChange={(event) => setInstructions(event.target.value)}
							/>
						</label>
					) : null}
					{mode === "prepare" && (
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
						<label>
							{t.amount} (<bdi>{row.currency}</bdi>)
							<input
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
						<label>
							{timeLabel}
							<input
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
						<label>
							{mode === "refund" ? r.reference : t.tracking}
							<input
								className={control}
								value={reference}
								maxLength={160}
								onChange={(event) => setReference(event.target.value)}
							/>
						</label>
					)}
					{financial && (
						<>
							<label>
								{t.description}
								<textarea
									className={control}
									aria-label={t.description}
									value={description}
									maxLength={500}
									onChange={(event) => setDescription(event.target.value)}
								/>
							</label>
							{mode !== "refund" && <p>{t.claimNote}</p>}
							<label>
								{t.evidence}
								<input
									className={isSeller ? salesControl : undefined}
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
										!["image/jpeg", "image/png", "image/webp"].includes(
											file.type,
										)
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
						<label>
							{t.reason}
							<textarea
								className={control}
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
						<button type="button" className={action} onClick={reload}>
							{t.reload}
						</button>
						<button className={action} type="submit">
							{modes.find(([value]) => value === mode)?.[1] ?? t.review}
						</button>
					</div>
				</fieldset>
			</form>
		</section>
	);
}
