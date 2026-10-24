import type { MetadataRoute } from "next";
import { readSite } from "../features/site/server";
import { indexingAllowed, publicOrigin } from "../features/pages/metadata";
export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
	const site = await readSite("fa-AF");
	return indexingAllowed() && site?.indexing && !site.maintenance.enabled
		? {
				rules: {
					userAgent: "*",
					allow: "/",
					disallow: [
						"/*/account/",
						"/*/auth/",
						"/*/invitation",
						"/*/catalogue-preview/",
						"/api/",
					],
				},
				sitemap: `${publicOrigin}/sitemap.xml`,
			}
		: { rules: { userAgent: "*", disallow: "/" } };
}
