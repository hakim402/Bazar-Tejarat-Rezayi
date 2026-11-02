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
import { Filters, Pagination } from "./components/filters";
import { ProductGrid, StoreCard } from "./components/cards";
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
		t = marketplaceCopy[locale];
	if (result.status === 404) notFound();
	const categoryOptions =
		stores || category
			? []
			: (await readMarketplace<CategoryPage>(locale, "categories/")).data
					?.results || [];
	const data = result.data,
		params = new URLSearchParams(query),
		hasFilters = [...params].some(
			([key, value]) => key !== "page" && key !== "sort" && !!value,
		);
	const Heading =
		apiPath.startsWith("stores/") && apiPath.endsWith("/products/")
			? "h2"
			: "h1";
	return (
		<section className="space-y-6" data-testid="marketplace-list">
			<Heading className="text-3xl font-bold">
				{category && data && "category" in data && data.category
					? data.category.name
					: title}
			</Heading>
			<Filters
				key={`${path}?${query}`}
				locale={locale}
				path={path}
				query={params}
				stores={stores}
				category={category}
				categoryOptions={categoryOptions}
			/>
			{data ? (
				<>
					<Pagination
						locale={locale}
						path={path}
						query={params}
						page={data.page}
						count={data.count}
						pageSize={data.page_size}
					/>
					{data.results.length ? (
						stores ? (
							<div className="grid min-w-0 gap-4 min-[640px]:grid-cols-2 desktop:grid-cols-3">
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
						<p role="status">
							{hasFilters || data.page > 1
								? t.noMatches
								: stores
									? t.noStores
									: t.empty}
						</p>
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
				<Feedback locale={locale} status={result.status} />
			)}
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
	const data = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: `${publicOrigin}/${locale}${item.path}`,
		})),
	};
	return (
		<>
			<nav
				className="flex flex-wrap gap-3 text-sm"
				aria-label={marketplaceCopy[locale].categories}
			>
				{items.map((item) => (
					<a
						className="inline-flex min-h-11 items-center"
						key={item.path}
						href={`/${locale}${item.path}`}
					>
						{item.name}
					</a>
				))}
			</nav>
			<script type="application/ld+json">
				{JSON.stringify(data).replaceAll("<", "\\u003c")}
			</script>
		</>
	);
}
