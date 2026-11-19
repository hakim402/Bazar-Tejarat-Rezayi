"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/shadcn/button";
import { Input } from "../../../components/shadcn/input";
import { Label } from "../../../components/shadcn/label";
import { Textarea } from "../../../components/shadcn/textarea";
import { Icon, type IconName } from "../../../components/ui/icon";
import { cn } from "../../../lib/shadcn-utils";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import {
	action as defaultAction,
	control as defaultControl,
	panel as defaultPanel,
} from "../../orders/components/controls";
import { SellerSelect } from "../../../components/seller-select";
import {
	salesAction,
	salesControl,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { aftercareCopy, aftercareState } from "../copy";
import {
	availableModes,
	buildAction,
	emptyDraft,
	modeDomain,
	modeLabel,
	versionOf,
	type Draft,
} from "../draft";
import { validEvidence } from "../validation";
import type { Context, Domain, Mode, Reviewed, Workspace } from "../types";
import { DecreaseLines } from "./line-editor";
import { AftercareEvidence } from "./evidence";

const modeIcon: Partial<Record<Mode, IconName>> = {
	cancel: "return",
	cancel_withdraw: "return",
	amend: "sliders",
	amend_withdraw: "sliders",
	excess: "wallet",
	report: "receipt",
	refund_withdraw: "receipt",
	delivery_refund: "truck",
	dispute_open: "shield",
	dispute_withdraw: "shield",
	dispute_respond: "shield",
	review_submit: "star",
	review_withdraw: "star",
};

function BuyerField({
	label,
	htmlFor,
	help,
	children,
}: {
	label: ReactNode;
	htmlFor?: string;
	help?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
			{htmlFor ? (
				<label htmlFor={htmlFor} className="m-0">
					{label}
				</label>
			) : (
				<span>{label}</span>
			)}
			{children}
			{help && <span className="text-xs font-normal text-muted">{help}</span>}
		</div>
	);
}

export function AftercareActionForm({
	locale,
	context,
	data,
	locked,
	uploaded,
	review,
	upload,
	onDirty,
	onDomain,
	choose,
	initialMode,
}: {
	locale: Locale;
	context: Context;
	data: Workspace;
	locked: boolean;
	uploaded: { id: string; domain: Domain } | null;
	review: (packet: Reviewed, opener: HTMLElement | null) => void;
	upload: (file: File, domain: Domain) => void;
	onDirty: (dirty: boolean) => void;
	onDomain: (domain: Domain) => void;
	choose: (next: () => void) => void;
	initialMode?: Mode;
}) {
	const t = aftercareCopy[locale],
		sales = sellerSalesCopy[locale],
		modes = availableModes(data);
	const isSeller = context === "seller",
		action = isSeller ? salesAction : defaultAction,
		control = isSeller ? salesControl : defaultControl,
		panel = isSeller ? salesPanel : defaultPanel;
	const labelClass = isSeller
		? "block min-w-0 space-y-2 text-sm font-medium"
		: undefined;
	const uid = useId();
	const [mode, setMode] = useState<Mode>(
		() =>
			(initialMode && modes.includes(initialMode) ? initialMode : modes[0]) ??
			"cancel",
	);
	const [draft, setDraft] = useState<Draft>(emptyDraft);
	const [base, setBase] = useState(() => structuredClone(data));
	const [invalid, setInvalid] = useState(false);
	const [rebased, setRebased] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const fileInput = useRef<HTMLInputElement>(null),
		seenUpload = useRef<string | null>(null);
	const available = modes.includes(mode),
		domain = modeDomain(mode);
	const financial = mode === "report" || mode === "delivery_refund";
	const evidenceDomain = mode === "dispute_open" ? "payments" : domain;
	const canUpload =
		evidenceDomain === "payments"
			? !!data.payment?.capabilities.evidence
			: domain === "fulfilment" && !!data.delivery?.capabilities.refund;
	const stale =
		versionOf(base, mode) !== versionOf(data, mode) ||
		(domain === "fulfilment" &&
			base.delivery?.goods_version !== data.delivery?.goods_version);
	useLayoutEffect(() => {
		onDomain(domain);
	}, [domain, onDomain]);
	useEffect(() => {
		if (
			!uploaded ||
			uploaded.id === seenUpload.current ||
			uploaded.domain !== evidenceDomain
		)
			return;
		seenUpload.current = uploaded.id;
		setDraft((old) => ({
			...old,
			images: [...new Set([...old.images, uploaded.id])].slice(0, 3),
		}));
		setFile(null);
		if (fileInput.current) fileInput.current.value = "";
		onDirty(true);
	}, [uploaded, evidenceDomain, onDirty]);
	function patch(value: Partial<Draft>) {
		setDraft((old) => ({ ...old, ...value }));
		setInvalid(false);
		onDirty(true);
	}
	function discard(next: Mode) {
		setMode(next);
		setDraft(emptyDraft());
		setBase(structuredClone(data));
		setFile(null);
		setInvalid(false);
		setRebased(false);
		onDirty(false);
		if (fileInput.current) fileInput.current.value = "";
	}
	function target(next: string) {
		choose(() => {
			const due = data.payment?.refund_dues.find((row) => row.id === next);
			setDraft({
				...emptyDraft(),
				target: next,
				amount: mode === "report" ? (due?.amount ?? "") : "",
			});
			setBase(structuredClone(data));
			setFile(null);
			setInvalid(false);
			onDirty(true);
			if (fileInput.current) fileInput.current.value = "";
		});
	}
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (locked || !available || stale) return;
		const packet = buildAction(
			locale,
			mode === "dispute_open" ? { ...base, payment: data.payment } : base,
			mode,
			draft,
			crypto.randomUUID(),
		);
		if (!packet || file) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		review(
			packet,
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null,
		);
	}
	const targets =
		mode === "dispute_withdraw" || mode === "dispute_respond"
			? (data.order.disputes ?? [])
					.filter((row) =>
						mode === "dispute_withdraw"
							? row.can_withdraw
							: row.can_respond === true,
					)
					.map((row) => ({
						id: row.id,
						label: isSeller
							? `${row.id} · ${row.reason}`
							: `${aftercareState(locale, row.state)} · ${row.reason}`,
					}))
			: mode === "cancel_withdraw"
				? data.order.cancellations
						.filter((row) => row.can_withdraw)
						.map((row) => ({
							id: row.id,
							label: isSeller ? `${row.id} · ${row.reason}` : row.reason,
						}))
				: mode === "amend_withdraw"
					? data.order.amendments
							.filter((row) => row.can_withdraw)
							.map((row) => ({
								id: row.id,
								label: isSeller
									? `${row.id} · ${row.after_total} ${data.order.currency} · ${row.reason}`
									: `${row.after_total} ${data.order.currency} · ${row.reason}`,
							}))
					: mode === "refund_withdraw"
						? (data.payment?.refund_reports ?? [])
								.filter((row) => row.can_withdraw)
								.map((row) => ({
									id: row.id,
									label: isSeller
										? `${row.id} · ${row.amount} ${data.order.currency} · ${row.reference}`
										: `${row.amount} ${data.order.currency} · ${row.reference}`,
								}))
						: mode === "report"
							? (data.payment?.refund_dues ?? [])
									.filter((row) => row.can_report)
									.map((row) => ({
										id: row.id,
										label: isSeller
											? `${aftercareState(locale, row.cause)} · ${row.amount} ${row.currency} · ${row.id}`
											: `${aftercareState(locale, row.cause)} · ${row.amount} ${row.currency}`,
									}))
							: mode === "delivery_refund"
								? (data.delivery?.refund_providers ?? []).map((row) => ({
										id: row.id,
										label: `${row.name} · ${row.refundable} ${data.order.currency}`,
									}))
								: null;
	const due = data.payment?.refund_dues.find((row) => row.id === draft.target);
	const bound =
		mode === "excess"
			? data.payment?.refundable_excess
			: mode === "delivery_refund"
				? data.delivery?.refund_providers.find((row) => row.id === draft.target)
						?.refundable
				: due?.amount;
	if (
		!modes.length &&
		!available &&
		!draft.rating &&
		!draft.text &&
		!draft.reason &&
		!draft.target &&
		!draft.amount &&
		!draft.at &&
		!draft.reference &&
		!draft.description &&
		!draft.lines.length &&
		!draft.images.length &&
		!file
	)
		return isSeller ? (
			<section className={panel}>
				<h2 className="text-xl font-bold">{sales.actions}</h2>
				<p className="text-sm text-muted">{t.noActions}</p>
			</section>
		) : (
			<p className="m-0 text-sm text-muted">{t.noActions}</p>
		);
	const groups: [string, Mode[]][] = [
		[t.groupCancel, ["cancel", "cancel_withdraw"]],
		[t.groupChange, ["amend", "amend_withdraw"]],
		[t.groupRefund, ["excess", "report", "refund_withdraw", "delivery_refund"]],
		[t.groupDispute, ["dispute_open", "dispute_withdraw", "dispute_respond"]],
		[t.groupReview, ["review_submit", "review_withdraw"]],
	];
	return (
		<section
			className={
				isSeller ? `${panel} space-y-4` : "flex min-w-0 flex-col gap-4"
			}
		>
			<h2
				className={
					isSeller ? "text-xl font-bold" : "m-0 text-base font-semibold"
				}
				data-aftercare-actions
				tabIndex={-1}
			>
				{isSeller ? sales.actions : t.chooseAction}
			</h2>
			{!isSeller && (
				<p className="m-0 rounded-xl bg-info px-4 py-3 text-sm leading-relaxed text-action">
					{t.helpIntro}
				</p>
			)}
			{!available && (
				<p role="status" className="m-0 text-sm text-warning">
					{t.actionChanged}
				</p>
			)}
			{isSeller ? (
				<fieldset disabled={locked} className="m-0 min-w-0 space-y-2 border-0 p-0">
					<legend className="mb-2 text-sm font-medium">{t.exact}</legend>
					<SellerSelect
						label={sales.actions}
						value={available ? mode : ""}
						options={modes.map((value) => ({
							value,
							label: modeLabel(locale, value),
						}))}
						onChange={(value) => {
							if (!locked && modes.includes(value as Mode))
								choose(() => discard(value as Mode));
						}}
					/>
				</fieldset>
			) : (
				<div className="flex min-w-0 flex-col gap-3">
					{groups.map(([label, groupModes]) => {
						const inGroup = groupModes.filter((value) => modes.includes(value));
						if (!inGroup.length) return null;
						return (
							<fieldset
								key={label}
								disabled={locked}
								className="m-0 min-w-0 border-0 p-0"
							>
								<legend className="mb-1.5 p-0 text-xs font-medium text-muted">
									{label}
								</legend>
								<div className="grid gap-2 sm:grid-cols-2">
									{inGroup.map((value) => {
										const active = available && mode === value;
										return (
											<Button
												key={value}
												type="button"
												variant="outline"
												aria-pressed={active}
												onClick={() => choose(() => discard(value))}
												className={cn(
													"h-auto justify-start gap-3 rounded-xl px-3 py-2.5",
													active &&
														"border-action bg-info text-action hover:bg-info",
												)}
											>
												<span
													className={cn(
														"flex size-8 shrink-0 items-center justify-center rounded-lg",
														active
															? "bg-surface text-action"
															: "bg-info text-action",
													)}
												>
													<Icon
														name={modeIcon[value] ?? "help"}
														className="size-4"
													/>
												</span>
												<span className="min-w-0 flex-1 truncate text-start text-sm font-medium">
													{modeLabel(locale, value)}
												</span>
												{active && (
													<Icon name="check" className="size-4 shrink-0" />
												)}
											</Button>
										);
									})}
								</div>
							</fieldset>
						);
					})}
				</div>
			)}
			<form
				aria-label={isSeller ? t.exact : t.helpTitle}
				onSubmit={submit}
				className={isSeller ? "space-y-4" : "flex min-w-0 flex-col gap-4"}
				noValidate
			>
				<fieldset
					disabled={locked || !available}
					className={
						isSeller
							? "m-0 min-w-0 space-y-4 border-0 p-0"
							: "m-0 flex min-w-0 flex-col gap-4 rounded-xl border border-solid border-border bg-page p-4"
					}
				>
					{targets &&
						(isSeller ? (
							<div className="min-w-0 space-y-2">
								<p className="text-sm font-medium">
									{mode === "delivery_refund" ? t.provider : t.target}
								</p>
								<SellerSelect
									label={mode === "delivery_refund" ? t.provider : t.target}
									value={draft.target}
									options={[
										{ value: "", label: "—" },
										...targets.map((row) => ({
											value: row.id,
											label: row.label,
										})),
									]}
									onChange={(value) => {
										if (!locked && available) target(value);
									}}
								/>
								{draft.target &&
									!targets.some((row) => row.id === draft.target) && (
										<p role="status" className="text-sm text-muted">
											{t.actionChanged} · <bdi>{draft.target}</bdi>
										</p>
									)}
							</div>
						) : (
							<BuyerField
								label={mode === "delivery_refund" ? t.provider : t.target}
								htmlFor={`${uid}-target`}
							>
								<NativeSelect
									id={`${uid}-target`}
									value={draft.target}
									onChange={(event) => target(event.target.value)}
								>
									<NativeSelectOption value="">—</NativeSelectOption>
									{draft.target &&
										!targets.some((row) => row.id === draft.target) && (
											<NativeSelectOption value={draft.target} disabled>
												{t.actionChanged}
											</NativeSelectOption>
										)}
									{targets.map((row) => (
										<NativeSelectOption key={row.id} value={row.id}>
											{row.label}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</BuyerField>
						))}
					{mode === "amend" && (
						<DecreaseLines
							{...{
								locale,
								currency: data.order.currency,
								current: base.order.effective_lines,
								selected: draft.lines,
								choose,
								seller: isSeller,
							}}
							change={(lines) => patch({ lines })}
						/>
					)}
					{(mode === "cancel" || mode === "cancel_withdraw") && (
						<p className={isSeller ? undefined : "m-0 text-sm text-muted"}>
							{t.cancelNote}
						</p>
					)}
					{(mode === "excess" || financial) && (
						<>
							{bound && (
								<p className={isSeller ? undefined : "m-0 text-sm text-muted"}>
									{t.limit}:{" "}
									<bdi>
										{bound} {data.order.currency}
									</bdi>
								</p>
							)}
							{isSeller ? (
								<label className={labelClass}>
									{t.amount} (<bdi>{data.order.currency}</bdi>)
									<Input
										className={control}
										dir="ltr"
										inputMode="decimal"
										maxLength={25}
										value={draft.amount}
										readOnly={mode === "report"}
										onChange={(event) => patch({ amount: event.target.value })}
									/>
								</label>
							) : (
								<BuyerField
									label={
										<>
											{t.amount} (<bdi>{data.order.currency}</bdi>)
										</>
									}
									htmlFor={`${uid}-amount`}
								>
									<Input
										id={`${uid}-amount`}
										dir="ltr"
										inputMode="decimal"
										maxLength={25}
										value={draft.amount}
										readOnly={mode === "report"}
										onChange={(event) => patch({ amount: event.target.value })}
										className="rounded-lg"
									/>
								</BuyerField>
							)}
						</>
					)}
					{mode === "report" && due?.previous && (
						<p
							className={
								isSeller ? "break-words" : "m-0 break-words text-sm text-muted"
							}
						>
							{t.before}: <bdi>{due.previous}</bdi>
						</p>
					)}
					{mode.startsWith("dispute_") && (
						<p className={isSeller ? undefined : "m-0 text-sm text-muted"}>
							{t.disputeNote}
						</p>
					)}
					{mode.startsWith("review_") && (
						<p className={isSeller ? undefined : "m-0 text-sm text-muted"}>
							{t.reviewNote}
						</p>
					)}
					{mode === "review_submit" &&
						(isSeller ? (
							<div className={labelClass}>
								<Label htmlFor={`${uid}-rating`}>{t.reviewRating}</Label>
								<NativeSelect
									id={`${uid}-rating`}
									className={control}
									value={draft.rating}
									onChange={(event) => patch({ rating: event.target.value })}
								>
									<NativeSelectOption value="">—</NativeSelectOption>
									{[1, 2, 3, 4, 5].map((value) => (
										<NativeSelectOption key={value} value={value}>
											{value}/5
										</NativeSelectOption>
									))}
								</NativeSelect>
							</div>
						) : (
							<BuyerField label={t.reviewRating} htmlFor={`${uid}-rating`}>
								<NativeSelect
									id={`${uid}-rating`}
									aria-label={t.reviewRating}
									value={draft.rating}
									onChange={(event) => patch({ rating: event.target.value })}
								>
									<NativeSelectOption value="">—</NativeSelectOption>
									{[1, 2, 3, 4, 5].map((value) => (
										<NativeSelectOption key={value} value={value}>
											{value}/5
										</NativeSelectOption>
									))}
								</NativeSelect>
							</BuyerField>
						))}
					{mode === "review_submit" || mode === "dispute_respond" ? (
						isSeller ? (
							<label className={labelClass}>
								{mode === "review_submit" ? t.reviewText : t.disputeResponse}
								<Textarea
									className={control}
									dir="auto"
									maxLength={2000}
									rows={4}
									value={draft.text}
									onChange={(event) => patch({ text: event.target.value })}
								/>
							</label>
						) : (
							<BuyerField
								label={
									mode === "review_submit" ? t.reviewText : t.disputeResponse
								}
								htmlFor={`${uid}-text`}
							>
								<Textarea
									id={`${uid}-text`}
									dir="auto"
									maxLength={2000}
									rows={4}
									value={draft.text}
									onChange={(event) => patch({ text: event.target.value })}
									className="rounded-lg"
								/>
							</BuyerField>
						)
					) : financial || mode === "dispute_open" ? (
						<>
							{financial ? (
								<>
									<p
										className={isSeller ? undefined : "m-0 text-sm text-muted"}
									>
										{mode === "report" ? t.refundNote : t.deliveryNote}
									</p>
									{isSeller ? (
										<div className="grid min-w-0 gap-4 sm:grid-cols-2">
											<label className={labelClass}>
												{t.sentAt}
												<Input
													className={control}
													type="datetime-local"
													dir="ltr"
													step="1"
													value={draft.at}
													onChange={(event) =>
														patch({ at: event.target.value })
													}
												/>
												<span className="text-sm text-muted">
													{t.inputTimezone}
												</span>
											</label>
											<label className={labelClass}>
												{t.reference}
												<Input
													className={control}
													autoComplete="off"
													maxLength={160}
													value={draft.reference}
													onChange={(event) =>
														patch({ reference: event.target.value })
													}
												/>
											</label>
										</div>
									) : (
										<div className="grid min-w-0 gap-4 sm:grid-cols-2">
											<BuyerField
												label={t.sentAt}
												htmlFor={`${uid}-at`}
												help={t.inputTimezone}
											>
												<Input
													id={`${uid}-at`}
													type="datetime-local"
													dir="ltr"
													step="1"
													value={draft.at}
													onChange={(event) =>
														patch({ at: event.target.value })
													}
													className="rounded-lg"
												/>
											</BuyerField>
											<BuyerField
												label={t.reference}
												htmlFor={`${uid}-reference`}
											>
												<Input
													id={`${uid}-reference`}
													autoComplete="off"
													maxLength={160}
													value={draft.reference}
													onChange={(event) =>
														patch({ reference: event.target.value })
													}
													className="rounded-lg"
												/>
											</BuyerField>
										</div>
									)}
									{isSeller ? (
										<label className={labelClass}>
											{t.description}
											<Textarea
												className={control}
												maxLength={500}
												rows={4}
												dir="auto"
												value={draft.description}
												onChange={(event) =>
													patch({ description: event.target.value })
												}
											/>
										</label>
									) : (
										<BuyerField
											label={t.description}
											htmlFor={`${uid}-description`}
										>
											<Textarea
												id={`${uid}-description`}
												maxLength={500}
												rows={3}
												dir="auto"
												value={draft.description}
												onChange={(event) =>
													patch({ description: event.target.value })
												}
												className="rounded-lg"
											/>
										</BuyerField>
									)}
								</>
							) : isSeller ? (
								<label className={labelClass}>
									{t.disputeReason}
									<Textarea
										className={control}
										dir="auto"
										minLength={3}
										maxLength={1000}
										rows={4}
										value={draft.reason}
										onChange={(event) => patch({ reason: event.target.value })}
									/>
								</label>
							) : (
								<BuyerField label={t.disputeReason} htmlFor={`${uid}-reason`}>
									<Textarea
										id={`${uid}-reason`}
										dir="auto"
										minLength={3}
										maxLength={1000}
										rows={4}
										value={draft.reason}
										onChange={(event) => patch({ reason: event.target.value })}
										className="rounded-lg"
									/>
								</BuyerField>
							)}
							{canUpload &&
								(isSeller ? (
									<label className={labelClass}>
										{t.evidence}
										<Input
											ref={fileInput}
											className={`${control} file:me-3 file:rounded-lg file:border-0 file:bg-info file:px-3 file:py-1 file:text-action`}
											type="file"
											accept="image/jpeg,image/png,image/webp"
											disabled={draft.images.length >= 3}
											onChange={(event) => {
												setFile(event.target.files?.[0] ?? null);
												onDirty(true);
											}}
										/>
									</label>
								) : (
									<BuyerField
										label={t.evidence}
										htmlFor={`${uid}-file`}
										help={t.filesNote}
									>
										<Input
											ref={fileInput}
											id={`${uid}-file`}
											type="file"
											accept="image/jpeg,image/png,image/webp"
											disabled={draft.images.length >= 3}
											onChange={(event) => {
												setFile(event.target.files?.[0] ?? null);
												onDirty(true);
											}}
											className="rounded-lg file:me-3 file:rounded-md file:border-0 file:bg-info file:px-3 file:py-1 file:text-action"
										/>
									</BuyerField>
								))}
							{isSeller && <p className="text-sm text-muted">{t.filesNote}</p>}
							{isSeller ? (
								<Button
									type="button"
									className={action}
									disabled={
										!file || !canUpload || draft.images.length >= 3 || stale
									}
									onClick={() => {
										if (!file || !validEvidence(file, draft.images.length)) {
											setInvalid(true);
											return;
										}
										upload(file, evidenceDomain);
									}}
								>
									{t.uploads}
								</Button>
							) : (
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="rounded-lg"
										disabled={
											!file || !canUpload || draft.images.length >= 3 || stale
										}
										onClick={() => {
											if (!file || !validEvidence(file, draft.images.length)) {
												setInvalid(true);
												return;
											}
											upload(file, evidenceDomain);
										}}
									>
										{t.uploads}
									</Button>
									{file && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="rounded-lg"
											onClick={() =>
												choose(() => {
													setFile(null);
													if (fileInput.current) fileInput.current.value = "";
												})
											}
										>
											{t.removeImage}
										</Button>
									)}
								</div>
							)}
							{isSeller && file && (
								<Button
									type="button"
									className={action}
									onClick={() =>
										choose(() => {
											setFile(null);
											if (fileInput.current) fileInput.current.value = "";
										})
									}
								>
									{t.removeImage}
								</Button>
							)}
							<div className="flex flex-wrap gap-3">
								{draft.images.map((id) => (
									<div
										key={id}
										className={isSeller ? "space-y-2" : "flex flex-col gap-2"}
									>
										{canUpload && (
											<AftercareEvidence
												{...{ id, locale, context, domain: evidenceDomain }}
											/>
										)}
										{isSeller ? (
											<Button
												type="button"
												className={action}
												onClick={() =>
													choose(() =>
														patch({
															images: draft.images.filter(
																(value) => value !== id,
															),
														}),
													)
												}
											>
												{t.removeImage}
											</Button>
										) : (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="self-start rounded-lg"
												onClick={() =>
													choose(() =>
														patch({
															images: draft.images.filter(
																(value) => value !== id,
															),
														}),
													)
												}
											>
												{t.removeImage}
											</Button>
										)}
									</div>
								))}
							</div>
						</>
					) : isSeller ? (
						<label className={labelClass}>
							{t.reason}
							<Textarea
								className={control}
								dir="auto"
								minLength={3}
								maxLength={1000}
								rows={4}
								value={draft.reason}
								onChange={(event) => patch({ reason: event.target.value })}
							/>
						</label>
					) : (
						<BuyerField label={t.reason} htmlFor={`${uid}-reason`}>
							<Textarea
								id={`${uid}-reason`}
								dir="auto"
								minLength={3}
								maxLength={1000}
								rows={3}
								value={draft.reason}
								onChange={(event) => patch({ reason: event.target.value })}
								className="rounded-lg"
							/>
						</BuyerField>
					)}
					{invalid && (
						<p
							role="alert"
							tabIndex={-1}
							ref={(node) => node?.focus()}
							className={isSeller ? undefined : "m-0 text-sm text-danger"}
						>
							{t.invalid}
						</p>
					)}
					{stale && (
						<p
							role="status"
							className={isSeller ? undefined : "m-0 text-sm text-warning"}
						>
							{t.stale}
						</p>
					)}
					{rebased && (
						<p
							role="status"
							className={isSeller ? undefined : "m-0 text-sm text-muted"}
						>
							{t.rebased}
						</p>
					)}
					<div
						className={
							isSeller
								? "flex flex-wrap gap-3"
								: "flex flex-wrap items-center gap-3 border-0 border-t border-solid border-border pt-4"
						}
					>
						{isSeller ? (
							<>
								<Button
									type="button"
									className={action}
									onClick={() => {
										setBase(structuredClone(data));
										setRebased(true);
										setInvalid(false);
									}}
								>
									{t.reload}
								</Button>
								<Button
									className={action}
									type="submit"
									disabled={stale || !!file}
								>
									{t.exact}
								</Button>
							</>
						) : (
							<>
								<Button
									type="submit"
									className="rounded-lg"
									disabled={stale || !!file}
								>
									{t.reviewRequest}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="rounded-lg"
									onClick={() => {
										setBase(structuredClone(data));
										setRebased(true);
										setInvalid(false);
									}}
								>
									{t.reload}
								</Button>
							</>
						)}
					</div>
				</fieldset>
			</form>
		</section>
	);
}
