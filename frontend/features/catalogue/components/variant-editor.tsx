"use client";
import { useContext, useState } from "react";
import { Button } from "./product-controls";
import { Toggle } from "../../../components/ui/form-field";
import { Icon } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import {
	productFlowCopy,
	sellerProductsCopy,
} from "../../../lib/i18n/seller-products";
import type { Variant, Category, Taxonomy } from "../types";
import {
	CatalogueValidation,
	Control,
	Attributes,
	ValidationGroup,
	fieldId,
} from "./catalogue-fields";

export function variantKey(variant: Variant, index: number) {
	return variant.id ?? variant.clientKey ?? String(index);
}

function VariantHeader({
	locale,
	variant,
	index,
	open,
	onToggle,
}: {
	locale: Locale;
	variant: Variant;
	index: number;
	open: boolean;
	onToggle: () => void;
}) {
	const t = catalogueCopy[locale];
	return (
		<button
			type="button"
			aria-expanded={open}
			aria-controls={`variant-body-${variantKey(variant, index)}`}
			onClick={onToggle}
			className="-mx-2 flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control bg-transparent px-2 py-2 text-start text-inherit"
		>
			<span className="shrink-0 text-body font-semibold text-foreground">
				{t.variantLabel} {index + 1}
			</span>
			<bdi className="min-w-0 flex-1 text-caption text-muted wrap-anywhere">
				{variant.sku || t.noSku}
			</bdi>
			<Icon
				name="chevron-down"
				className={`size-4 shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none ${
					open ? "" : "rotate-180"
				}`}
			/>
		</button>
	);
}

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
	const s = sellerProductsCopy[locale];
	const { issues } = useContext(CatalogueValidation);
	const [closed, setClosed] = useState<string[]>([]);
	const change = (index: number, values: Partial<Variant>) =>
		onChange(variants.map((v, i) => (i === index ? { ...v, ...values } : v)));
	const flagged = (index: number) =>
		issues.some(
			(issue) =>
				issue.path === `body.variants.${index}` ||
				issue.path.startsWith(`body.variants.${index}.`),
		);
	return (
		<div className="min-w-0 space-y-3">
			{variants.map((variant, index) => {
				const key = variantKey(variant, index);
				// A collapsed card is reopened automatically when the server reports one of its fields.
				const open = !closed.includes(String(key)) || flagged(index);
				return (
					<section
						key={key}
						id={variant.id ? fieldId(`body.variants.${index}`) : undefined}
						tabIndex={-1}
						className="min-w-0 rounded-card border border-border bg-surface shadow-sm"
					>
						<header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
							<VariantHeader
								locale={locale}
								variant={variant}
								index={index}
								open={open}
								onToggle={() =>
									setClosed(
										open
											? [...closed, String(key)]
											: closed.filter((k) => k !== String(key)),
									)
								}
							/>
							<label
								htmlFor={fieldId(`body.variants.${index}.active`)}
								className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-base font-medium text-foreground"
							>
								<Toggle
									id={fieldId(`body.variants.${index}.active`)}
									checked={variant.active}
									onChange={(e) => change(index, { active: e.target.checked })}
								/>
								{t.active}
							</label>
						</header>
						{open && (
							<div
								id={`variant-body-${key}`}
								className="min-w-0 space-y-4 border-t border-border p-4"
							>
								{variant.id && (
									<p className="rounded-control bg-info p-3 text-caption text-muted">
										{s.immutableHelp}
									</p>
								)}
								<div className="grid gap-4 desktop:grid-cols-2">
									<Control
										path={`body.variants.${index}.sku`}
										required
										label={s.sku}
										maxLength={64}
										hint={s.skuHelp}
										isolated
										value={variant.sku}
										disabled={!!variant.id}
										onChange={(sku) => change(index, { sku })}
									/>
									<Control
										path={`body.variants.${index}.unit`}
										required
										label={t.unit}
										value={variant.unit}
										disabled={!!variant.id}
										options={[
											{ value: "", label: "—" },
											...taxonomy.units
												.filter((u) => category?.units.includes(u.code))
												.map((u) => ({
													value: u.code,
													label: u.labels[locale],
												})),
										]}
										onChange={(unit) => change(index, { unit })}
									/>
									<details
										className="rounded-xl border border-border p-3 desktop:col-span-2"
										open={
											issues.some((issue) =>
												["increment", "minimum", "contents"].some(
													(key) =>
														issue.path === `body.variants.${index}.${key}`,
												),
											) || undefined
										}
									>
										<summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
											{productFlowCopy[locale].advanced}
										</summary>
										<div className="grid gap-4 pt-3 desktop:grid-cols-2">
											{(["increment", "minimum", "contents"] as const).map(
												(keyName) => (
													<Control
														key={keyName}
														path={`body.variants.${index}.${keyName}`}
														label={t[keyName]}
														value={variant[keyName]}
														decimal={keyName !== "contents"}
														isolated={keyName !== "contents"}
														maxLength={keyName === "contents" ? 200 : 20}
														hint={
															keyName === "increment"
																? s.quantityHelp
																: keyName === "minimum"
																	? s.minimumHelp
																	: s.contentsHelp
														}
														disabled={!!variant.id}
														onChange={(v) => change(index, { [keyName]: v })}
													/>
												),
											)}
										</div>
									</details>
								</div>
								<Attributes
									fields={category?.attributes.filter((a) => a.variant) ?? []}
									values={variant.attributes}
									path={`body.variants.${index}.attributes`}
									disabled={!!variant.id}
									onChange={(attributes) => change(index, { attributes })}
								/>
								{variants.length > 1 && (
									<Button
										variant="secondary"
										onClick={() =>
											onChange(variants.filter((_, i) => i !== index))
										}
									>
										{t.remove}
									</Button>
								)}
							</div>
						)}
					</section>
				);
			})}
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
		</div>
	);
}

export function VariantPrices({
	locale,
	variants,
	onChange,
}: {
	locale: Locale;
	variants: Variant[];
	onChange: (v: Variant[]) => void;
}) {
	const t = catalogueCopy[locale];
	const pending = variants
		.map((variant, index) => ({ variant, index }))
		.filter(({ variant }) => !variant.id);
	if (!pending.length)
		return <p className="text-caption text-muted">{t.priceSaved}</p>;
	return (
		<div className="min-w-0 space-y-3">
			{pending.map(({ variant, index }) => (
				<ValidationGroup
					key={variantKey(variant, index)}
					path={`body.variants.${index}`}
					label={
						<>
							{t.variantLabel} {index + 1} ·{" "}
							<bdi className="wrap-anywhere">{variant.sku || t.noSku}</bdi>
						</>
					}
				>
					{(["retail", "wholesale"] as const).map((key) => (
						<Control
							key={key}
							path={`body.variants.${index}.${key}`}
							label={t[key]}
							value={variant[key] ?? ""}
							decimal
							isolated
							hint={t.onePrice}
							onChange={(v) =>
								onChange(
									variants.map((row, i) =>
										i === index ? { ...row, [key]: v } : row,
									),
								)
							}
						/>
					))}
				</ValidationGroup>
			))}
		</div>
	);
}
