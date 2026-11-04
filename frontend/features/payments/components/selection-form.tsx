"use client";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import type { Detail, Selection, SelectionPreview } from "../api";
import { paymentCopy } from "../copy";
import { exactSelections } from "../validation";
import { action, control, panel } from "../../orders/components/controls";
export function SelectionForm({
	locale,
	row,
	selection,
	disabled,
	onReview,
	onPage,
	onDirty,
}: {
	locale: Locale;
	row: Detail;
	selection: Selection;
	disabled: boolean;
	onReview: (
		path: string,
		body: Record<string, unknown>,
		label: string,
		preview?: SelectionPreview[],
	) => void;
	onPage: (page: number) => void;
	onDirty: () => void;
}) {
	const t = paymentCopy[locale],
		[quantities, setQuantities] = useState<Record<string, string>>({}),
		[buckets, setBuckets] = useState<
			Record<string, Selection["results"][number]>
		>({}),
		[reason, setReason] = useState(""),
		[invalid, setInvalid] = useState(false);
	return (
		<form
			className={panel}
			onChange={onDirty}
			onSubmit={(e) => {
				e.preventDefault();
				const lines = Object.entries(quantities)
					.filter(([, q]) => q && q !== "0.000")
					.map(([id, quantity]) => ({
						variant: buckets[id].variant,
						batch: buckets[id].batch,
						quantity,
					}));
				if (
					!exactSelections(selection.goods, lines) ||
					reason.trim().length < 3
				) {
					setInvalid(true);
					return;
				}
				onReview(
					`orders/${row.id}/stock-plans/`,
					{
						intent_version: row.selection?.version ?? 0,
						lines,
						reason: reason.trim(),
						...(row.selection?.shortage
							? { replaces: row.selection.shortage }
							: {}),
					},
					row.selection?.shortage ? t.replace : t.savePlan,
					lines.map((line) => ({
						...line,
						sku:
							selection.goods.find((g) => g.variant === line.variant)?.sku ??
							"",
						unit:
							selection.goods.find((g) => g.variant === line.variant)?.unit ??
							"",
						code:
							Object.values(buckets).find(
								(b) => b.variant === line.variant && b.batch === line.batch,
							)?.code ?? "",
					})),
				);
			}}
		>
			<h3 className="font-semibold">{t.selection}</h3>
			<p className="text-sm text-muted">{t.selectionNote}</p>
			{selection.goods.map((g) => (
				<p key={g.variant}>
					<bdi>{g.sku}</bdi> · {t.required}:{" "}
					<bdi>
						{g.quantity} {g.unit}
					</bdi>
				</p>
			))}
			<fieldset disabled={disabled} className="space-y-3">
				{selection.results.map((b) => (
					<label
						key={b.bucket}
						className="block rounded-control border border-border p-3"
					>
						<bdi>
							{selection.goods.find((g) => g.variant === b.variant)?.sku}
						</bdi>{" "}
						· {t.batch}: <bdi>{b.code || "—"}</bdi> · {t.expiry}:{" "}
						<bdi>{b.expires_on || "—"}</bdi> · {t.available}:{" "}
						<bdi>{b.available}</bdi>
						<span className="block">{t.quantity}</span>
						<input
							dir="ltr"
							inputMode="decimal"
							className={control}
							disabled={!b.eligible}
							value={quantities[b.bucket] ?? ""}
							onChange={(e) => {
								setQuantities((q) => ({ ...q, [b.bucket]: e.target.value }));
								setBuckets((old) => ({ ...old, [b.bucket]: b }));
							}}
						/>
					</label>
				))}
				<div className="flex flex-wrap gap-3">
					<button
						type="button"
						className={action}
						disabled={selection.page <= 1}
						onClick={() => onPage(selection.page - 1)}
					>
						{t.previous}
					</button>
					<button
						type="button"
						className={action}
						disabled={selection.page * 50 >= selection.count}
						onClick={() => onPage(selection.page + 1)}
					>
						{t.next}
					</button>
				</div>
				<label className="block">
					{t.reason}
					<textarea
						required
						minLength={3}
						maxLength={1000}
						className={control}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
					/>
				</label>
				{invalid && <p role="alert">{t.error}</p>}
				<button type="submit" className={action}>
					{t.exact}
				</button>
			</fieldset>
		</form>
	);
}
