"use client";
import { useId, useState, useRef } from "react";
import { Badge } from "../../../components/shadcn/badge";
import { Input } from "../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import type { Locale } from "../../../lib/i18n/locales";
import { commerceCopy } from "../../orders/copy";
import { negotiationCopy } from "../copy";
import { lineCents, moneyText } from "../validation";
import { validateLines } from "../validation";
import type { Line, Choice } from "../api";
import type { Terms } from "../../orders/api";
import {
	control as buyerControl,
	panel as buyerPanel,
} from "../../orders/components/controls";
import {
	salesControl,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
export function ProposalFields({
	locale,
	currency,
	lines,
	change,
	limits = false,
	prefillLimits = false,
	disabled = false,
	labels = {},
	metadata = {},
	presentation,
}: {
	locale: Locale;
	currency: string;
	lines: Line[];
	change: (v: Line[]) => void;
	limits?: boolean;
	prefillLimits?: boolean;
	disabled?: boolean;
	presentation?: "seller";
	labels?: Record<string, string>;
	metadata?: Record<
		string,
		{ unit: string; increment: string; minimum: string }
	>;
}) {
	const t = negotiationCopy[locale],
		c = commerceCopy[locale],
		seller = presentation === "seller",
		control = seller ? salesControl : buyerControl,
		panel = seller ? salesPanel : buyerPanel,
		errorId = useId();
	const [touched, setTouched] = useState(false);
	const explicitPrices = useRef(new Set<string>());
	const keys = [
		"quantity",
		"unit_price",
		...(limits ? [] : ["max_quantity", "max_unit_price"]),
	] as (keyof Line)[];
	const labelFor = (key: keyof Line) =>
		key === "quantity"
			? t.quantity
			: key === "unit_price"
				? `${t.offer} · ${currency}`
				: key === "max_quantity"
					? t.maxQuantity
					: `${t.maxPrice} · ${currency}`;
	function update(line: Line, i: number, key: keyof Line, value: string) {
		const next = { ...line, [key]: value };
		const identity = `${line.variant}:${line.tier}`;
		if (key === "max_unit_price") explicitPrices.current.add(identity);
		if (
			key === "unit_price" &&
			prefillLimits &&
			!limits &&
			!explicitPrices.current.has(identity) &&
			line.max_unit_price === line.unit_price
		)
			next.max_unit_price = value;
		change(lines.map((v, n) => (n === i ? next : v)));
	}
	if (seller) {
		return (
			<div className="space-y-3">
				{lines.map((line, i) => (
					<fieldset
						key={`${line.variant}:${c[line.tier]}`}
						className={panel}
						disabled={disabled}
					>
						<legend className="max-w-full break-words px-2 text-sm font-semibold">
							<span dir="auto">{labels[line.variant] ?? line.variant}</span> ·{" "}
							{c[line.tier]}
						</legend>
						{metadata[line.variant] && (
							<p className="mb-3 text-sm text-muted">
								<bdi>{metadata[line.variant].unit}</bdi> · {c.increment}:{" "}
								<bdi>{metadata[line.variant].increment}</bdi>
								{line.tier === "wholesale" && (
									<>
										{" "}
										· {c.minimum}: <bdi>{metadata[line.variant].minimum}</bdi>
									</>
								)}
							</p>
						)}
						<div className="grid gap-3 sm:grid-cols-2">
							{keys.map((key) => (
								<label key={key} className="grid gap-2">
									{labelFor(key)}
									<input
										className={control}
										dir="ltr"
										inputMode="decimal"
										maxLength={20}
										required
										aria-invalid={touched && !validateLines([line])}
										aria-describedby={
											touched && !validateLines([line])
												? `${errorId}-${i}`
												: undefined
										}
										onBlur={() => setTouched(true)}
										value={line[key]}
										onChange={(e) => update(line, i, key, e.target.value)}
									/>
								</label>
							))}
						</div>
						{touched && !validateLines([line]) && (
							<p
								id={`${errorId}-${i}`}
								role="alert"
								className="text-sm text-warning"
							>
								{t.bounds}
							</p>
						)}
						<p className="rounded-xl bg-info p-3 text-sm font-semibold">
							{c.goods}:{" "}
							<bdi>
								{moneyText(lineCents(line))} {currency}
							</bdi>
						</p>
						{limits && (
							<dl className="grid gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-2">
								<div>
									<dt className="text-xs text-muted">{t.maxQuantity}</dt>
									<dd className="font-medium">
										<bdi>
											{line.max_quantity} {metadata[line.variant]?.unit}
										</bdi>
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted">{t.maxPrice}</dt>
									<dd className="font-medium">
										<bdi>
											{line.max_unit_price} {currency}
										</bdi>
									</dd>
								</div>
							</dl>
						)}
					</fieldset>
				))}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{lines.map((line, i) => {
				const invalid = touched && !validateLines([line]),
					meta = metadata[line.variant];
				return (
					<fieldset
						key={`${line.variant}:${c[line.tier]}`}
						disabled={disabled}
						className="m-0 flex min-w-0 flex-col gap-3 rounded-xl border border-solid border-border bg-surface p-4"
					>
						<legend className="sr-only">
							{labels[line.variant] ?? line.variant} · {c[line.tier]}
						</legend>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span
								className="min-w-0 break-words text-sm font-semibold text-foreground"
								dir="auto"
							>
								{labels[line.variant] ?? line.variant}
							</span>
							<Badge
								variant="secondary"
								className="rounded-full border-0 bg-page text-muted"
							>
								{c[line.tier]}
							</Badge>
						</div>
						{meta && (
							<p className="m-0 text-xs text-muted">
								<bdi>{meta.unit}</bdi> · {c.increment}:{" "}
								<bdi>{meta.increment}</bdi>
								{line.tier === "wholesale" && (
									<>
										{" "}
										· {c.minimum}: <bdi>{meta.minimum}</bdi>
									</>
								)}
							</p>
						)}
						<div className="grid gap-3 sm:grid-cols-2">
							{keys.map((key) => {
								const id = `${errorId}-${i}-${key}`;
								return (
									<div key={key} className="grid min-w-0 gap-1.5">
										<label
											htmlFor={id}
											className="text-xs font-medium text-muted"
										>
											{labelFor(key)}
										</label>
										<Input
											id={id}
											dir="ltr"
											inputMode="decimal"
											maxLength={20}
											required
											aria-invalid={invalid}
											aria-describedby={invalid ? `${errorId}-${i}` : undefined}
											onBlur={() => setTouched(true)}
											value={line[key]}
											onChange={(e) => update(line, i, key, e.target.value)}
											className="h-10 rounded-lg"
										/>
									</div>
								);
							})}
						</div>
						{invalid && (
							<p
								id={`${errorId}-${i}`}
								role="alert"
								className="m-0 text-xs text-warning"
							>
								{t.bounds}
							</p>
						)}
						<p className="m-0 text-sm font-semibold">
							{c.goods}:{" "}
							<bdi>
								{moneyText(lineCents(line))} {currency}
							</bdi>
						</p>
						{limits && (
							<p className="m-0 text-xs text-muted">
								{t.limits}:{" "}
								<bdi>
									{line.max_quantity} {meta?.unit} · {line.max_unit_price}{" "}
									{currency}
								</bdi>
							</p>
						)}
					</fieldset>
				);
			})}
		</div>
	);
}
export function TermsFields({
	locale,
	value,
	change,
	terms,
	disabled = false,
	presentation,
}: {
	locale: Locale;
	value: Choice;
	change: (v: Choice) => void;
	terms: Terms;
	disabled?: boolean;
	presentation?: "seller";
}) {
	const cityId = useId(),
		countryId = useId(),
		methodId = useId();
	const t = negotiationCopy[locale],
		seller = presentation === "seller",
		control = seller ? salesControl : buyerControl,
		destination = terms.destinations.find((d) => d.country === value.country);
	if (seller) {
		return (
			<fieldset
				className={`${salesPanel} grid gap-3 space-y-0! sm:grid-cols-3`}
				disabled={disabled}
			>
				<legend className="px-2 text-base font-semibold">{t.terms}</legend>
				<label htmlFor={countryId} className="grid gap-2">
					{t.country}
					<select
						id={countryId}
						className={control}
						required
						value={value.country}
						onChange={(e) =>
							change({ ...value, country: e.target.value, city: "" })
						}
					>
						<option value="">{t.choose}</option>
						{terms.destinations.map((d) => (
							<option key={d.country} value={d.country}>
								{d.country}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={cityId} className="grid gap-2">
					{t.city}
					{destination?.all_cities ? (
						<input
							id={cityId}
							className={control}
							required
							maxLength={100}
							value={value.city}
							onChange={(e) => change({ ...value, city: e.target.value })}
						/>
					) : (
						<select
							id={cityId}
							className={control}
							required
							value={value.city}
							onChange={(e) => change({ ...value, city: e.target.value })}
						>
							<option value="">{t.choose}</option>
							{destination?.cities.map((c) => (
								<option key={c}>{c}</option>
							))}
						</select>
					)}
				</label>
				<label htmlFor={methodId} className="grid gap-2">
					{t.method}
					<select
						id={methodId}
						className={control}
						required
						value={value.method}
						onChange={(e) =>
							change({ ...value, method: e.target.value as Choice["method"] })
						}
					>
						<option value="">{t.choose}</option>
						{terms.methods.map((m) => (
							<option value={m} key={m}>
								{t[m]}
							</option>
						))}
					</select>
				</label>
			</fieldset>
		);
	}
	return (
		<fieldset
			disabled={disabled}
			className="m-0 grid min-w-0 gap-3 rounded-xl border border-solid border-border bg-surface p-4 sm:grid-cols-3"
		>
			<legend className="sr-only">{t.terms}</legend>
			<div className="grid min-w-0 gap-1.5">
				<label htmlFor={countryId} className="text-xs font-medium text-muted">
					{t.country}
				</label>
				<NativeSelect
					id={countryId}
					required
					value={value.country}
					onChange={(e) =>
						change({ ...value, country: e.target.value, city: "" })
					}
					className="h-10 rounded-lg"
				>
					<NativeSelectOption value="">{t.choose}</NativeSelectOption>
					{terms.destinations.map((d) => (
						<NativeSelectOption key={d.country} value={d.country}>
							{d.country}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
			<div className="grid min-w-0 gap-1.5">
				<label htmlFor={cityId} className="text-xs font-medium text-muted">
					{t.city}
				</label>
				{destination?.all_cities ? (
					<Input
						id={cityId}
						required
						maxLength={100}
						dir="auto"
						value={value.city}
						onChange={(e) => change({ ...value, city: e.target.value })}
						className="h-10 rounded-lg"
					/>
				) : (
					<NativeSelect
						id={cityId}
						required
						value={value.city}
						onChange={(e) => change({ ...value, city: e.target.value })}
						className="h-10 rounded-lg"
					>
						<NativeSelectOption value="">{t.choose}</NativeSelectOption>
						{destination?.cities.map((c) => (
							<NativeSelectOption key={c}>{c}</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</div>
			<div className="grid min-w-0 gap-1.5">
				<label htmlFor={methodId} className="text-xs font-medium text-muted">
					{t.method}
				</label>
				<NativeSelect
					id={methodId}
					required
					value={value.method}
					onChange={(e) =>
						change({ ...value, method: e.target.value as Choice["method"] })
					}
					className="h-10 rounded-lg"
				>
					<NativeSelectOption value="">{t.choose}</NativeSelectOption>
					{terms.methods.map((m) => (
						<NativeSelectOption value={m} key={m}>
							{t[m]}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
		</fieldset>
	);
}
export { validateLines } from "../validation";
