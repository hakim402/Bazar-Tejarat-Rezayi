import type { Locale } from "../../../../../lib/i18n/locales";
import {
	MarketplaceShell,
	Discovery,
	marketMetadata,
	type Search,
} from "../../../../../features/marketplace/server";
import { marketplaceCopy } from "../../../../../features/marketplace/copy";
export async function metadataFor(
	locale: Locale,
	_p: { locale?: string; category?: string },
	_search: Search,
) {
	return marketMetadata(
		locale,
		`/search`,
		marketplaceCopy[locale].search,
		"",
		true,
	);
}
export function PageContent({
	locale,
	search,
}: {
	locale: Locale;
	params: { locale?: string; category?: string };
	search: Search;
}) {
	const path = `/${locale}/search`;
	return (
		<MarketplaceShell locale={locale}>
			<Discovery
				locale={locale}
				path={path}
				apiPath={"products/"}
				search={search}
				title={marketplaceCopy[locale].search}
			/>
		</MarketplaceShell>
	);
}
