import type { MetadataRoute } from "next";
import { readContent, readHelp } from "../features/content/api/server";
import { indexingAllowed, publicOrigin } from "../features/content/metadata";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	if (!indexingAllowed()) return [];
	const result: MetadataRoute.Sitemap = [];
	for (const key of [
		"home",
		"how-it-works",
		"wholesale",
		"sell",
		"about",
		"contact",
		"terms",
		"privacy",
	]) {
		const { data } = await readContent("fa-AF", key);
		if (data)
			for (const l of data.available_locales)
				result.push({
					url: `${publicOrigin}/${l}${key === "home" ? "" : `/${key}`}`,
					lastModified: data.published_at,
				});
	}
	for (let page = 1; page <= 10000; page++) {
		const { data } = await readHelp("fa-AF", page);
		if (!data) break;
		for (const a of data.results)
			for (const l of a.available_locales)
				result.push({
					url: `${publicOrigin}/${l}/help/${a.key}`,
					lastModified: a.published_at,
				});
		if (page * 12 >= data.count) break;
	}
	return result;
}
