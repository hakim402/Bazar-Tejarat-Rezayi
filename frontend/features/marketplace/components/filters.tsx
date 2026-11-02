import type { Locale } from "../../../lib/i18n/locales";
import { marketplaceCopy } from "../copy";
const control =
	"min-h-11 w-full min-w-0 rounded-control border border-border bg-page px-3 text-foreground";
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
	categoryOptions?: { code: string; name: string }[];
}) {
	const t = marketplaceCopy[locale];
	const selects: [string, string[]][] = stores
		? [["sort", ["newest", "name"]]]
		: [
				["currency", ["AFN", "USD"]],
				["pricing_mode", ["fixed", "negotiable"]],
				["tier", ["retail", "wholesale"]],
				["availability", ["available", "unavailable", "unknown"]],
				["sort", ["newest", "name", "price_asc", "price_desc"]],
			];
	const label = (key: string) =>
		key === "unavailable"
			? t.unavailableStock
			: t[key as keyof typeof t] || key;
	return (
		<details className="rounded-card border border-border bg-surface p-4" open>
			<summary className="min-h-11 cursor-pointer font-bold">
				{t.filters}
			</summary>
			<form
				action={path}
				method="GET"
				className="mt-3 grid min-w-0 gap-4 min-[640px]:grid-cols-3 desktop:grid-cols-4"
			>
				{[
					"q",
					...(stores || category ? [] : ["category"]),
					"country",
					"city",
					...(stores ? [] : ["min_price", "max_price"]),
				].map((key) => (
					<label
						htmlFor={`market-filter-${key}`}
						className="min-w-0 space-y-2 text-sm"
						key={key}
					>
						<span>{label(key)}</span>
						{key === "category" && categoryOptions.length ? (
							<select
								id={`market-filter-${key}`}
								name={key}
								className={control}
								defaultValue={query.get(key) || ""}
							>
								<option value="">{t.all}</option>
								{query.get(key) &&
									!categoryOptions.some(
										(row) => row.code === query.get(key),
									) && (
										<option value={query.get(key) || ""}>
											{query.get(key)}
										</option>
									)}
								{categoryOptions.map((row) => (
									<option key={row.code} value={row.code}>
										{row.name}
									</option>
								))}
							</select>
						) : (
							<input
								id={`market-filter-${key}`}
								className={control}
								name={key}
								type={key === "q" ? "search" : "text"}
								inputMode={key.endsWith("price") ? "decimal" : undefined}
								maxLength={key === "q" ? 100 : 80}
								defaultValue={query.get(key) || ""}
							/>
						)}
					</label>
				))}
				{selects.map(([key, values]) => (
					<label key={key} className="min-w-0 space-y-2 text-sm">
						<span>{label(key)}</span>
						<select
							name={key}
							className={control}
							defaultValue={query.get(key) || ""}
						>
							<option value="">{t.all}</option>
							{values.map((value) => (
								<option key={value} value={value}>
									{label(value)}
								</option>
							))}
						</select>
					</label>
				))}
				<div className="flex flex-wrap items-end gap-3">
					<button
						className="min-h-11 rounded-control bg-action px-5 font-bold text-on-primary"
						type="submit"
					>
						{t.apply}
					</button>
					<a className="inline-flex min-h-11 items-center" href={path}>
						{t.reset}
					</a>
				</div>
			</form>
		</details>
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
	const t = marketplaceCopy[locale];
	const href = (value: number) => {
		const next = new URLSearchParams(query);
		next.set("page", String(value));
		return `${path}?${next}`;
	};
	return (
		<nav aria-label={t.page} className="flex flex-wrap items-center gap-5">
			<p>
				{t.results}: <bdi>{count}</bdi> · {t.page}: <bdi>{page}</bdi>
			</p>
			{page > 1 && (
				<a
					className="inline-flex min-h-11 items-center"
					rel="prev"
					href={href(page - 1)}
				>
					{t.previous}
				</a>
			)}
			{page * pageSize < count && (
				<a
					className="inline-flex min-h-11 items-center"
					rel="next"
					href={href(page + 1)}
				>
					{t.next}
				</a>
			)}
		</nav>
	);
}
