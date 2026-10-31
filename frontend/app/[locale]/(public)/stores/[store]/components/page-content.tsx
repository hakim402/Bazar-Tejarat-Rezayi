import type { Locale } from "../../../../../../lib/i18n/locales";
import { notFound } from "next/navigation";
import {
	readMarketplace,
	Discovery,
	marketMetadata,
	type Search,
} from "../../../../../../features/marketplace/server";
import type { PublicStore } from "../../../../../../features/marketplace/types";
import { marketplaceCopy } from "../../../../../../features/marketplace/copy";
import { StoreShell } from "./store-shell";
export async function metadataFor(
	locale: Locale,
	p: { store: string },
	search: Search,
) {
	const r = await readMarketplace<PublicStore>(locale, `stores/${p.store}/`);
	if (r.status === 404) notFound();
	if (!r.data)
		return {
			robots: { index: false, follow: false },
			title: marketplaceCopy[locale].unavailable,
		};
	return marketMetadata(
		locale,
		`/stores/${p.store}`,
		r.data.name,
		r.data.description,
		Object.keys(search).length > 0,
	);
}
export async function PageContent({
	locale,
	params,
	search,
}: {
	locale: Locale;
	params: { store: string };
	search: Search;
}) {
	const t = marketplaceCopy[locale];
	return (
		<StoreShell locale={locale} id={params.store}>
			<Discovery
				locale={locale}
				path={`/${locale}/stores/${params.store}`}
				apiPath={`stores/${params.store}/products/`}
				search={search}
				title={t.products}
			/>
		</StoreShell>
	);
}
