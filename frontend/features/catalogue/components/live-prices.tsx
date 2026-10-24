"use client";
import { useState, useEffect } from "react";
import { Button } from "../../../components/ui/button";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import type { Locale } from "../../../lib/i18n/locales";
import type { ProductDetail } from "../types";
import { Control, ValidationGroup } from "./catalogue-fields";
export function LivePrices({
	item,
	locale,
	disabled,
	onSave,
	onDirty,
	onEdit,
}: {
	item: ProductDetail;
	locale: Locale;
	disabled: boolean;
	onDirty: (dirty: boolean) => void;
	onEdit: (path: string) => void;
	onSave: (prices: ProductDetail["prices"]) => Promise<boolean>;
}) {
	const t = catalogueCopy[locale];
	// Keep variant rows in source order even when database updates change API row order.
	const order = new Map(
		item.revisions[0]?.body.variants.map((variant, index) => [
			variant.id,
			index,
		]),
	);
	const initialPrices = [...item.prices].sort(
		(a, b) =>
			(order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
				(order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
			a.sku.localeCompare(b.sku),
	);
	const [prices, setPrices] = useState(initialPrices);
	const [baseline, setBaseline] = useState(JSON.stringify(initialPrices));
	const dirty = JSON.stringify(prices) !== baseline;
	useEffect(() => {
		onDirty(dirty);
	}, [dirty, onDirty]);
	return (
		<details className="space-y-4 rounded-control border border-border p-4">
			<summary className="min-h-11 font-bold">{t.priceEdit}</summary>
			<p>{t.priceHelp}</p>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void onSave(prices).then((ok) => {
						if (ok) setBaseline(JSON.stringify(prices));
					});
				}}
				className="space-y-4"
			>
				<fieldset disabled={disabled} className="min-w-0">
					{prices.map((p, index) => (
						<ValidationGroup
							key={p.id}
							path={`prices.${index}`}
							label={
								<>
									<bdi>{p.sku}</bdi> · {item.currency}
								</>
							}
						>
							{(["retail", "wholesale"] as const).map((k) => (
								<Control
									key={k}
									path={`prices.${index}.${k}`}
									label={t[k]}
									value={p[k] ?? ""}
									decimal
									onChange={(v) => {
										onEdit(`prices.${index}.${k}`);
										setPrices(
											prices.map((row) =>
												row.id === p.id ? { ...row, [k]: v || null } : row,
											),
										);
									}}
								/>
							))}
						</ValidationGroup>
					))}
					<Button type="submit" disabled={disabled || !prices.length}>
						{t.priceEdit}
					</Button>
				</fieldset>
			</form>
			<h3>{t.history}</h3>
			{item.price_history.map((h) => (
				<p key={`${h.variant}-${h.at}-${h.version}`} className="text-sm">
					<bdi>
						{h.at} · {h.retail ?? "—"} / {h.wholesale ?? "—"} {item.currency}
					</bdi>{" "}
					· {t.revision} {h.version}
				</p>
			))}
		</details>
	);
}
