"use client";
import { Button } from "../../../components/ui/button";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import type { Variant, Category, Taxonomy } from "../types";
import { Control, Attributes } from "./catalogue-fields";
export function VariantEditor({
	locale,
	variants,
	category,
	taxonomy,
	onChange,
}: {
	locale: Locale;
	variants: Variant[];
	category?: Category;
	taxonomy: Taxonomy;
	onChange: (v: Variant[]) => void;
}) {
	const t = catalogueCopy[locale];
	const change = (index: number, values: Partial<Variant>) =>
		onChange(variants.map((v, i) => (i === index ? { ...v, ...values } : v)));
	return (
		<section className="space-y-4">
			<h2 className="text-xl">{t.variants}</h2>
			<p className="text-muted">
				{t.single} {t.priceHelp}
			</p>
			{variants.map((variant, index) => (
				<fieldset
					key={variant.id ?? variant.clientKey}
					className="min-w-0 rounded-control border border-border p-4 space-y-4"
				>
					<legend>
						{index + 1} · <bdi>{variant.sku}</bdi>
					</legend>
					<div className="grid gap-4 desktop:grid-cols-2">
						<Control
							path={`body.variants.${index}.sku`}
							label={t.sku}
							value={variant.sku}
							disabled={!!variant.id}
							onChange={(sku) => change(index, { sku })}
						/>
						<Control
							path={`body.variants.${index}.unit`}
							label={t.unit}
							value={variant.unit}
							disabled={!!variant.id}
							options={[
								{ value: "", label: "—" },
								...taxonomy.units
									.filter((u) => category?.units.includes(u.code))
									.map((u) => ({ value: u.code, label: u.labels[locale] })),
							]}
							onChange={(unit) => change(index, { unit })}
						/>
						{(["increment", "minimum", "contents"] as const).map((key) => (
							<Control
								key={key}
								path={`body.variants.${index}.${key}`}
								label={t[key]}
								value={variant[key]}
								decimal={key !== "contents"}
								disabled={!!variant.id}
								onChange={(v) => change(index, { [key]: v })}
							/>
						))}
					</div>
					<Attributes
						fields={category?.attributes.filter((a) => a.variant) ?? []}
						values={variant.attributes}
						path={`body.variants.${index}.attributes`}
						disabled={!!variant.id}
						onChange={(attributes) => change(index, { attributes })}
					/>
					<label className="flex min-h-11 gap-3 items-center">
						<input
							className="size-5 accent-primary"
							type="checkbox"
							checked={variant.active}
							onChange={(e) => change(index, { active: e.target.checked })}
						/>
						{t.active}
					</label>
					{!variant.id && (
						<div className="grid gap-4 desktop:grid-cols-2">
							{(["retail", "wholesale"] as const).map((key) => (
								<Control
									key={key}
									path={`body.variants.${index}.${key}`}
									label={t[key]}
									value={variant[key] ?? ""}
									decimal
									onChange={(v) => change(index, { [key]: v })}
								/>
							))}
						</div>
					)}
					{variants.length > 1 && (
						<Button
							variant="secondary"
							onClick={() => onChange(variants.filter((_, i) => i !== index))}
						>
							{t.remove}
						</Button>
					)}
				</fieldset>
			))}
			<Button
				variant="secondary"
				disabled={variants.length >= 40}
				onClick={() =>
					onChange([
						...variants,
						{
							clientKey: crypto.randomUUID(),
							sku: "",
							unit: category?.units[0] ?? "piece",
							increment: "1",
							minimum: "1",
							contents: "",
							active: true,
							attributes: {},
							retail: "",
							wholesale: "",
						},
					])
				}
			>
				{t.addVariant}
			</Button>
		</section>
	);
}
