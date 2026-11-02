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
	search: Search,
) {
	return marketMetadata(
		locale,
		`/stores`,
		marketplaceCopy[locale].stores,
		"",
		Object.keys(search).length > 0,
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
	const path = `/${locale}/stores`;
	return (
		<MarketplaceShell locale={locale}>
			<Discovery
				locale={locale}
				path={path}
				apiPath={"stores/"}
				search={search}
				title={marketplaceCopy[locale].stores}
				stores
			/>
		</MarketplaceShell>
	);
}
