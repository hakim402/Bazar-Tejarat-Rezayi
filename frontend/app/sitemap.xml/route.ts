import {
	sitemapEnabled,
	sitemapPages,
	sitemapAddress,
	xmlEscape,
	xmlResponse,
} from "../../features/marketplace/sitemap";
export const dynamic = "force-dynamic";
export async function GET() {
	try {
		const enabled = await sitemapEnabled();
		const pages = enabled ? (await sitemapPages()).pages : 0;
		return xmlResponse(
			`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${enabled ? Array.from({ length: pages + 1 }, (_, index) => `<sitemap><loc>${xmlEscape(sitemapAddress(index))}</loc></sitemap>`).join("") : ""}</sitemapindex>`,
		);
	} catch {
		return xmlResponse("<error>Temporarily unavailable</error>", 503);
	}
}
