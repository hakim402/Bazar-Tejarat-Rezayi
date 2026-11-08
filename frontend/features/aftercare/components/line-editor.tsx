"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { control as defaultControl } from "../../orders/components/controls";
import { salesControl } from "../../sales/components/seller-sales-ui";
import { aftercareCopy } from "../copy";
import type { Line } from "../types";

export function DecreaseLines({
	locale,
	currency,
	current,
	selected,
	change,
	choose,
	seller = false,
}: {
	locale: Locale;
	currency: string;
	current: Line[];
	selected: Line[];
	seller?: boolean;
	change: (lines: Line[]) => void;
	choose: (next: () => void) => void;
}) {
	const t = aftercareCopy[locale],
		control = seller ? salesControl : defaultControl;
	function edit(id: string, field: "quantity" | "unit_price", value: string) {
		change(
			selected.map((line) =>
				line.line === id ? { ...line, [field]: value } : line,
			),
		);
	}
	return (
		<div className="space-y-3">
			<p
				className={
					seller
						? "rounded-xl border border-border bg-info p-3 text-sm leading-relaxed"
						: undefined
				}
			>
				{t.rules}
			</p>
			<p className={seller ? "text-sm text-muted" : undefined}>
				{t.selectLines}
			</p>
			{seller && (
				<p className="text-sm font-semibold">
					{t.selected}:{" "}
					<bdi>{new Intl.NumberFormat(locale).format(selected.length)}</bdi>
				</p>
			)}
			{current.map((before) => {
				const line = selected.find((line) => line.line === before.line);
				return (
					<div
						key={before.line}
						className={
							seller
								? `min-w-0 space-y-3 rounded-xl border p-4 ${line ? "border-action bg-info" : "border-border"}`
								: "space-y-3 rounded-control border border-border p-3"
						}
					>
						<p
							dir="auto"
							className={seller ? "font-semibold wrap-anywhere" : undefined}
						>
							{before.titles?.[locale] ?? before.sku ?? before.line}
						</p>
						<p className={seller ? "text-sm leading-relaxed" : undefined}>
							{t.before}:{" "}
							<bdi>
								{before.quantity} {before.unit_labels?.[locale] ?? before.unit}{" "}
								· {before.unit_price} {currency}
							</bdi>
						</p>
						<label
							className={
								seller
									? "flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"
									: "flex items-center gap-3"
							}
						>
							<input
								className={seller ? "size-5 shrink-0 accent-action" : undefined}
								type="checkbox"
								checked={!!line}
								disabled={!line && selected.length >= 100}
								onChange={(event) => {
									if (event.target.checked)
										change([...selected, structuredClone(before)]);
									else
										choose(() =>
											change(
												selected.filter((item) => item.line !== before.line),
											),
										);
								}}
							/>
							{t.selected}
						</label>
						{line && (
							<div className="grid gap-3 sm:grid-cols-2">
								<label
									className={
										seller
											? "block min-w-0 space-y-2 text-sm font-medium"
											: undefined
									}
								>
									{t.quantity}
									{seller && (before.unit_labels?.[locale] ?? before.unit) && (
										<>
											{" "}
											(<bdi>{before.unit_labels?.[locale] ?? before.unit}</bdi>)
										</>
									)}
									<input
										className={control}
										dir="ltr"
										inputMode="decimal"
										maxLength={13}
										value={line.quantity}
										onChange={(event) =>
											edit(line.line, "quantity", event.target.value)
										}
									/>
								</label>
								<label
									className={
										seller
											? "block min-w-0 space-y-2 text-sm font-medium"
											: undefined
									}
								>
									{t.unitPrice} (<bdi>{currency}</bdi>)
									<input
										className={control}
										dir="ltr"
										inputMode="decimal"
										maxLength={12}
										value={line.unit_price}
										onChange={(event) =>
											edit(line.line, "unit_price", event.target.value)
										}
									/>
								</label>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
