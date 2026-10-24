import type { MetadataRoute } from "next";
import { readSite } from "../features/site/server";
import { indexingAllowed, publicOrigin } from "../features/pages/metadata";
import { pages, pageKeys } from "../features/pages/registry";
import { locales } from "../lib/i18n/locales";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	if (!indexingAllowed()) return [];
	const site = await readSite("fa-AF");
	if (!site?.indexing || site.maintenance.enabled) return [];
	return pageKeys.flatMap((key) =>
		locales.map((locale) => ({
			url: `${publicOrigin}/${locale}${pages[key].path}`,
			alternates: {
				languages: Object.fromEntries(
					locales.map((code) => [
						code,
						`${publicOrigin}/${code}${pages[key].path}`,
					]),
				),
			},
		})),
	);
}
