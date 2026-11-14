import type { Metadata } from "next";
import { locales, type Locale } from "../../lib/i18n/locales";
import type { Site } from "../site/contract";
import { readSite } from "../site/server";
import { heroUI } from "../site/ui";
import { readPage } from "./api";
export const publicOrigin = "https://bazartejaratrezayi.com";
export function indexingAllowed() {
	return (
		process.env.NODE_ENV === "production" &&
		process.env.API_INTERNAL_URL === "https://api.bazartejaratrezayi.com"
	);
}
function buildMetadata({
	locale,
	site,
	page,
	title,
	description,
	path,
	image,
}: {
	locale: Locale;
	site: Site | null;
	page: string;
	title: string;
	description: string;
	path: string;
	image?: { url: string; width: number; height: number } | null;
}): Metadata {
	const name = site?.identity.name ?? "",
		override = site?.seo.find((row) => row.page === page),
		finalTitle = override?.title || title,
		finalDescription =
			override?.description || description || site?.identity.description || "",
		canonical = `${publicOrigin}/${locale}${path}`,
		media = override?.image ?? image ?? site?.og_image,
		images = media
			? [
					{
						url: new URL(media.url, publicOrigin).href,
						width: media.width,
						height: media.height,
					},
				]
			: undefined,
		index =
			!!site && site.indexing && !site.maintenance.enabled && indexingAllowed();
	return {
		title: finalTitle,
		description: finalDescription,
		metadataBase: new URL(publicOrigin),
		robots: { index, follow: index },
		alternates: {
			canonical,
			languages: Object.fromEntries(
				locales.map((code) => [code, `${publicOrigin}/${code}${path}`]),
			),
		},
		openGraph: {
			title: finalTitle,
			description: finalDescription,
			url: canonical,
			type: "website",
			siteName: name,
			locale,
			images,
		},
		twitter: {
			card: images ? "summary_large_image" : "summary",
			title: finalTitle,
			description: finalDescription,
			images: images?.map((item) => item.url),
		},
		icons: site?.favicon ? { icon: site.favicon.url } : undefined,
	};
}
export async function homeMetadata(locale: Locale): Promise<Metadata> {
	const site = await readSite(locale),
		template = site?.identity.title_template ?? "{page}";
	return buildMetadata({
		locale,
		site,
		page: "home",
		title: template
			.replaceAll("{page}", heroUI[locale].fallbackTitle)
			.replaceAll("{site}", site?.identity.name ?? ""),
		description: site?.identity.description ?? "",
		path: "",
	});
}
export async function cmsMetadata(
	locale: Locale,
	slug: string,
): Promise<Metadata> {
	const [site, page] = await Promise.all([
		readSite(locale),
		readPage(locale, slug),
	]);
	if (!page)
		return {
			title: site?.identity.name ?? "",
			robots: { index: false, follow: false },
		};
	const template = site?.identity.title_template ?? "{page}";
	return buildMetadata({
		locale,
		site,
		page: slug,
		title: template
			.replaceAll("{page}", page.title)
			.replaceAll("{site}", site?.identity.name ?? ""),
		description: page.meta_description || page.intro,
		path: page.path,
		image: page.cover,
	});
}
