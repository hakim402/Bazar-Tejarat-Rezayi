"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Input } from "../../../components/shadcn/input";
import { Textarea } from "../../../components/shadcn/textarea";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { buttonVariants } from "../../../components/shadcn/button";
import { Icon } from "../../../components/ui/icon";
import { cn } from "../../../lib/shadcn-utils";
import type { Locale } from "../../../lib/i18n/locales";
import { useCommerceGuard } from "../../orders/components/unsaved";
import {
	salesAction,
	salesControl,
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

const fieldLabels =
	"m-0 flex min-w-0 flex-col gap-4 border-0 p-0 text-sm [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:font-medium [&_label:has(input[type=checkbox])]:flex-row [&_label:has(input[type=checkbox])]:items-center [&_label:has(input[type=checkbox])]:gap-3";
const fieldFrame = cn(
	fieldLabels,
	"[&_p]:m-0 [&_p]:text-xs [&_p]:leading-relaxed [&_p]:text-muted",
);
const help = "m-0 text-xs leading-relaxed text-muted";
const notice = "m-0 rounded-lg px-3 py-2 text-sm";
const secondaryButton = cn(
	buttonVariants({ variant: "secondary", size: "sm" }),
	"h-auto min-h-8 whitespace-normal rounded-lg py-1.5",
);
const primaryButton = cn(
	buttonVariants({ size: "sm" }),
	"h-auto min-h-8 whitespace-normal rounded-lg py-1.5",
);
const quietButton = cn(
	buttonVariants({ variant: "ghost", size: "xs" }),
	"text-danger hover:bg-danger-surface hover:text-danger",
);

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
		isSeller = context === "seller",
		action = cn(salesAction, "min-h-10 rounded-lg text-sm shadow-none"),
		control = isSeller
			? cn(
					salesControl,
					"h-10 min-h-10 rounded-lg border-solid text-sm shadow-none",
				)
			: "h-8 text-sm",
		textareaControl = cn(
			control,
			"h-auto resize-y",
			isSeller ? "min-h-24" : "min-h-20",
		),
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
		<div className={cn("min-w-0 space-y-1.5", isSeller && "max-w-2xl")}>
			<label htmlFor={`${prefix}-mode`} className="block text-sm font-medium">
				{t.exact}
			</label>
			<NativeSelect
				id={`${prefix}-mode`}
				className={isSeller ? "h-10" : "h-8"}
				value={available ? mode : ""}
				disabled={locked || busy}
				onChange={(event) => {
					const next = event.target.value as Mode;
					guard.choose(() => discard(next));
				}}
			>
				{!available && (
					<NativeSelectOption value="" disabled>
						{t.exact}
					</NativeSelectOption>
				)}
				{modes.map(([value, label]) => (
					<NativeSelectOption key={value} value={value}>
						{label}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</div>
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
				className={isSeller ? fieldFrame : fieldLabels}
			>
				{mode === "recipient" && (
					<>
						<div
							className={isSeller ? "contents" : "grid gap-3 sm:grid-cols-2"}
						>
							<label htmlFor={`${prefix}-name`}>
								{t.recipientName}
								<Input
									id={`${prefix}-name`}
									className={control}
									value={name}
									maxLength={120}
									autoComplete="off"
									placeholder={t.recipientName}
									onChange={(event) => setName(event.target.value)}
								/>
							</label>
							<label htmlFor={`${prefix}-phone`}>
								{t.phone}
								<Input
									id={`${prefix}-phone`}
									className={control}
									dir="ltr"
									value={phone}
									maxLength={40}
									autoComplete="off"
									placeholder={t.phone}
									onChange={(event) => setPhone(event.target.value)}
								/>
							</label>
						</div>
						<label htmlFor={`${prefix}-address`}>{t.address}</label>
						<Textarea
							id={`${prefix}-address`}
							className={textareaControl}
							value={address}
							maxLength={1500}
							autoComplete="off"
							placeholder={t.address}
							onChange={(event) => setAddress(event.target.value)}
						/>
						<p className={help}>{t.unchangedDestination}</p>
					</>
				)}
				{mode === "arrange" && (
					<>
						<label htmlFor={`${prefix}-field-1`}>
							{t.provider}
							<Input
								id={`${prefix}-field-1`}
								className={control}
								value={provider}
								maxLength={160}
								placeholder={t.provider}
								onChange={(event) => setProvider(event.target.value)}
							/>
						</label>
						<label
							className="flex items-center gap-3"
							htmlFor={`${prefix}-field-2`}
						>
							<Input
								id={`${prefix}-field-2`}
								type="checkbox"
								className="size-4 shrink-0 rounded border-control p-0 accent-action shadow-none"
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
						<Textarea
							id={`${prefix}-field-3`}
							className={textareaControl}
							aria-label={t.instructions}
							value={instructions}
							maxLength={1000}
							placeholder={t.instructions}
							onChange={(event) => setInstructions(event.target.value)}
						/>
					</label>
				) : null}
				{mode === "prepare" && (
					<>
						{!guided ? (
							<>
								<p className={help}>{t.stockNote}</p>
								<ul className="m-0 list-none space-y-1 p-0 text-xs text-muted">
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
							<p className={help}>{t.stockNote}</p>
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
				{mode === "partial" && <p className={help}>{t.partialNote}</p>}
				{mode === "correction" && (
					<div className="space-y-1.5">
						<label htmlFor={`${prefix}-receipt`}>{t.receipts}</label>
						<NativeSelect
							id={`${prefix}-receipt`}
							className={isSeller ? "h-10" : "h-8"}
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
							<NativeSelectOption value="">—</NativeSelectOption>
							{row.receipts
								.filter((receipt) => receipt.can_correct)
								.map((receipt) => (
									<NativeSelectOption key={receipt.id} value={receipt.id}>
										{receipt.amount} {row.currency} · v{receipt.version} ·{" "}
										{receipt.id}
									</NativeSelectOption>
								))}
						</NativeSelect>
					</div>
				)}
				{mode === "withdraw" && (
					<div className="space-y-1.5">
						<label htmlFor={`${prefix}-claim`}>{t.claims}</label>
						<NativeSelect
							id={`${prefix}-claim`}
							className={isSeller ? "h-10" : "h-8"}
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
							<NativeSelectOption value="">—</NativeSelectOption>
							{row.claims
								.filter((claim) => claim.can_withdraw)
								.map((claim) => (
									<NativeSelectOption key={claim.id} value={claim.id}>
										{claim.amount} {claim.currency} · {claim.description}
									</NativeSelectOption>
								))}
						</NativeSelect>
					</div>
				)}
				{mode === "refund" && (
					<>
						<div className="space-y-1.5">
							<label htmlFor={`${prefix}-provider`}>{t.provider}</label>
							<NativeSelect
								id={`${prefix}-provider`}
								className={isSeller ? "h-10" : "h-8"}
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
								<NativeSelectOption value="">—</NativeSelectOption>
								{row.refund_providers.map((item) => (
									<NativeSelectOption key={item.id} value={item.id}>
										{item.name} · {item.id} · {r.limit}: {item.refundable}{" "}
										{row.currency}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
						{refundProvider && (
							<p className={help}>
								{r.limit}:{" "}
								<bdi>
									{refundProvider.refundable} {row.currency}
								</bdi>
							</p>
						)}
						<p className={help}>{r.deliveryNote}</p>
					</>
				)}
				{money && (
					<label htmlFor={`${prefix}-field-4`}>
						{t.amount} (<bdi>{row.currency}</bdi>)
						<Input
							id={`${prefix}-field-4`}
							className={control}
							dir="ltr"
							inputMode="decimal"
							value={amount}
							maxLength={25}
							placeholder={t.amount}
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
						<Input
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
						<Input
							id={`${prefix}-field-6`}
							className={control}
							value={reference}
							maxLength={160}
							placeholder={mode === "refund" ? r.reference : t.tracking}
							onChange={(event) => setReference(event.target.value)}
						/>
					</label>
				)}
				{financial && (
					<>
						<label htmlFor={`${prefix}-field-7`}>
							{t.description}
							<Textarea
								id={`${prefix}-field-7`}
								className={textareaControl}
								aria-label={t.description}
								value={description}
								maxLength={500}
								placeholder={t.description}
								onChange={(event) => setDescription(event.target.value)}
							/>
						</label>
						{mode !== "refund" && <p className={help}>{t.claimNote}</p>}
						<label htmlFor={`${prefix}-field-8`}>
							{t.evidence}
							<Input
								id={`${prefix}-field-8`}
								className="h-auto min-h-10 w-full rounded-lg border border-solid border-border p-2 text-sm file:me-3 file:rounded-md file:border-0 file:bg-info file:px-3 file:py-1.5 file:text-action"
								type="file"
								accept="image/jpeg,image/png,image/webp"
								disabled={images.length >= 3}
								onChange={(event) => setFile(event.target.files?.[0] ?? null)}
							/>
						</label>
						<p className={help}>{t.filesNote}</p>
						<button
							type="button"
							className={isSeller ? action : secondaryButton}
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
							{!isSeller && <Icon name="image" className="size-3.5" />}
							{t.uploads}
						</button>
						<div className="flex flex-wrap gap-3">
							{images.map((id) => (
								<div key={id}>
									<DeliveryEvidence {...{ id, context, locale }} />
									<button
										type="button"
										className={isSeller ? action : quietButton}
										onClick={() =>
											setImages((values) =>
												values.filter((value) => value !== id),
											)
										}
									>
										{!isSeller && <Icon name="close" className="size-3" />}
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
						<Textarea
							id={`${prefix}-field-9`}
							className={textareaControl}
							aria-label={t.reason}
							value={reason}
							minLength={3}
							maxLength={1000}
							placeholder={t.reason}
							onChange={(event) => setReason(event.target.value)}
						/>
					</label>
				)}
				{invalid && (
					<p
						role="alert"
						className={cn(notice, "bg-danger-surface font-medium text-danger")}
					>
						{t.error}
					</p>
				)}
				{previewError && (
					<p
						role="alert"
						className={cn(notice, "bg-danger-surface font-medium text-danger")}
					>
						{t.notReady}
					</p>
				)}
				{base.version !== row.version ||
				base.goods_version !== row.goods_version ? (
					<p
						role="status"
						className={cn(notice, "bg-warning-surface text-warning")}
					>
						{t.stale}
					</p>
				) : null}
				<div
					className={cn(
						"flex flex-wrap gap-3",
						!isSeller && "items-center justify-end gap-2 pt-1",
					)}
				>
					<button
						type="button"
						className={isSeller ? action : secondaryButton}
						onClick={reload}
						title={t.reload}
					>
						{!isSeller && <Icon name="history" className="size-3.5" />}
						{t.refresh}
					</button>
					<button
						className={
							isSeller
								? cn(
										action,
										"border-action bg-action text-white hover:bg-action/90 hover:text-white",
									)
								: primaryButton
						}
						type="submit"
					>
						{!isSeller && <Icon name="send" className="size-3.5" />}
						{modes.find(([value]) => value === mode)?.[1] ?? t.review}
					</button>
				</div>
			</fieldset>
		</form>
	);
	return (
		<div className="min-w-0 space-y-4" tabIndex={-1} data-fulfilment-actions>
			{guard.feedback}
			{!available && (
				<p
					role="status"
					className={cn(
						notice,
						"border border-warning bg-warning-surface text-warning",
					)}
				>
					{t.actionChanged}
				</p>
			)}
			{!guided && selector}
			{form}
		</div>
	);
}
