"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect, useRef } from "react";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import {
	Field,
	Input,
	Select,
	CheckField,
} from "../../../../../../../components/ui/form-field";
import { Button } from "../../../../../../../components/ui/button";
import { Alert } from "../../../../../../../components/ui/alert";
import { useUnsavedNavigation } from "../../../../../../../components/layout/navigation-guard";
import { AccountError } from "../../../../../../../lib/api/private-client";
import {
	inventoryRequest,
	type StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { sellerHref } from "../../../../../../../lib/routes/account-routes";
import { StockModal, panel, linkClass } from "./stock-parts";
export function InventoryForm({
	locale,
	seller,
	position,
	mode,
	reload,
	revoked,
}: {
	locale: Locale;
	seller: string;
	position: StockPosition;
	mode: "settings" | "receipt" | "adjustment";
	reload: () => Promise<StockPosition>;
	revoked: () => void;
}) {
	const t = inventoryCopy[locale],
		returnParams = useSearchParams();
	const [snapshot, setSnapshot] = useState(position),
		[tracking, setTracking] = useState(position.tracking ?? "plain"),
		[required, setRequired] = useState(position.expiry_required),
		[threshold, setThreshold] = useState(position.threshold ?? ""),
		[quantity, setQuantity] = useState(""),
		[reason, setReason] = useState(""),
		[reference, setReference] = useState(""),
		[batch, setBatch] = useState(""),
		[code, setCode] = useState(""),
		[expiry, setExpiry] = useState(""),
		[dirty, setDirty] = useState(false),
		[busy, setBusy] = useState(false),
		[review, setReview] = useState(false),
		[error, setError] = useState(""),
		[stale, setStale] = useState(false),
		[token, setToken] = useState(() => crypto.randomUUID()),
		[leave, setLeave] = useState<(() => void) | null>(null),
		[saved, setSaved] = useState(false);
	const errorFocus = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (error) errorFocus.current?.focus();
	}, [error]);
	const guard = useCallback((action: () => void) => setLeave(() => action), []);
	useUnsavedNavigation(dirty, guard);
	const locked = !!position.movements?.length,
		unit = position.unit_labels[locale] ?? position.unit;
	const selected = snapshot.batches?.find((b) => b.id === batch);
	const before =
		snapshot.tracking === "batch"
			? (selected?.physical ?? "0.000")
			: snapshot.physical;
	// Exact integer thousandths are used only for the preview; the server validates all stock arithmetic.
	function preview() {
		if (!/^-?\d{1,9}(?:\.\d{1,3})?$/.test(quantity)) return t.unknown;
		const amount = (x: string) => {
			const [a, b = ""] = x.replace("-", "").split(".");
			return BigInt(a) * BigInt(1000) + BigInt(b.padEnd(3, "0"));
		};
		const base = amount(before),
			delta =
				amount(quantity) * (quantity.startsWith("-") ? -BigInt(1) : BigInt(1)),
			next = base + delta;
		return `${next < BigInt(0) ? "-" : ""}${(next < BigInt(0) ? -next : next) / BigInt(1000)}.${String((next < BigInt(0) ? -next : next) % BigInt(1000)).padStart(3, "0")}`;
	}
	async function submit() {
		setBusy(true);
		setError("");
		const data =
			mode === "settings"
				? {
						token,
						version: snapshot.version,
						reason,
						tracking,
						expiry_required: tracking === "batch" && required,
						threshold: threshold || null,
					}
				: {
						token,
						version: snapshot.version,
						reason,
						reference,
						quantity,
						...(snapshot.tracking === "batch"
							? batch
								? { batch }
								: { batch_code: code, expires_on: expiry || null }
							: {}),
					};
		try {
			await inventoryRequest(
				`seller/variants/${position.id}/${mode === "settings" ? "settings" : mode === "receipt" ? "receipts" : "adjustments"}/?seller=${seller}`,
				data,
			);
			setDirty(false);
			setSaved(true);
			setReview(false);
			await reload();
		} catch (e) {
			setReview(false);
			if (
				e instanceof AccountError &&
				[401, 403, 404].includes(e.status ?? 0)
			) {
				revoked();
				return;
			}
			if (e instanceof AccountError && e.status === 409) {
				setStale(true);
				setError(t.stale);
			} else {
				const fields = e instanceof AccountError ? e.fields : [];
				const labels: Record<string, string> = {
					quantity: t.quantityError,
					reason: t.reason,
					batch: t.batchError,
					batch_code: t.batchCode,
					expires_on: t.batchError,
					threshold: t.threshold,
					tracking: t.tracking,
				};
				setError(
					fields.length
						? fields.map((f) => labels[f] ?? t.review).join(" · ") +
								" — " +
								t.precision
						: t.unavailable,
				);
			}
		} finally {
			setBusy(false);
		}
	}
	if (saved)
		return (
			<section className={panel}>
				<Alert variant="success" role="status">
					{t.saved}
				</Alert>
				<Link
					className={linkClass}
					href={sellerHref(
						locale,
						`inventory/${position.id}`,
						seller,
						returnParams,
					)}
				>
					{t.back}
				</Link>
			</section>
		);
	return (
		<section className={panel}>
			<Link
				href={sellerHref(
					locale,
					`inventory/${position.id}`,
					seller,
					returnParams,
				)}
			>
				{t.back}
			</Link>
			<h1 className="mt-5 text-2xl font-bold">{t[mode]}</h1>
			<p className="mt-2 wrap-anywhere">
				{position.title} · <bdi>{position.sku}</bdi>
			</p>
			<p className="mt-2 text-sm text-muted">
				{t.unit}: {unit} · <bdi>{position.increment}</bdi>
			</p>
			{error && (
				<Alert ref={errorFocus} tabIndex={-1} role="alert">
					{error}
				</Alert>
			)}
			{stale && (
				<Button
					variant="secondary"
					onClick={async () => {
						try {
							const latest = await reload();
							setSnapshot(latest);
							if (latest.movements?.length) {
								setTracking(latest.tracking ?? "plain");
								setRequired(latest.expiry_required);
							}
							setStale(false);
							setError("");
							setToken(crypto.randomUUID());
						} catch {
							setError(t.unavailable);
						}
					}}
				>
					{t.reload}
				</Button>
			)}
			<form
				onChange={() => {
					setDirty(true);
					setSaved(false);
				}}
				onSubmit={(e) => {
					e.preventDefault();
					setReview(true);
				}}
				className="mt-5 max-w-3xl space-y-4"
			>
				{mode === "settings" ? (
					<>
						<Alert variant="info">{locked ? t.locked : t.policy}</Alert>
						<Field name="tracking" label={t.tracking}>
							<Select
								name="tracking"
								value={tracking}
								disabled={locked}
								onChange={(e) => setTracking(e.target.value)}
							>
								<option value="plain">{t.plain}</option>
								<option value="batch">{t.batchMode}</option>
							</Select>
						</Field>
						{tracking === "batch" && (
							<CheckField
								name="expiry_required"
								label={t.expiryRequired}
								checked={required}
								disabled={locked}
								onChange={(e) => setRequired(e.target.checked)}
							/>
						)}
						<Field name="threshold" label={`${t.threshold} · ${unit}`}>
							<Input
								name="threshold"
								dir="ltr"
								inputMode="decimal"
								value={threshold}
								onChange={(e) => setThreshold(e.target.value)}
								maxLength={20}
							/>
						</Field>
					</>
				) : (
					<>
						<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
							{[
								[t.physical, snapshot.physical],
								[t.held, snapshot.held],
								[t.available, snapshot.available ?? t.unknown],
							].map(([label, value]) => (
								<div key={label} className="rounded-control bg-page p-4">
									<p className="text-sm text-muted">{label}</p>
									<bdi className="mt-2 block text-xl font-bold">{value}</bdi>
								</div>
							))}
						</div>
						{snapshot.tracking === "batch" && (
							<>
								<Field name="batch" label={t.chooseBatch}>
									<Select
										name="batch"
										value={batch}
										required={mode === "adjustment"}
										onChange={(e) => setBatch(e.target.value)}
									>
										<option value="">
											{mode === "receipt" ? t.newBatch : t.chooseBatch}
										</option>
										{snapshot.batches?.map((b) => (
											<option
												key={b.id}
												value={b.id}
												disabled={mode === "receipt" && b.expired}
											>
												{b.code} · {b.physical} {unit}
												{b.expired ? ` · ${t.expired}` : ""}
											</option>
										))}
									</Select>
								</Field>
								{!batch && mode === "receipt" && (
									<div className="grid gap-4 sm:grid-cols-2">
										<Field name="batch_code" label={t.batchCode}>
											<Input
												name="batch_code"
												required
												maxLength={80}
												value={code}
												onChange={(e) => setCode(e.target.value)}
											/>
										</Field>
										<Field name="expires_on" label={t.expires}>
											<Input
												name="expires_on"
												type="date"
												dir="ltr"
												required={snapshot.expiry_required}
												value={expiry}
												onChange={(e) => setExpiry(e.target.value)}
											/>
										</Field>
									</div>
								)}
							</>
						)}
						<Field name="quantity" label={`${t.quantity} · ${unit}`}>
							<Input
								name="quantity"
								dir="ltr"
								inputMode="decimal"
								required
								maxLength={20}
								value={quantity}
								onChange={(e) => setQuantity(e.target.value)}
							/>
						</Field>
						<p className="text-sm text-muted">
							{t.precision} <bdi>{position.increment}</bdi>
							{mode === "adjustment" && (
								<span className="mt-2 block">{t.adjustmentHint}</span>
							)}
						</p>
						<Field name="reference" label={t.reference}>
							<Input
								name="reference"
								maxLength={120}
								value={reference}
								onChange={(e) => setReference(e.target.value)}
							/>
						</Field>
					</>
				)}
				<Field name="reason" label={t.reason}>
					<Input
						name="reason"
						required
						maxLength={1000}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
					/>
				</Field>
				<div className="flex flex-wrap gap-3">
					<Button type="submit" disabled={busy || stale}>
						{t.save}
					</Button>
					<Link
						className={`${linkClass} mt-3`}
						href={sellerHref(
							locale,
							`inventory/${position.id}`,
							seller,
							returnParams,
						)}
					>
						{t.cancel}
					</Link>
				</div>
			</form>
			{review && (
				<StockModal title={t.review} onClose={() => !busy && setReview(false)}>
					<p className="wrap-anywhere">
						{position.sku} ·{" "}
						{mode === "settings"
							? tracking === "batch"
								? t.batchMode
								: t.plain
							: `${quantity} ${unit}`}
					</p>
					{mode !== "settings" && (
						<dl className="my-4 space-y-2">
							<dt>{t.before}</dt>
							<dd>
								<bdi>{before}</bdi> {unit}
							</dd>
							<dt>{t.after}</dt>
							<dd>
								<bdi>{preview()}</bdi> {unit}
							</dd>
						</dl>
					)}
					<p className="my-4 wrap-anywhere">{reason}</p>
					<div className="flex flex-wrap gap-3">
						<Button disabled={busy} onClick={() => void submit()}>
							{t.confirm}
						</Button>
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => setReview(false)}
						>
							{t.keep}
						</Button>
					</div>
				</StockModal>
			)}
			{leave && (
				<StockModal title={t.discard} onClose={() => setLeave(null)}>
					<Button variant="secondary" onClick={() => setLeave(null)}>
						{t.keep}
					</Button>
					<Button
						onClick={() => {
							setDirty(false);
							const action = leave;
							setLeave(null);
							action();
						}}
					>
						{t.discardConfirm}
					</Button>
				</StockModal>
			)}
		</section>
	);
}
