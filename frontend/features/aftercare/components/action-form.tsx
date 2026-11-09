"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import {
	action as defaultAction,
	control as defaultControl,
	panel as defaultPanel,
} from "../../orders/components/controls";
import { SellerSelect } from "../../../app/[locale]/(seller)/account/seller/components/seller-select";
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
	const [mode, setMode] = useState<Mode>(() => modes[0] ?? "cancel");
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
		const packet = buildAction(locale, mode === "dispute_open" ? { ...base, payment: data.payment } : base, mode, draft, crypto.randomUUID());
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
			? (data.order.disputes ?? []).filter((row) => mode === "dispute_withdraw" ? row.can_withdraw : row.can_respond === true).map((row) => ({ id: row.id, label: `${row.id} · ${row.reason}` }))
			: mode === "cancel_withdraw"
			? data.order.cancellations
					.filter((row) => row.can_withdraw)
					.map((row) => ({ id: row.id, label: `${row.id} · ${row.reason}` }))
			: mode === "amend_withdraw"
				? data.order.amendments
						.filter((row) => row.can_withdraw)
						.map((row) => ({
							id: row.id,
							label: `${row.id} · ${row.after_total} ${data.order.currency} · ${row.reason}`,
						}))
				: mode === "refund_withdraw"
					? (data.payment?.refund_reports ?? [])
							.filter((row) => row.can_withdraw)
							.map((row) => ({
								id: row.id,
								label: `${row.id} · ${row.amount} ${data.order.currency} · ${row.reference}`,
							}))
					: mode === "report"
						? (data.payment?.refund_dues ?? [])
								.filter((row) => row.can_report)
								.map((row) => ({
									id: row.id,
									label: `${aftercareState(locale, row.cause)} · ${row.amount} ${row.currency} · ${row.id}`,
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
			<p>{t.noActions}</p>
		);
	return (
		<section className={`${panel} space-y-4`}>
			<h2 className="text-xl font-bold" data-aftercare-actions tabIndex={-1}>
				{isSeller ? sales.actions : t.exact}
			</h2>
			{!available && <p role="status">{t.actionChanged}</p>}
			{isSeller ? (
				<fieldset disabled={locked} className="min-w-0 space-y-2">
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
				<label>
					{t.exact}
					<select
						className={control}
						value={available ? mode : ""}
						disabled={locked}
						onChange={(event) => {
							const next = event.target.value as Mode;
							choose(() => discard(next));
						}}
					>
						{!available && (
							<option value="" disabled>
								{t.exact}
							</option>
						)}
						{modes.map((value) => (
							<option key={value} value={value}>
								{modeLabel(locale, value)}
							</option>
						))}
					</select>
				</label>
			)}
			<form onSubmit={submit} className="space-y-4" noValidate>
				<fieldset disabled={locked || !available} className="space-y-4">
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
							<label>
								{mode === "delivery_refund" ? t.provider : t.target}
								<select
									className={control}
									value={draft.target}
									onChange={(event) => target(event.target.value)}
								>
									<option value="">—</option>
									{draft.target &&
										!targets.some((row) => row.id === draft.target) && (
											<option value={draft.target} disabled>
												{t.actionChanged}
											</option>
										)}
									{targets.map((row) => (
										<option key={row.id} value={row.id}>
											{row.label}
										</option>
									))}
								</select>
							</label>
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
						<p>{t.cancelNote}</p>
					)}
					{(mode === "excess" || financial) && (
						<>
							{bound && (
								<p>
									{t.limit}:{" "}
									<bdi>
										{bound} {data.order.currency}
									</bdi>
								</p>
							)}
							<label className={labelClass}>
								{t.amount} (<bdi>{data.order.currency}</bdi>)
								<input
									className={control}
									dir="ltr"
									inputMode="decimal"
									maxLength={25}
									value={draft.amount}
									readOnly={mode === "report"}
									onChange={(event) => patch({ amount: event.target.value })}
								/>
							</label>
						</>
					)}
					{mode === "report" && due?.previous && (
						<p className="break-words">
							{t.before}: <bdi>{due.previous}</bdi>
						</p>
					)}
					{mode.startsWith("dispute_") && <p>{t.disputeNote}</p>}
					{mode.startsWith("review_") && <p>{t.reviewNote}</p>}
					{mode === "review_submit" && (
						<label className={labelClass}>
							{t.reviewRating}
							<select className={control} value={draft.rating} onChange={(event) => patch({ rating: event.target.value })}>
								<option value="">—</option>
								{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}
							</select>
						</label>
					)}
					{mode === "review_submit" || mode === "dispute_respond" ? (
						<label className={labelClass}>
							{mode === "review_submit" ? t.reviewText : t.disputeResponse}
							<textarea className={control} dir="auto" maxLength={2000} rows={4} value={draft.text} onChange={(event) => patch({ text: event.target.value })} />
						</label>
					) : financial || mode === "dispute_open" ? (
						<>
							{financial ? <>
							<p>{mode === "report" ? t.refundNote : t.deliveryNote}</p>
							{isSeller ? (
								<div className="grid min-w-0 gap-4 sm:grid-cols-2">
									<label className={labelClass}>
										{t.sentAt}
										<input
											className={control}
											type="datetime-local"
											dir="ltr"
											step="1"
											value={draft.at}
											onChange={(event) => patch({ at: event.target.value })}
										/>
										<span className="text-sm text-muted">
											{t.inputTimezone}
										</span>
									</label>
									<label className={labelClass}>
										{t.reference}
										<input
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
								<>
									<label>
										{t.sentAt}
										<input
											className={control}
											type="datetime-local"
											dir="ltr"
											step="1"
											value={draft.at}
											onChange={(event) => patch({ at: event.target.value })}
										/>
										<span className="text-sm text-muted">
											{t.inputTimezone}
										</span>
									</label>
									<label>
										{t.reference}
										<input
											className={control}
											autoComplete="off"
											maxLength={160}
											value={draft.reference}
											onChange={(event) =>
												patch({ reference: event.target.value })
											}
										/>
									</label>
								</>
							)}
							<label className={labelClass}>
								{t.description}
								<textarea
									className={control}
									maxLength={500}
									rows={isSeller ? 4 : undefined}
									value={draft.description}
									onChange={(event) =>
										patch({ description: event.target.value })
									}
								/>
							</label>
							</> : <label className={labelClass}>{t.disputeReason}<textarea className={control} dir="auto" minLength={3} maxLength={1000} rows={4} value={draft.reason} onChange={(event) => patch({ reason: event.target.value })} /></label>}
							{canUpload && (
								<label className={labelClass}>
									{t.evidence}
									<input
										ref={fileInput}
										className={
											isSeller
												? `${control} file:me-3 file:rounded-lg file:border-0 file:bg-info file:px-3 file:py-1 file:text-action`
												: undefined
										}
										type="file"
										accept="image/jpeg,image/png,image/webp"
										disabled={draft.images.length >= 3}
										onChange={(event) => {
											setFile(event.target.files?.[0] ?? null);
											onDirty(true);
										}}
									/>
								</label>
							)}
							<p className="text-sm text-muted">{t.filesNote}</p>
							<button
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
							</button>
							{file && (
								<button
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
								</button>
							)}
							<div className="flex flex-wrap gap-3">
								{draft.images.map((id) => (
									<div key={id} className="space-y-2">
										{canUpload && (
											<AftercareEvidence {...{ id, locale, context, domain: evidenceDomain }} />
										)}
										<button
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
										</button>
									</div>
								))}
							</div>
						</>
					) : (
						<label className={labelClass}>
							{t.reason}
							<textarea
								className={control}
								dir="auto"
								minLength={3}
								maxLength={1000}
								rows={isSeller ? 4 : undefined}
								value={draft.reason}
								onChange={(event) => patch({ reason: event.target.value })}
							/>
						</label>
					)}
					{invalid && (
						<p role="alert" tabIndex={-1} ref={(node) => node?.focus()}>
							{t.invalid}
						</p>
					)}
					{stale && <p role="status">{t.stale}</p>}
					{rebased && <p role="status">{t.rebased}</p>}
					<div className="flex flex-wrap gap-3">
						<button
							type="button"
							className={action}
							onClick={() => {
								setBase(structuredClone(data));
								setRebased(true);
								setInvalid(false);
							}}
						>
							{t.reload}
						</button>
						<button className={action} type="submit" disabled={stale || !!file}>
							{t.exact}
						</button>
					</div>
				</fieldset>
			</form>
		</section>
	);
}
