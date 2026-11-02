import type { Locale } from "../../../../../../../lib/i18n/locales";
import { notFound } from "next/navigation";
import {
	readMarketplace,
	marketMetadata,
	type Search,
} from "../../../../../../../features/marketplace/server";
import type { PublicStore } from "../../../../../../../features/marketplace/types";
import { marketplaceCopy } from "../../../../../../../features/marketplace/copy";
import { StoreShell } from "../../components/store-shell";
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
		`/stores/${p.store}/reviews`,
		r.data.name,
		r.data.description,
		Object.keys(search).length > 0 || true,
	);
}
export async function PageContent({
	locale,
	params,
}: {
	locale: Locale;
	params: { store: string };
	search: Search;
}) {
	const t = marketplaceCopy[locale];
	return (
		<StoreShell locale={locale} id={params.store}>
			<section className="space-y-4 rounded-card border border-border bg-surface p-5">
				<h2 className="text-2xl">{t.reviews}</h2>
				<p>{t.reviewsLater}</p>
			</section>
		</StoreShell>
	);
}
