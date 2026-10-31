import {
	sitemapEnabled,
	xmlEscape,
	xmlResponse,
} from "../../../features/marketplace/sitemap";
import { publicOrigin } from "../../../features/pages/metadata";
import { pages, pageKeys } from "../../../features/pages/registry";
import { marketplacePages } from "../../../lib/routes/marketplace-routes";
import { locales } from "../../../lib/i18n/locales";
import { publicRequest } from "../../../features/marketplace/api";
import type { SitemapPage } from "../../../features/marketplace/types";
export const dynamic = "force-dynamic";
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ page: string }> },
) {
	const segment = (await params).page;
	if (!/^(?:0|[1-9][0-9]{0,4})\.xml$/.test(segment))
		return xmlResponse("<error>Not found</error>", 404);
	const page = Number(segment.slice(0, -4));
	try {
		if (!(await sitemapEnabled()))
			return xmlResponse(
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
			);
		let paths: string[] = [];
		if (page === 0) {
			paths = [
				...pageKeys.map((key) => pages[key].path),
				...marketplacePages
					.filter((key) => key !== "search")
					.map((key) => `/${key}`),
			];
		} else {
			const data = await publicRequest<SitemapPage>(
				"fa-AF",
				`sitemap/?page=${page}`,
			);
			if (page > data.pages)
				return xmlResponse("<error>Not found</error>", 404);
			paths = [
				...data.categories.map((code) => `/categories/${code}`),
				...data.products.map((id) => `/products/${id}`),
				...data.stores.flatMap((id) => [
					`/stores/${id}`,
					`/stores/${id}/about`,
				]),
			];
		}
		const urls = paths
			.flatMap((path) =>
				locales.map(
					(locale) =>
						`<url><loc>${xmlEscape(`${publicOrigin}/${locale}${path}`)}</loc>${locales.map((code) => `<xhtml:link rel="alternate" hreflang="${code}" href="${xmlEscape(`${publicOrigin}/${code}${path}`)}"/>`).join("")}</url>`,
				),
			)
			.join("");
		return xmlResponse(
			`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`,
		);
	} catch {
		return xmlResponse("<error>Temporarily unavailable</error>", 503);
	}
}
