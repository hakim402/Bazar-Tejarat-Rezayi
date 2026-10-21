"use client";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/form-field";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { locales, type Locale } from "../../../lib/i18n/locales";
import type { Taxonomy, Category, Attribute } from "../types";
import { Control } from "./catalogue-fields";
const emptyLabels = () => ({ "fa-AF": "", en: "", ps: "", ar: "" });
export function TaxonomyEditor({
	locale,
	taxonomy,
	busy,
	onSave,
}: {
	locale: Locale;
	taxonomy: Taxonomy;
	busy: boolean;
	onSave: (path: string, data: unknown) => Promise<Taxonomy | null>;
}) {
	const t = catalogueCopy[locale];
	const blank = (): Category => ({
		code: "",
		labels: emptyLabels(),
		attributes: [],
		units: ["piece"],
		parent: null,
		active: true,
		version: 0,
	});
	const [value, setValue] = useState<Category>(blank);
	const [unit, setUnit] = useState({
		version: 0,
		code: "",
		labels: emptyLabels(),
		fractional: false,
		active: true,
	});
	const [dirty, setDirty] = useState(false),
		[pending, setPending] = useState<string | null>(null);
	const update = (v: Category) => {
		setValue(v);
		setDirty(true);
	};
	function select(code: string) {
		const selected =
			taxonomy.categories.find((c) => c.code === code) ?? blank();
		setValue({
			...selected,
			attributes: selected.attributes.map((a) => ({
				...a,
				editorKey: crypto.randomUUID(),
			})),
		});
		setDirty(false);
		setPending(null);
	}
	return (
		<details className="space-y-4 rounded-control border border-border p-4">
			<summary className="min-h-11 text-xl">{t.taxonomy}</summary>
			<label htmlFor="catalogue-taxonomy-select">{t.category}</label>
			<Select
				id="catalogue-taxonomy-select"
				value={value.version ? value.code : ""}
				onChange={(e) =>
					dirty ? setPending(e.target.value) : select(e.target.value)
				}
			>
				<option value="">{t.newCategory}</option>
				{taxonomy.categories.map((c) => (
					<option key={c.code} value={c.code}>
						{c.labels[locale]}
					</option>
				))}
			</Select>
			{pending !== null && (
				<div role="alert">
					<p>{t.dirty}</p>
					<Button onClick={() => select(pending)}>{t.confirm}</Button>
					<Button onClick={() => setPending(null)}>{t.cancel}</Button>
				</div>
			)}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void onSave("taxonomy/", {
						...value,
						attributes: value.attributes.map(
							({ editorKey: _, ...field }) => field,
						),
					}).then((fresh) => {
						const row = fresh?.categories.find((c) => c.code === value.code);
						if (row) {
							setValue({
								...row,
								attributes: row.attributes.map((a) => ({
									...a,
									editorKey: crypto.randomUUID(),
								})),
							});
							setDirty(false);
						}
					});
				}}
			>
				<fieldset disabled={busy} className="min-w-0 space-y-4">
					<Control
						path="code"
						label={t.code}
						value={value.code}
						disabled={value.version > 0}
						onChange={(code) => update({ ...value, code })}
					/>
					{locales.map((l) => (
						<Control
							key={l}
							path={`labels.${l}`}
							label={`${t.translatedLabel} · ${l}`}
							value={value.labels[l]}
							onChange={(label) =>
								update({ ...value, labels: { ...value.labels, [l]: label } })
							}
						/>
					))}
					<Control
						path="parent"
						label={t.parent}
						value={value.parent ?? ""}
						options={[
							{ value: "", label: "—" },
							...taxonomy.categories
								.filter((c) => c.code !== value.code)
								.map((c) => ({ value: c.code, label: c.labels[locale] })),
						]}
						onChange={(parent) => update({ ...value, parent: parent || null })}
					/>
					<label className="flex min-h-11 gap-3">
						<input
							className="size-5 accent-primary"
							type="checkbox"
							checked={value.active}
							onChange={(e) => update({ ...value, active: e.target.checked })}
						/>
						{t.active}
					</label>
					<div className="flex flex-wrap gap-4">
						{taxonomy.units.map((u) => (
							<label key={u.code} className="flex min-h-11 gap-2">
								<input
									className="size-5 accent-primary"
									type="checkbox"
									checked={value.units.includes(u.code)}
									onChange={(e) =>
										update({
											...value,
											units: e.target.checked
												? [...value.units, u.code]
												: value.units.filter((c) => c !== u.code),
										})
									}
								/>
								{u.labels[locale]}
							</label>
						))}
					</div>
					{value.attributes.map((field, index) => (
						<fieldset
							key={field.editorKey}
							className="border border-border rounded-control p-4 space-y-4"
						>
							<legend>
								{t.attributes} {index + 1}
							</legend>
							{(["code", "type"] as const).map((key) => (
								<Control
									key={key}
									path={`attributes.${index}.${key}`}
									label={key === "code" ? t.code : t.fieldType}
									value={field[key]}
									options={
										key === "type"
											? ["text", "enum", "decimal", "boolean"].map((c) => ({
													value: c,
													label: c,
												}))
											: undefined
									}
									onChange={(v) =>
										update({
											...value,
											attributes: value.attributes.map((a, i) =>
												i === index ? { ...a, [key]: v } : a,
											),
										})
									}
								/>
							))}
							{locales.map((l) => (
								<Control
									key={l}
									path={`attributes.${index}.labels.${l}`}
									label={`${t.translatedLabel} · ${l}`}
									value={field.labels[l]}
									onChange={(v) =>
										update({
											...value,
											attributes: value.attributes.map((a, i) =>
												i === index
													? { ...a, labels: { ...a.labels, [l]: v } }
													: a,
											),
										})
									}
								/>
							))}
							{field.type === "enum" && (
								<Control
									path={`attributes.${index}.choices`}
									label={t.choices}
									textarea
									value={field.choices?.join("\n") ?? ""}
									onChange={(v) =>
										update({
											...value,
											attributes: value.attributes.map((a, i) =>
												i === index ? { ...a, choices: v.split("\n") } : a,
											),
										})
									}
								/>
							)}{" "}
							{(["required", "variant"] as const).map((k) => (
								<label key={k} className="flex min-h-11 gap-3">
									<input
										className="size-5 accent-primary"
										type="checkbox"
										checked={field[k] ?? false}
										onChange={(e) =>
											update({
												...value,
												attributes: value.attributes.map((a, i) =>
													i === index ? { ...a, [k]: e.target.checked } : a,
												),
											})
										}
									/>
									{k === "required" ? t.requiredField : t.variantAttribute}
								</label>
							))}
							<Button
								variant="secondary"
								onClick={() =>
									update({
										...value,
										attributes: value.attributes.filter((_, i) => i !== index),
									})
								}
							>
								{t.remove}
							</Button>
						</fieldset>
					))}
					<Button
						variant="secondary"
						disabled={value.attributes.length >= 24}
						onClick={() =>
							update({
								...value,
								attributes: [
									...value.attributes,
									{
										editorKey: crypto.randomUUID(),
										code: "",
										labels: emptyLabels(),
										type: "text",
										required: false,
										variant: false,
									} as Attribute,
								],
							})
						}
					>
						{t.addAttribute}
					</Button>
					<Button type="submit">{t.save}</Button>
				</fieldset>
			</form>
			<details>
				<summary>{t.unit}</summary>
				<Select
					aria-label={t.unit}
					value={unit.version ? unit.code : ""}
					onChange={(e) => {
						const row = taxonomy.units.find((u) => u.code === e.target.value);
						setUnit(
							row
								? { ...row }
								: {
										version: 0,
										code: "",
										labels: emptyLabels(),
										fractional: false,
										active: true,
									},
						);
					}}
				>
					<option value="">—</option>
					{taxonomy.units.map((u) => (
						<option key={u.code} value={u.code}>
							{u.labels[locale]}
						</option>
					))}
				</Select>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						void onSave("units/", unit).then((fresh) => {
							const row = fresh?.units.find((u) => u.code === unit.code);
							if (row) setUnit(row);
						});
					}}
				>
					<Control
						path="unit.code"
						label={t.code}
						value={unit.code}
						onChange={(code) => setUnit({ ...unit, code })}
					/>
					{locales.map((l) => (
						<Control
							key={l}
							path={`unit.labels.${l}`}
							label={`${t.translatedLabel} · ${l}`}
							value={unit.labels[l]}
							onChange={(v) =>
								setUnit({ ...unit, labels: { ...unit.labels, [l]: v } })
							}
						/>
					))}
					<label className="flex min-h-11 gap-3">
						<input
							className="size-5 accent-primary"
							type="checkbox"
							checked={unit.fractional}
							onChange={(e) =>
								setUnit({ ...unit, fractional: e.target.checked })
							}
						/>
						{t.increment} 0.001
					</label>
					<label className="flex min-h-11 gap-3">
						<input
							className="size-5 accent-primary"
							type="checkbox"
							checked={unit.active}
							onChange={(e) => setUnit({ ...unit, active: e.target.checked })}
						/>
						{t.active}
					</label>
					<Button type="submit" disabled={busy}>
						{t.save}
					</Button>
				</form>
			</details>
		</details>
	);
}
