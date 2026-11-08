"use client";
import { useEffect, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context, DisplayLine, StockOptions } from "../types";
import { fulfilment } from "../api";
import { fulfilmentCopy } from "../copy";
import {
	action as buyerAction,
	control as buyerControl,
} from "../../orders/components/controls";
import {
	salesAction,
	salesControl,
} from "../../sales/components/seller-sales-ui";
export function StockSelection({
	locale,
	context,
	id,
	disabled,
	lines,
	change,
}: {
	locale: Locale;
	context: Context;
	id: string;
	disabled: boolean;
	lines: DisplayLine[];
	change: (lines: DisplayLine[]) => void;
}) {
	const t = fulfilmentCopy[locale],
		action = context === "seller" ? salesAction : buyerAction,
		control = context === "seller" ? salesControl : buyerControl,
		[options, setOptions] = useState<StockOptions | null>(null),
		[query, setQuery] = useState(""),
		[page, setPage] = useState(1),
		[search, setSearch] = useState(""),
		[failed, setFailed] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		void fulfilment<StockOptions>(
			context,
			`orders/${id}/stock-options/?page=${page}&q=${encodeURIComponent(search)}`,
			undefined,
			controller.signal,
		)
			.then((data) => {
				if (controller.signal.aborted) return;
				setOptions(data);
				setFailed(false);
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [context, id, page, search]);
	const choices = new Map<string, DisplayLine>(
		lines.filter((line) => line.bucket).map((line) => [line.bucket, line]),
	);
	for (const row of options?.results ?? []) choices.set(row.bucket, row);
	return (
		<fieldset disabled={disabled} className="space-y-4">
			<legend className="font-bold">{t.selection}</legend>
			<p>{t.stockNote}</p>
			<div className="flex flex-wrap items-end gap-3">
				<label className="min-w-0 flex-1">
					{t.optionsSearch}
					<input
						className={control}
						value={query}
						maxLength={100}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<button
					type="button"
					className={action}
					onClick={() => {
						setPage(1);
						setSearch(query);
					}}
				>
					{t.loadOptions}
				</button>
			</div>
			{failed && <p role="alert">{t.error}</p>}
			{lines.map((line, index) => (
				<div
					key={line.client_id ?? line.bucket}
					className="grid min-w-0 gap-3 rounded-control border border-border p-3 sm:grid-cols-2"
				>
					<label>
						{t.batch}
						<select
							className={control}
							aria-label={t.batch}
							value={line.bucket}
							onChange={(event) => {
								const selected = choices.get(event.target.value);
								if (selected)
									change(
										lines.map((value, i) =>
											i === index
												? {
														...selected,
														quantity: line.quantity,
														client_id: line.client_id,
													}
												: value,
										),
									);
							}}
						>
							<option value="">—</option>
							{[...choices.values()].map((value) => (
								<option key={value.bucket} value={value.bucket}>
									{value.sku} · {value.batch_code || "—"} ·{" "}
									{value.expires_on || "—"} · {t.available}{" "}
									{options?.results.find((x) => x.bucket === value.bucket)
										?.available ?? "—"}
								</option>
							))}
						</select>
					</label>
					<label>
						{t.quantity}
						<input
							className={control}
							dir="ltr"
							inputMode="decimal"
							value={line.quantity}
							maxLength={13}
							onChange={(event) =>
								change(
									lines.map((value, i) =>
										i === index
											? { ...value, quantity: event.target.value }
											: value,
									),
								)
							}
						/>
					</label>
					<button
						type="button"
						className={action}
						onClick={() => change(lines.filter((_, i) => i !== index))}
					>
						{t.removeBucket}
					</button>
				</div>
			))}
			<button
				type="button"
				className={action}
				disabled={lines.length >= 100}
				onClick={() =>
					change([
						...lines,
						{
							variant: "",
							client_id: crypto.randomUUID(),
							bucket: "",
							batch: null,
							quantity: "",
							batch_code: "",
							expires_on: null,
							sku: "",
							unit: "",
							unit_labels: {},
						},
					])
				}
			>
				{t.addBucket}
			</button>
			<div className="flex flex-wrap gap-3">
				<button
					type="button"
					className={action}
					disabled={page <= 1}
					onClick={() => setPage((value) => value - 1)}
				>
					{t.previous}
				</button>
				<bdi>{page}</bdi>
				<button
					type="button"
					className={action}
					disabled={!options || page * 50 >= options.count}
					onClick={() => setPage((value) => value + 1)}
				>
					{t.next}
				</button>
			</div>
		</fieldset>
	);
}
