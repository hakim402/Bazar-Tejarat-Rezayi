"use client";
import { useId, useState, useRef } from "react";
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
		seller = presentation === "seller",
		control = seller ? salesControl : buyerControl,
		panel = seller ? salesPanel : buyerPanel,
		errorId = useId();
	const [touched, setTouched] = useState(false);
	const explicitPrices = useRef(new Set<string>());
	return (
		<div className="space-y-3">
			{lines.map((line, i) => (
				<fieldset
					key={`${line.variant}:${commerceCopy[locale][line.tier]}`}
					className={panel}
					disabled={disabled}
				>
					<legend
						className={
							seller
								? "max-w-full break-words px-2 text-sm font-semibold"
								: "max-w-full break-all text-sm"
						}
					>
						<span dir="auto">{labels[line.variant] ?? line.variant}</span> ·{" "}
						{commerceCopy[locale][line.tier]}
					</legend>
					{metadata[line.variant] && (
						<p className="mb-3 text-sm text-muted">
							<bdi>{metadata[line.variant].unit}</bdi> ·{" "}
							{commerceCopy[locale].increment}:{" "}
							<bdi>{metadata[line.variant].increment}</bdi>
							{line.tier === "wholesale" && (
								<>
									{" "}
									· {commerceCopy[locale].minimum}:{" "}
									<bdi>{metadata[line.variant].minimum}</bdi>
								</>
							)}
						</p>
					)}
					<div className="grid gap-3 sm:grid-cols-2">
						{(
							[
								"quantity",
								"unit_price",
								...(limits ? [] : ["max_quantity", "max_unit_price"]),
							] as (keyof Line)[]
						).map((key) => (
							<label key={key} className="grid gap-2">
								{key === "quantity"
									? t.quantity
									: key === "unit_price"
										? `${t.offer} · ${currency}`
										: key === "max_quantity"
											? t.maxQuantity
											: `${t.maxPrice} · ${currency}`}
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
									onChange={(e) => {
										const next = { ...line, [key]: e.target.value };
										const identity = `${line.variant}:${line.tier}`;
										if (key === "max_unit_price")
											explicitPrices.current.add(identity);
										if (
											key === "unit_price" &&
											prefillLimits &&
											!limits &&
											!explicitPrices.current.has(identity) &&
											line.max_unit_price === line.unit_price
										)
											next.max_unit_price = e.target.value;
										change(lines.map((v, n) => (n === i ? next : v)));
									}}
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
					<p
						className={
							seller
								? "rounded-xl bg-info p-3 text-sm font-semibold"
								: undefined
						}
					>
						{commerceCopy[locale].goods}:{" "}
						<bdi>
							{moneyText(lineCents(line))} {currency}
						</bdi>
					</p>
					{limits &&
						(seller ? (
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
						) : (
							<p className="text-sm text-muted">
								{t.limits}:{" "}
								<bdi>
									{line.max_quantity} {metadata[line.variant]?.unit} ·{" "}
									{line.max_unit_price} {currency}
								</bdi>
							</p>
						))}
				</fieldset>
			))}
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
	return (
		<fieldset
			className={
				seller
					? `${salesPanel} grid gap-3 space-y-0! sm:grid-cols-3`
					: "grid gap-3 sm:grid-cols-3"
			}
			disabled={disabled}
		>
			<legend className={seller ? "px-2 text-base font-semibold" : undefined}>
				{t.terms}
			</legend>
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
export { validateLines } from "../validation";
