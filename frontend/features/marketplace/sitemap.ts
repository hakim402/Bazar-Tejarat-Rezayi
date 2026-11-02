import "server-only";
import { indexingAllowed, publicOrigin } from "../pages/metadata";
import { readSite } from "../site/server";
import { publicRequest } from "./api";
import type { SitemapPage } from "./types";
export const xmlEscape = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
export function xmlResponse(content: string, status = 200) {
	return new Response(content, {
		status,
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Robots-Tag": "noindex",
		},
	});
}
export async function sitemapEnabled() {
	if (!indexingAllowed()) return false;
	const site = await readSite("fa-AF");
	if (!site) throw new Error("unavailable");
	return site.indexing && !site.maintenance.enabled;
}
export async function sitemapPages() {
	return publicRequest<SitemapPage>("fa-AF", "sitemap/");
}
export const sitemapAddress = (page: number) =>
	`${publicOrigin}/marketplace-sitemap/${page}.xml`;
