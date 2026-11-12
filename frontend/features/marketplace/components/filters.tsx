import type { ReactNode } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { marketplaceCopy } from "../copy";
import { PriceRange } from "./filter-controls";

export type CategoryOption = { code: string; name: string; count?: number };

function Section({
	title,
	open = false,
	children,
}: {
	title: string;
	open?: boolean;
	children: ReactNode;
}) {
	return (
		<details
			open={open}
			className="group border-b border-border pb-4 last:border-b-0 last:pb-0"
		>
			<summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
				{title}
				<Icon
					name="chevron-down"
					className="size-4 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
				/>
			</summary>
			<div className="pt-3">{children}</div>
		</details>
	);
}

function Choice({
	name,
	value,
	current,
	label,
	count,
	fmt,
}: {
	name: string;
	value: string;
	current: string;
	label: string;
	count?: number;
	fmt: Intl.NumberFormat;
}) {
	return (
		<label className="filter-choice flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
			<input
				type="radio"
				name={name}
				value={value}
				defaultChecked={current === value}
				className="peer sr-only"
			/>
			<span className="filter-choice-box flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border border-control bg-surface text-on-primary transition-colors peer-checked:border-action peer-checked:bg-action">
				<Icon name="check" className="size-3" />
			</span>
			<span className="filter-choice-label min-w-0 flex-1 truncate text-muted">
				{label}
			</span>
			{count !== undefined && (
				<span className="text-xs text-muted">
					<bdi>{fmt.format(count)}</bdi>
				</span>
			)}
		</label>
	);
}

function Group({ label, children }: { label: string; children: ReactNode }) {
	return (
		<fieldset className="space-y-1">
			<legend className="mb-1 text-xs font-bold text-muted">{label}</legend>
			{children}
		</fieldset>
	);
}

const field =
	"min-h-10 w-full min-w-0 rounded-control border border-border bg-page px-3 text-sm text-foreground placeholder:text-muted";

export function Filters({
	locale,
	path,
	query,
	stores = false,
	category = false,
	categoryOptions = [],
}: {
	locale: Locale;
	path: string;
	query: URLSearchParams;
	stores?: boolean;
	category?: boolean;
	categoryOptions?: CategoryOption[];
}) {
	const t = marketplaceCopy[locale],
		fmt = new Intl.NumberFormat(locale),
		current = (key: string) => query.get(key) ?? "";
	return (
		<aside className="filter-scroll hidden rounded-card border border-border bg-surface p-4 shadow-card max-desktop:peer-checked:mt-3 peer-checked:block sm:p-5 desktop:block desktop:max-h-[calc(100vh-8rem)] desktop:overflow-y-auto">
			<div className="space-y-4">
				{!stores && (
					<Section title={t.price} open>
						<PriceRange
							locale={locale}
							from={query.get("min_price")}
							to={query.get("max_price")}
						/>
					</Section>
				)}
				{!stores && !category && categoryOptions.length > 0 && (
					<Section title={t.category} open>
						<div className="filter-scroll max-h-64 space-y-1 overflow-y-auto pe-1">
							<Choice
								name="category"
								value=""
								current={current("category")}
								label={t.all}
								fmt={fmt}
							/>
							{categoryOptions.map((option) => (
								<Choice
									key={option.code}
									name="category"
									value={option.code}
									current={current("category")}
									label={option.name}
									count={option.count}
									fmt={fmt}
								/>
							))}
						</div>
					</Section>
				)}
				{!stores && (
					<Section title={t.availability} open>
						<div className="space-y-1">
							<Choice
								name="availability"
								value=""
								current={current("availability")}
								label={t.all}
								fmt={fmt}
							/>
							{(["available", "unavailable", "unknown"] as const).map(
								(value) => (
									<Choice
										key={value}
										name="availability"
										value={value}
										current={current("availability")}
										label={
											value === "unavailable" ? t.unavailableStock : t[value]
										}
										fmt={fmt}
									/>
								),
							)}
						</div>
					</Section>
				)}
				{!stores && (
					<Section title={t.pricing_mode}>
						<div className="space-y-4">
							<Group label={t.currency}>
								<Choice
									name="currency"
									value=""
									current={current("currency")}
									label={t.all}
									fmt={fmt}
								/>
								{(["AFN", "USD"] as const).map((value) => (
									<Choice
										key={value}
										name="currency"
										value={value}
										current={current("currency")}
										label={value}
										fmt={fmt}
									/>
								))}
							</Group>
							<Group label={t.pricing_mode}>
								<Choice
									name="pricing_mode"
									value=""
									current={current("pricing_mode")}
									label={t.all}
									fmt={fmt}
								/>
								{(["fixed", "negotiable"] as const).map((value) => (
									<Choice
										key={value}
										name="pricing_mode"
										value={value}
										current={current("pricing_mode")}
										label={t[value]}
										fmt={fmt}
									/>
								))}
							</Group>
							<Group label={t.tier}>
								<Choice
									name="tier"
									value=""
									current={current("tier")}
									label={t.all}
									fmt={fmt}
								/>
								{(["retail", "wholesale"] as const).map((value) => (
									<Choice
										key={value}
										name="tier"
										value={value}
										current={current("tier")}
										label={t[value]}
										fmt={fmt}
									/>
								))}
							</Group>
						</div>
					</Section>
				)}
				<Section title={t.location} open={stores}>
					<div className="grid gap-3">
						<label className="space-y-1.5 text-xs font-semibold text-muted">
							<span>{t.country}</span>
							<input
								className={field}
								name="country"
								type="text"
								maxLength={80}
								defaultValue={current("country")}
							/>
						</label>
						<label className="space-y-1.5 text-xs font-semibold text-muted">
							<span>{t.city}</span>
							<input
								className={field}
								name="city"
								type="text"
								maxLength={80}
								defaultValue={current("city")}
							/>
						</label>
					</div>
				</Section>
				<div className="flex items-center gap-2 border-t border-border pt-4">
					<button
						type="submit"
						className="min-h-11 flex-1 cursor-pointer rounded-control bg-primary px-4 text-sm font-bold text-on-primary shadow-sm transition-opacity hover:opacity-90"
					>
						{t.apply}
					</button>
					<a
						href={path}
						aria-label={t.reset}
						title={t.reset}
						className="flex size-11 shrink-0 items-center justify-center rounded-control border border-border bg-surface text-muted no-underline transition-colors hover:border-danger/50 hover:text-danger"
					>
						<Icon name="trash" className="size-4" />
					</a>
				</div>
			</div>
		</aside>
	);
}

export function FilterChips({
	locale,
	path,
	query,
	categoryOptions = [],
}: {
	locale: Locale;
	path: string;
	query: URLSearchParams;
	categoryOptions?: CategoryOption[];
}) {
	const t = marketplaceCopy[locale],
		entries = [...query].filter(
			([key, value]) => key !== "page" && key !== "sort" && !!value,
		);
	if (!entries.length) return null;
	const labelFor = (key: string, value: string) => {
		if (key === "category")
			return (
				categoryOptions.find((option) => option.code === value)?.name ?? value
			);
		if (key === "availability")
			return value === "unavailable"
				? t.unavailableStock
				: (t[value as keyof typeof t] ?? value);
		if (key === "pricing_mode" || key === "tier")
			return t[value as keyof typeof t] ?? value;
		if (key === "min_price") return `${t.priceFrom} ${value}`;
		if (key === "max_price") return `${t.priceUp} ${value}`;
		return value;
	};
	const hrefWithout = (key: string) => {
		const next = new URLSearchParams(query);
		next.delete(key);
		next.delete("page");
		const rest = next.toString();
		return rest ? `${path}?${rest}` : path;
	};
	const sort = query.get("sort");
	return (
		<div className="order-4 flex flex-wrap items-center gap-2">
			{entries.map(([key, value]) => (
				<a
					key={`${key}:${value}`}
					href={hrefWithout(key)}
					aria-label={`${t.removeFilter}: ${labelFor(key, value)}`}
					className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-page px-3 text-xs font-semibold text-foreground no-underline transition-colors hover:border-action/50"
				>
					<span className="max-w-40 truncate">{labelFor(key, value)}</span>
					<Icon name="close" className="size-3 text-muted" />
				</a>
			))}
			<a
				href={sort ? `${path}?sort=${encodeURIComponent(sort)}` : path}
				className="ms-1 inline-flex min-h-8 items-center text-xs font-bold text-action underline underline-offset-4"
			>
				{t.clearAll}
			</a>
		</div>
	);
}

export function Pagination({
	locale,
	path,
	query,
	page,
	count,
	pageSize,
}: {
	locale: Locale;
	path: string;
	query: URLSearchParams;
	page: number;
	count: number;
	pageSize: number;
}) {
	const t = marketplaceCopy[locale],
		fmt = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }),
		pages = Math.max(1, Math.ceil(count / pageSize)),
		href = (value: number) => {
			const next = new URLSearchParams(query);
			if (value <= 1) next.delete("page");
			else next.set("page", String(value));
			const rest = next.toString();
			return rest ? `${path}?${rest}` : path;
		},
		numbers =
			pages <= 7
				? Array.from({ length: pages }, (_, index) => index + 1)
				: [
						...new Set(
							[1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(
								(value) => value >= 1 && value <= pages,
							),
						),
					].sort((a, b) => a - b),
		cells: (number | string)[] = [];
	for (const value of numbers) {
		const previous = cells[cells.length - 1];
		if (typeof previous === "number" && value - previous > 1)
			cells.push(`gap-${previous}`);
		cells.push(value);
	}
	const cell =
		"flex min-h-12 min-w-12 items-center justify-center border-s border-border px-3 text-sm font-semibold text-foreground no-underline transition-colors first:border-s-0 hover:bg-page";
	return (
		<nav
			aria-label={t.page}
			className="order-6 flex flex-wrap items-stretch justify-center overflow-hidden rounded-card border border-border bg-surface shadow-card"
		>
			{page > 1 ? (
				<a className={cell} rel="prev" href={href(page - 1)}>
					{t.previous}
				</a>
			) : (
				<span className={`${cell} opacity-40`} aria-disabled="true">
					{t.previous}
				</span>
			)}
			{cells.map((value) =>
				typeof value === "string" ? (
					<span key={value} className={`${cell} text-muted`}>
						…
					</span>
				) : value === page ? (
					<span key={value} className={cell}>
						<span
							aria-current="page"
							className="flex size-9 items-center justify-center rounded-full bg-primary font-bold text-on-primary"
						>
							{fmt.format(value)}
						</span>
					</span>
				) : (
					<a key={value} className={cell} href={href(value)}>
						{fmt.format(value)}
					</a>
				),
			)}
			{page < pages ? (
				<a className={cell} rel="next" href={href(page + 1)}>
					{t.next}
				</a>
			) : (
				<span className={`${cell} opacity-40`} aria-disabled="true">
					{t.next}
				</span>
			)}
		</nav>
	);
}
