"use client";
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	type ReactNode,
} from "react";
import { Input } from "../../../components/shadcn/input";
import { NativeSelect as Select } from "../../../components/shadcn/native-select";
import { Textarea } from "../../../components/shadcn/textarea";
import { Toggle } from "../../../components/ui/form-field";
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
	onIssue,
}: {
	value: { message: string; issues: ValidationIssue[] };
	locale: Locale;
	onIssue?: (path: string) => void;
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
							onClick={() => {
								onIssue?.(issue.path);
								requestAnimationFrame(() => {
									const target = document.getElementById(fieldId(issue.path));
									for (
										let parent = target?.parentElement;
										parent;
										parent = parent.parentElement
									) {
										if (parent instanceof HTMLDetailsElement)
											parent.open = true;
									}
									target?.scrollIntoView({ block: "nearest" });
									target?.focus();
								});
							}}
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
			className="m-0 grid min-w-0 gap-4 border-0 px-0 py-3 desktop:grid-cols-2"
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
	maxLength,
	hint,
	isolated = false,
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
	maxLength?: number;
	hint?: string;
	isolated?: boolean;
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
		"aria-describedby":
			[hint ? `${id}-hint` : "", selected.length ? `${id}-error` : ""]
				.filter(Boolean)
				.join(" ") || undefined,
		...(isolated ? { dir: "ltr" as const } : {}),
	};
	return (
		<div className="min-w-0 space-y-1.5">
			<label className="block text-xs font-medium text-foreground" htmlFor={id}>
				{label}
				{required && (
					<span aria-hidden="true" className="ms-1 text-danger">
						*
					</span>
				)}
			</label>
			{options ? (
				<Select
					{...props}
					className="h-10 rounded-xl bg-surface shadow-none"
					onChange={(e) => onChange(e.target.value)}
				>
					{options.map((o) => (
						<option value={o.value} key={o.value}>
							{o.label}
						</option>
					))}
				</Select>
			) : textarea ? (
				<Textarea
					{...props}
					maxLength={maxLength}
					className="min-h-28 rounded-xl bg-surface text-sm shadow-none"
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<Input
					{...props}
					className="h-10 rounded-xl bg-surface text-sm shadow-none"
					maxLength={maxLength}
					inputMode={decimal ? "decimal" : undefined}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}{" "}
			{hint && (
				<p id={`${id}-hint`} className="text-caption text-muted">
					{hint}
				</p>
			)}
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
					<label
						key={f.code}
						htmlFor={fieldId(`${path}.${f.code}`)}
						className="flex min-h-11 cursor-pointer items-center gap-3"
					>
						<Toggle
							id={fieldId(`${path}.${f.code}`)}
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
