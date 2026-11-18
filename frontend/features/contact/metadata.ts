import type { Metadata } from "next";
import { locales, type Locale } from "../../lib/i18n/locales";
import { indexingAllowed, publicOrigin } from "../pages/metadata";
import { readSite } from "../site/server";
import { contactCopy } from "./copy";

export async function contactMetadata(locale: Locale): Promise<Metadata> {
	const site = await readSite(locale),
		t = contactCopy[locale];
	const override = site?.seo.find((row) => row.page === "contact");
	const title = override?.title || t.eyebrow;
	const description = override?.description || t.intro;
	const canonical = `${publicOrigin}/${locale}/contact`;
	const image = override?.image ?? site?.og_image;
	const images = image
		? [{ url: image.url, width: image.width, height: image.height }]
		: undefined;
	const index =
		!!site && site.indexing && !site.maintenance.enabled && indexingAllowed();
	return {
		title,
		description,
		metadataBase: new URL(publicOrigin),
		robots: { index, follow: index },
		alternates: {
			canonical,
			languages: Object.fromEntries(
				locales.map((code) => [code, `${publicOrigin}/${code}/contact`]),
			),
		},
		openGraph: {
			title,
			description,
			url: canonical,
			type: "website",
			siteName: site?.identity.name,
			locale,
			images,
		},
		twitter: {
			card: images ? "summary_large_image" : "summary",
			title,
			description,
			images: images?.map((row) => row.url),
		},
		icons: site?.favicon ? { icon: site.favicon.url } : undefined,
	};
}
