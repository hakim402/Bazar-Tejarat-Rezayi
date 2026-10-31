import type { Locale } from "../../../../../../lib/i18n/locales";
import {
	MarketplaceShell,
	Discovery,
	marketMetadata,
	readMarketplace,
	type Search,
} from "../../../../../../features/marketplace/server";
import { marketplaceCopy } from "../../../../../../features/marketplace/copy";
import type { ProductPage } from "../../../../../../features/marketplace/types";
export async function metadataFor(
	locale: Locale,
	p: { category?: string },
	search: Search,
) {
	const result = await readMarketplace<ProductPage>(
		locale,
		`categories/${p.category}/`,
	);
	if (!result.data)
		return {
			robots: { index: false, follow: false },
			title: marketplaceCopy[locale].unavailable,
		};
	return marketMetadata(
		locale,
		`/categories/${p.category}`,
		result.data.category?.name || marketplaceCopy[locale].categories,
		"",
		Object.keys(search).length > 0,
	);
}
export function PageContent({
	locale,
	params,
	search,
}: {
	locale: Locale;
	params: { category?: string };
	search: Search;
}) {
	const path = `/${locale}/categories/${params.category}`;
	return (
		<MarketplaceShell locale={locale}>
			<Discovery
				locale={locale}
				path={path}
				apiPath={`categories/${params.category}/`}
				search={search}
				title={marketplaceCopy[locale].categories}
				category
			/>
		</MarketplaceShell>
	);
}
