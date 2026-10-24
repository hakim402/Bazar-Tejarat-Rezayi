import type { Metadata } from "next";
import { locales, type Locale } from "../../lib/i18n/locales";
import { readSite } from "../site/server";
import { pageCopy } from "./copy";
import { pages, type PageKey } from "./registry";
export const publicOrigin = "https://bazartejaratrezayi.com";
export function indexingAllowed() {
	return (
		process.env.NODE_ENV === "production" &&
		process.env.API_INTERNAL_URL === "https://api.bazartejaratrezayi.com"
	);
}
export async function pageMetadata(
	locale: Locale,
	key: PageKey,
): Promise<Metadata> {
	const site = await readSite(locale),
		copy = pageCopy[locale][key],
		override = site?.seo.find((row) => row.page === key),
		name = site?.identity.name ?? "",
		template = site?.identity.title_template ?? "{page}";
	const title =
			override?.title ||
			template.replaceAll("{page}", copy.title).replaceAll("{site}", name),
		description =
			override?.description ||
			(key === "home" ? site?.identity.description : undefined) ||
			copy.intro ||
			site?.identity.description;
	const canonical = `${publicOrigin}/${locale}${pages[key].path}`,
		image = override?.image ?? site?.og_image,
		images = image
			? [
					{
						url: new URL(image.url, publicOrigin).href,
						width: image.width,
						height: image.height,
					},
				]
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
				locales.map((code) => [
					code,
					`${publicOrigin}/${code}${pages[key].path}`,
				]),
			),
		},
		openGraph: {
			title,
			description,
			url: canonical,
			type: "website",
			siteName: name,
			locale,
			images,
		},
		twitter: {
			card: images ? "summary_large_image" : "summary",
			title,
			description,
			images: images?.map((image) => image.url),
		},
		icons: site?.favicon ? { icon: site.favicon.url } : undefined,
	};
}
