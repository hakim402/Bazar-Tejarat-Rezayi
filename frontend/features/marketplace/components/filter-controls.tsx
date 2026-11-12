"use client";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { marketplaceCopy } from "../copy";

const MAX = 10000;
const STEP = 50;
const field =
	"min-h-10 w-full min-w-0 rounded-control border border-border bg-page px-3 text-sm text-foreground placeholder:text-muted";
const clamp = (value: number) => Math.min(MAX, Math.max(0, value));

export function PriceRange({
	locale,
	from,
	to,
}: {
	locale: Locale;
	from: string | null;
	to: string | null;
}) {
	const t = marketplaceCopy[locale],
		[fromText, setFromText] = useState(from ?? ""),
		[toText, setToText] = useState(to ?? ""),
		parsedFrom = Number(fromText),
		parsedTo = Number(toText),
		fromNum = clamp(
			fromText.trim() && Number.isFinite(parsedFrom) ? parsedFrom : 0,
		),
		toNum = clamp(toText.trim() && Number.isFinite(parsedTo) ? parsedTo : MAX),
		lo = Math.min(fromNum, toNum),
		hi = Math.max(fromNum, toNum);
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-2">
				<input
					className={field}
					name="min_price"
					type="text"
					inputMode="decimal"
					maxLength={12}
					aria-label={t.min_price}
					placeholder={t.priceFrom}
					value={fromText}
					onChange={(event) => setFromText(event.target.value)}
				/>
				<input
					className={field}
					name="max_price"
					type="text"
					inputMode="decimal"
					maxLength={12}
					aria-label={t.max_price}
					placeholder={t.priceUp}
					value={toText}
					onChange={(event) => setToText(event.target.value)}
				/>
			</div>
			<div className="price-range relative h-5">
				<span
					aria-hidden
					className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border"
				/>
				<span
					aria-hidden
					className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-action"
					style={{
						insetInlineStart: `${(lo / MAX) * 100}%`,
						width: `${((hi - lo) / MAX) * 100}%`,
					}}
				/>
				<input
					type="range"
					min={0}
					max={MAX}
					step={STEP}
					value={lo}
					aria-label={t.min_price}
					style={{ zIndex: fromNum > MAX / 2 ? 5 : 3 }}
					onChange={(event) =>
						setFromText(String(Math.min(Number(event.target.value), toNum)))
					}
				/>
				<input
					type="range"
					min={0}
					max={MAX}
					step={STEP}
					value={hi}
					aria-label={t.max_price}
					style={{ zIndex: 4 }}
					onChange={(event) =>
						setToText(String(Math.max(Number(event.target.value), fromNum)))
					}
				/>
			</div>
		</div>
	);
}

export function SortSelect({
	locale,
	value,
	stores = false,
}: {
	locale: Locale;
	value: string;
	stores?: boolean;
}) {
	const t = marketplaceCopy[locale],
		options = stores
			? (["", "name"] as const)
			: (["", "name", "price_asc", "price_desc"] as const);
	return (
		<label className="relative block w-full shrink-0 min-[480px]:w-48">
			<span className="sr-only">{t.sort}</span>
			<Icon
				name="sliders"
				className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
			/>
			<select
				name="sort"
				defaultValue={value}
				onChange={(event) => event.currentTarget.form?.requestSubmit()}
				className="min-h-11 w-full appearance-none rounded-control border border-border bg-surface pe-8 ps-9 text-sm font-semibold text-foreground"
			>
				{options.map((option) => (
					<option key={option || "default"} value={option}>
						{option ? t[option] : t.newest}
					</option>
				))}
			</select>
			<Icon
				name="chevron-down"
				className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted"
			/>
		</label>
	);
}
