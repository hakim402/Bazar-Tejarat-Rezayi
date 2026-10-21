"use client";
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	type ReactNode,
} from "react";
import { Input, Select } from "../../../components/ui/form-field";
import type { ValidationIssue } from "../../../lib/api/private-client";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import type { Locale } from "../../../lib/i18n/locales";
import type { Attribute } from "../types";
export const CatalogueValidation = createContext<{
	locale: Locale;
	issues: ValidationIssue[];
}>({ locale: "fa-AF", issues: [] });
export const fieldId = (path: string) =>
	`catalogue-${path.replaceAll(".", "-")}`;
export { catalogueFailure as failure } from "../feedback";
function rule(code: string, locale: Locale) {
	const t = catalogueCopy[locale];
	if (code === "cycle") return t.taxonomyRule;
	if (code === "stale_taxonomy") return t.taxonomyChanged;
	if (code === "plain_text") return t.plainText;
	if (code === "one_price") return t.onePrice;
	if (code === "duplicate_price") return t.duplicatePrice;
	if (["decimal", "positive"].includes(code)) return t.decimal;
	if (["duplicate", "unique"].includes(code)) return t.duplicate;
	if (code === "immutable_variant") return t.immutable;
	if (code.startsWith("image_")) return t.imageRule;
	if (["increment", "category", "cycle", "stale_taxonomy"].includes(code))
		return t.unitRule;
	return t.required;
}
export function Feedback({
	value,
	locale,
}: {
	value: { message: string; issues: ValidationIssue[] };
	locale: Locale;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (value.message || value.issues.length) ref.current?.focus();
	}, [value.message, value.issues]);
	return (
		<div
			ref={ref}
			role="alert"
			tabIndex={-1}
			className="rounded-control bg-danger-surface p-4 text-danger break-words"
		>
			<p>{value.message}</p>
			<ul>
				{value.issues.map((issue) => (
					<li key={`${issue.path}-${issue.code}`}>
						<button
							type="button"
							className="min-h-11 border-0 bg-transparent p-0 text-start text-inherit underline cursor-pointer"
							onClick={() =>
								document.getElementById(fieldId(issue.path))?.focus()
							}
						>
							{rule(issue.code, locale)}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
export function ValidationGroup({
	path,
	label,
	children,
}: {
	path: string;
	label: ReactNode;
	children: ReactNode;
}) {
	const { issues, locale } = useContext(CatalogueValidation);
	const selected = issues.filter((i) => i.path === path);
	const id = fieldId(path);
	return (
		<fieldset
			id={id}
			tabIndex={-1}
			aria-invalid={selected.length > 0}
			aria-describedby={selected.length ? `${id}-error` : undefined}
			className="grid min-w-0 gap-4 py-3 desktop:grid-cols-2"
		>
			<legend className="font-bold">{label}</legend>
			{children}
			{selected.length > 0 && (
				<p id={`${id}-error`} className="text-danger desktop:col-span-2">
					{selected.map((i) => rule(i.code, locale)).join(" ")}
				</p>
			)}
		</fieldset>
	);
}
export function Control({
	path,
	label,
	value,
	onChange,
	options,
	textarea = false,
	disabled = false,
	children,
	required = false,
	decimal = false,
}: {
	path: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	options?: { value: string; label: string }[];
	textarea?: boolean;
	disabled?: boolean;
	children?: ReactNode;
	required?: boolean;
	decimal?: boolean;
}) {
	const { issues, locale } = useContext(CatalogueValidation);
	const selected = issues.filter((i) => i.path === path);
	const id = fieldId(path);
	const props = {
		id,
		value,
		disabled,
		required,
		"aria-invalid": selected.length > 0,
		"aria-describedby": selected.length ? `${id}-error` : undefined,
	};
	return (
		<div className="min-w-0 space-y-2">
			<label className="block font-bold" htmlFor={id}>
				{label}
			</label>
			{options ? (
				<Select {...props} onChange={(e) => onChange(e.target.value)}>
					{options.map((o) => (
						<option value={o.value} key={o.value}>
							{o.label}
						</option>
					))}
				</Select>
			) : textarea ? (
				<textarea
					{...props}
					className="w-full min-h-32 rounded-control border border-control bg-surface p-3"
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<Input
					{...props}
					inputMode={decimal ? "decimal" : undefined}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}{" "}
			{selected.length > 0 && (
				<p className="text-danger" id={`${id}-error`}>
					{selected.map((i) => rule(i.code, locale)).join(" ")}
				</p>
			)}
			{children}
		</div>
	);
}
export function Attributes({
	fields,
	values,
	onChange,
	path,
	disabled = false,
}: {
	fields: Attribute[];
	values: Record<string, string | boolean>;
	onChange: (v: Record<string, string | boolean>) => void;
	path: string;
	disabled?: boolean;
}) {
	const { locale } = useContext(CatalogueValidation);
	return (
		<div className="grid gap-4 desktop:grid-cols-2">
			{fields.map((f) =>
				f.type === "boolean" ? (
					<label key={f.code} className="flex min-h-11 gap-3 items-center">
						<input
							className="size-5 accent-primary"
							type="checkbox"
							disabled={disabled}
							checked={values[f.code] === true}
							onChange={(e) =>
								onChange({ ...values, [f.code]: e.target.checked })
							}
						/>
						{f.labels[locale]}
					</label>
				) : (
					<Control
						key={f.code}
						path={`${path}.${f.code}`}
						label={f.labels[locale]}
						value={String(values[f.code] ?? "")}
						disabled={disabled}
						required={f.required}
						decimal={f.type === "decimal"}
						options={
							f.type === "enum"
								? [
										{ value: "", label: "—" },
										...(f.choices ?? []).map((c) => ({ value: c, label: c })),
									]
								: undefined
						}
						onChange={(v) => onChange({ ...values, [f.code]: v })}
					/>
				),
			)}
		</div>
	);
}
