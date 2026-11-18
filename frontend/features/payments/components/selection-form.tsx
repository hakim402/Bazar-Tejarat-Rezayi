"use client";
import { useId, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "../../../lib/i18n/locales";
import type { Detail, Selection, SelectionPreview } from "../api";
import { paymentCopy } from "../copy";
import { exactSelections } from "../validation";
import { action, control, panel } from "../../orders/components/controls";
import { Button } from "../../../components/shadcn/button";
import { Input } from "../../../components/shadcn/input";
import { Textarea } from "../../../components/shadcn/textarea";
export function SelectionForm({
	locale,
	row,
	selection,
	disabled,
	onReview,
	onPage,
	onDirty,
	compact = false,
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
	compact?: boolean;
}) {
	const t = paymentCopy[locale],
		reasonId = useId(),
		[quantities, setQuantities] = useState<Record<string, string>>({}),
		[buckets, setBuckets] = useState<
			Record<string, Selection["results"][number]>
		>({}),
		[reason, setReason] = useState(""),
		[invalid, setInvalid] = useState(false);
	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const lines = Object.entries(quantities)
			.filter(([, q]) => q && q !== "0.000")
			.map(([id, quantity]) => ({
				variant: buckets[id].variant,
				batch: buckets[id].batch,
				quantity,
			}));
		if (!exactSelections(selection.goods, lines) || reason.trim().length < 3) {
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
				sku: selection.goods.find((g) => g.variant === line.variant)?.sku ?? "",
				unit:
					selection.goods.find((g) => g.variant === line.variant)?.unit ?? "",
				code:
					Object.values(buckets).find(
						(b) => b.variant === line.variant && b.batch === line.batch,
					)?.code ?? "",
			})),
		);
	}
	if (compact)
		return (
			<form
				className="flex min-w-0 flex-col gap-4 rounded-xl border border-solid border-border bg-surface p-4 sm:p-5"
				onChange={onDirty}
				onSubmit={submit}
			>
				<h3 className="m-0 text-base font-semibold">{t.selection}</h3>
				<p className="m-0 text-sm leading-relaxed text-muted">
					{t.selectionNote}
				</p>
				<div className="flex flex-wrap gap-2">
					{selection.goods.map((g) => (
						<span
							key={g.variant}
							className="rounded-lg bg-page px-2.5 py-1 text-xs text-muted"
						>
							<bdi>{g.sku}</bdi> · {t.required}:{" "}
							<bdi>
								{g.quantity} {g.unit}
							</bdi>
						</span>
					))}
				</div>
				<fieldset
					disabled={disabled}
					className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
				>
					{selection.results.map((b) => (
						<div
							key={b.bucket}
							className="flex flex-col gap-2 rounded-lg border border-solid border-border bg-page p-3"
						>
							<p className="m-0 text-xs text-muted">
								<bdi>
									{selection.goods.find((g) => g.variant === b.variant)?.sku}
								</bdi>{" "}
								· {t.batch}: <bdi>{b.code || "—"}</bdi> · {t.expiry}:{" "}
								<bdi>{b.expires_on || "—"}</bdi> · {t.available}:{" "}
								<bdi>{b.available}</bdi>
							</p>
							<label
								htmlFor={`bucket-${b.bucket}`}
								className="text-xs font-medium"
							>
								{t.quantity}
							</label>
							<Input
								id={`bucket-${b.bucket}`}
								dir="ltr"
								inputMode="decimal"
								className="h-10 rounded-lg border-solid bg-surface text-sm shadow-none"
								disabled={!b.eligible}
								value={quantities[b.bucket] ?? ""}
								onChange={(e) => {
									setQuantities((q) => ({ ...q, [b.bucket]: e.target.value }));
									setBuckets((old) => ({ ...old, [b.bucket]: b }));
								}}
							/>
						</div>
					))}
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="rounded-lg"
							disabled={selection.page <= 1}
							onClick={() => onPage(selection.page - 1)}
						>
							<ChevronLeft className="size-4 rtl:rotate-180" />
							{t.previous}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="rounded-lg"
							disabled={selection.page * 50 >= selection.count}
							onClick={() => onPage(selection.page + 1)}
						>
							{t.next}
							<ChevronRight className="size-4 rtl:rotate-180" />
						</Button>
					</div>
					<div className="flex flex-col gap-2">
						<label htmlFor={reasonId} className="text-sm font-medium">
							{t.reason}
						</label>
						<Textarea
							id={reasonId}
							required
							minLength={3}
							maxLength={1000}
							className="h-auto min-h-24 resize-y rounded-lg border-solid text-sm shadow-none"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>
					{invalid && (
						<p
							role="alert"
							className="m-0 rounded-lg border border-solid border-warning bg-warning-surface px-3 py-2 text-sm text-warning"
						>
							{t.error}
						</p>
					)}
					<Button type="submit" className="w-fit rounded-lg">
						{t.exact}
					</Button>
				</fieldset>
			</form>
		);
	return (
		<form className={panel} onChange={onDirty} onSubmit={submit}>
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
			<fieldset
				disabled={disabled}
				className="m-0 min-w-0 space-y-3 border-0 p-0"
			>
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
