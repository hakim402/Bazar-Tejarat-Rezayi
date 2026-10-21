import type { Metadata } from "next";
import type { Locale } from "../../lib/i18n/locales";
import { contentCopy } from "../../lib/i18n/content";
import { readContent } from "./api/server";
export const publicOrigin = "https://bazartejaratrezayi.com";
export function indexingAllowed() {
	return (
		process.env.NODE_ENV === "production" &&
		process.env.API_INTERNAL_URL === "https://api.bazartejaratrezayi.com"
	);
}
export async function contentMetadata(
	locale: Locale,
	key: string,
	path: string,
): Promise<Metadata> {
	const { data } = await readContent(locale, key);
	return {
		title: data?.payload.title ?? contentCopy[locale].unavailable,
		description: data?.payload.description || undefined,
		metadataBase: new URL(publicOrigin),
		robots: {
			index: !!data && indexingAllowed(),
			follow: !!data && indexingAllowed(),
		},
		...(data
			? {
					alternates: {
						canonical: `/${data.content_locale}${path}`,
						languages: Object.fromEntries(
							data.available_locales.map((l) => [l, `/${l}${path}`]),
						),
					},
				}
			: {}),
	};
}
