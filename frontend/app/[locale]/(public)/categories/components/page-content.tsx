import type { Locale } from "../../../../../lib/i18n/locales";
import {
	MarketplaceShell,
	readMarketplace,
	Feedback,
	marketMetadata,
	type Search,
} from "../../../../../features/marketplace/server";
import { queryString } from "../../../../../features/marketplace/api";
import type {
	CategoryPage,
	CategoryRow,
} from "../../../../../features/marketplace/types";
import { marketplaceCopy } from "../../../../../features/marketplace/copy";
import { Pagination } from "../../../../../features/marketplace/components/filters";
import { CategoryMedia } from "../../../../../features/marketplace/components/cards";
import { Icon, iconName } from "../../../../../components/ui/icon";
export async function metadataFor(locale: Locale, _p: unknown, search: Search) {
	return marketMetadata(
		locale,
		"/categories",
		marketplaceCopy[locale].categories,
		"",
		Object.keys(search).length > 0,
	);
}
export async function PageContent({
	locale,
	search,
}: {
	locale: Locale;
	search: Search;
	params: unknown;
}) {
	const t = marketplaceCopy[locale],
		query = queryString(search),
		result = await readMarketplace<CategoryPage>(
			locale,
			`categories/?${query}`,
		);
	return (
		<MarketplaceShell locale={locale}>
			<h1 className="text-3xl">{t.categories}</h1>
			{result.data ? (
				<>
					<div className="grid gap-4 min-[520px]:grid-cols-2 desktop:grid-cols-4">
						{(result.data.results as CategoryRow[]).map((row) => (
							<a
								key={row.code}
								className="group flex flex-col items-center rounded-3xl border border-border bg-surface p-5 text-center text-foreground no-underline transition-colors hover:border-action"
								href={`/${locale}/categories/${row.code}`}
							>
								<span className="relative mb-3 block h-28 w-full">
									<CategoryMedia
										category={row}
										className="h-28 w-full transition-transform motion-safe:group-hover:scale-105"
									/>
									{row.image && (
										<span className="absolute start-2 top-2 inline-flex size-8 items-center justify-center rounded-full bg-surface/85 text-action backdrop-blur-sm">
											<Icon name={iconName(row.icon)} className="size-4" />
										</span>
									)}
								</span>
								<h2 className="text-xl">{row.name}</h2>
								<p className="mt-1 text-sm text-muted">
									{t.products}: <bdi>{row.count}</bdi>
								</p>
							</a>
						))}
					</div>
					{!result.data.results.length && <p>{t.noCategory}</p>}
					<Pagination
						locale={locale}
						path={`/${locale}/categories`}
						query={new URLSearchParams(query)}
						page={result.data.page}
						count={result.data.count}
						pageSize={result.data.page_size}
					/>
				</>
			) : (
				<Feedback locale={locale} status={result.status} />
			)}
		</MarketplaceShell>
	);
}
