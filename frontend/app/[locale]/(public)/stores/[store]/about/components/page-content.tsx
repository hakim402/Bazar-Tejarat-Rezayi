import type { Locale } from "../../../../../../../lib/i18n/locales";
import { direction } from "../../../../../../../lib/i18n/locales";
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
		`/stores/${p.store}/about`,
		r.data.name,
		r.data.description,
		Object.keys(search).length > 0,
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
	const result = await readMarketplace<PublicStore>(
			locale,
			`stores/${params.store}/`,
		),
		s = result.data;
	return (
		<StoreShell locale={locale} id={params.store} tab="about">
			<section className="space-y-4 rounded-card border border-border bg-surface p-5">
				<h2 className="text-2xl">{t.about}</h2>
				{s?.source_fallback && (
					<p className="text-sm text-muted">{t.fallback}</p>
				)}
				<p
					className="whitespace-pre-wrap break-words"
					lang={s?.resolved_locale}
					dir={direction((s?.resolved_locale || locale) as Locale)}
				>
					{s?.description || t.noAbout}
				</p>
				<p>
					{s?.city} {s?.country}
				</p>
				<p className="text-sm text-muted">{t.locationNote}</p>
			</section>
		</StoreShell>
	);
}
