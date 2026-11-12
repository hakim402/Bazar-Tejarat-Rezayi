import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "../../lib/api/client";
import { locales, type Locale } from "../../lib/i18n/locales";
import { PublicShell } from "../../components/layout/public-shell";
import { readSite } from "../site/server";
import { indexingAllowed, publicOrigin } from "../pages/metadata";
import { publicRequest, queryString } from "./api";
import { marketplaceCopy } from "./copy";
import {
	Filters,
	FilterChips,
	Pagination,
	type CategoryOption,
} from "./components/filters";
import { SortSelect } from "./components/filter-controls";
import { ProductGrid, StoreCard } from "./components/cards";
import { Icon } from "../../components/ui/icon";
import type { ProductPage, StorePage, CategoryPage } from "./types";
import { RetryButton } from "./components/retry-button";
export type Search = Record<string, string | string[] | undefined>;
export const readMarketplace = cache(
	async <T,>(
		locale: Locale,
		path: string,
	): Promise<{ data: T | null; status: number }> => {
		try {
			return { data: await publicRequest<T>(locale, path), status: 200 };
		} catch (e) {
			return {
				data: null,
				status: e instanceof ApiError ? e.status || 503 : 503,
			};
		}
	},
);
export async function MarketplaceShell({
	locale,
	children,
}: {
	locale: Locale;
	children: React.ReactNode;
}) {
	return (
		<PublicShell locale={locale} site={await readSite(locale)}>
			{children}
		</PublicShell>
	);
}
export function Feedback({
	locale,
	status,
}: {
	locale: Locale;
	status: number;
}) {
	const t = marketplaceCopy[locale];
	return (
		<div
			role="alert"
			className="space-y-4 rounded-card border border-border bg-surface p-5"
		>
			<p>{status === 400 ? t.invalid : t.unavailable}</p>
			<RetryButton label={t.retry} />
		</div>
	);
}
function facetCategories(facets: unknown): string[] | null {
	if (!facets || typeof facets !== "object") return null;
	const codes = (facets as Record<string, unknown>).categories;
	return Array.isArray(codes) && codes.every((code) => typeof code === "string")
		? codes
		: null;
}
export async function Discovery({
	locale,
	path,
	apiPath,
	search,
	title,
	stores = false,
	category = false,
}: {
	locale: Locale;
	path: string;
	apiPath: string;
	search: Search;
	title: string;
	stores?: boolean;
	category?: boolean;
}) {
	const query = queryString(search),
		result = await readMarketplace<ProductPage | StorePage>(
			locale,
			`${apiPath}${query ? `?${query}` : ""}`,
		),
		t = marketplaceCopy[locale],
		fmt = new Intl.NumberFormat(locale);
	if (result.status === 404) notFound();
	const storeScope =
			apiPath.startsWith("stores/") && apiPath.endsWith("/products/"),
		[categoryResult, storeFacets] = await Promise.all([
			stores || category
				? null
				: readMarketplace<CategoryPage>(locale, "categories/"),
			storeScope ? readMarketplace<ProductPage>(locale, apiPath) : null,
		]);
	let categoryOptions: CategoryOption[] = categoryResult?.data?.results ?? [];
	if (storeScope) {
		const codes = facetCategories(storeFacets?.data?.facets);
		categoryOptions = codes
			? codes.map((code) => ({
					code,
					name: categoryOptions.find((row) => row.code === code)?.name ?? code,
				}))
			: [];
	}
	const data = result.data,
		params = new URLSearchParams(query),
		activeCount = [...params].filter(
			([key, value]) => key !== "page" && key !== "sort" && !!value,
		).length,
		hasFilters = activeCount > 0,
		Heading = storeScope ? "h2" : "h1";
	return (
		<section className="space-y-6" data-testid="marketplace-list">
			<form
				key={`${path}?${query}`}
				action={path}
				method="GET"
				className="grid items-start gap-4 desktop:grid-cols-[17rem_minmax(0,1fr)] desktop:gap-6"
			>
				<div className="filter-disclosure order-3 min-w-0 desktop:order-none">
					<input
						id="market-filter-toggle"
						type="checkbox"
						className="peer sr-only"
					/>
					<label
						htmlFor="market-filter-toggle"
						className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-bold text-foreground transition-colors peer-checked:border-action/60 peer-checked:text-action desktop:hidden"
					>
						<Icon name="sliders" className="size-4" />
						{t.filters}
						{activeCount > 0 && (
							<span className="rounded-full bg-info px-2 py-0.5 text-xs font-bold text-action">
								<bdi>{fmt.format(activeCount)}</bdi>
							</span>
						)}
						<Icon
							name="chevron-down"
							className="filter-toggle-chevron size-4 text-muted transition-transform motion-reduce:transition-none"
						/>
					</label>
					<Filters
						locale={locale}
						path={path}
						query={params}
						stores={stores}
						category={category}
						categoryOptions={categoryOptions}
					/>
				</div>
				<div className="contents desktop:block desktop:min-w-0 desktop:space-y-5">
					<div className="order-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
						<Heading
							className={
								Heading === "h1" ? "text-3xl font-bold" : "text-2xl font-bold"
							}
						>
							{category && data && "category" in data && data.category
								? data.category.name
								: title}
						</Heading>
						{data && (
							<p className="text-sm text-muted">
								{t.results}: <bdi>{fmt.format(data.count)}</bdi>
							</p>
						)}
					</div>
					<div className="order-2 flex flex-wrap gap-3">
						<label className="relative min-w-0 flex-1 basis-64">
							<span className="sr-only">{t.q}</span>
							<Icon
								name="search"
								className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
							/>
							<input
								name="q"
								type="search"
								maxLength={100}
								defaultValue={params.get("q") ?? ""}
								placeholder={t.searchProducts}
								className="min-h-11 w-full rounded-control border border-border bg-surface pe-3 ps-9 text-foreground placeholder:text-muted"
							/>
						</label>
						<SortSelect
							locale={locale}
							value={params.get("sort") ?? ""}
							stores={stores}
						/>
					</div>
					<FilterChips
						locale={locale}
						path={path}
						query={params}
						categoryOptions={categoryOptions}
					/>
					{data ? (
						<>
							{data.results.length ? (
								stores ? (
									<div className="order-5 grid min-w-0 gap-4 min-[640px]:grid-cols-2 min-[1200px]:grid-cols-3">
										{(data as StorePage).results.map((store) => (
											<StoreCard key={store.id} store={store} locale={locale} />
										))}
									</div>
								) : (
									<ProductGrid
										products={(data as ProductPage).results}
										locale={locale}
									/>
								)
							) : (
								<div
									role="status"
									className="order-5 space-y-2 rounded-card border border-border bg-surface p-6 text-center"
								>
									<p>
										{hasFilters || data.page > 1
											? t.noMatches
											: stores
												? t.noStores
												: t.empty}
									</p>
									{hasFilters && (
										<a
											href={path}
											className="inline-flex min-h-11 items-center font-bold text-action underline underline-offset-4"
										>
											{t.clearAll}
										</a>
									)}
								</div>
							)}
							<Pagination
								locale={locale}
								path={path}
								query={params}
								page={data.page}
								count={data.count}
								pageSize={data.page_size}
							/>
						</>
					) : (
						<div className="order-5 min-w-0">
							<Feedback locale={locale} status={result.status} />
						</div>
					)}
				</div>
			</form>
		</section>
	);
}
export async function marketMetadata(
	locale: Locale,
	path: string,
	title: string,
	description: string,
	search = false,
	image?: string,
): Promise<Metadata> {
	const site = await readSite(locale),
		index =
			!!site?.indexing &&
			!site.maintenance.enabled &&
			indexingAllowed() &&
			!search;
	const override = site?.seo.find((row) => `/${row.page}` === path);
	title = override?.title || title;
	description = override?.description || description;
	const canonical = `${publicOrigin}/${locale}${path}`;
	return {
		title,
		description: description.slice(0, 400),
		robots: { index, follow: index },
		alternates: {
			canonical,
			languages: Object.fromEntries(
				locales.map((code) => [code, `${publicOrigin}/${code}${path}`]),
			),
		},
		openGraph: {
			title,
			description: description.slice(0, 400),
			url: canonical,
			type: "website",
			locale,
			images: image ? [image] : undefined,
		},
	};
}
export function Breadcrumbs({
	locale,
	items,
}: {
	locale: Locale;
	items: { name: string; path: string }[];
}) {
	const t = marketplaceCopy[locale],
		crumbs = [{ name: t.home, path: "" }, ...items],
		data = {
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: crumbs.map((item, index) => ({
				"@type": "ListItem",
				position: index + 1,
				name: item.name,
				item: `${publicOrigin}/${locale}${item.path}`,
			})),
		};
	return (
		<>
			<nav
				className="flex flex-wrap items-center gap-1 text-sm"
				aria-label={t.breadcrumbs}
			>
				{crumbs.map((item, index) => {
					const last = index === crumbs.length - 1;
					return (
						<span
							key={item.path || "home"}
							className="flex min-w-0 items-center gap-1"
						>
							{index > 0 && (
								<Icon
									name="chevron"
									className="size-3.5 shrink-0 text-muted/70"
								/>
							)}
							{last ? (
								<span
									aria-current="page"
									className="inline-flex min-h-8 min-w-0 items-center rounded-full bg-info px-3 font-semibold text-action"
								>
									<span className="max-w-48 truncate">{item.name}</span>
								</span>
							) : (
								<a
									href={`/${locale}${item.path}`}
									className="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-muted no-underline transition-colors hover:bg-info hover:text-action"
								>
									{index === 0 && <Icon name="home" className="size-3.5" />}
									<span className="max-w-40 truncate">{item.name}</span>
								</a>
							)}
						</span>
					);
				})}
			</nav>
			<script type="application/ld+json">
				{JSON.stringify(data).replaceAll("<", "\\u003c")}
			</script>
		</>
	);
}
