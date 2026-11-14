import "server-only";
import { cache } from "react";
import { apiOrigin } from "../../lib/api/client";
import { isLocale, type Locale } from "../../lib/i18n/locales";
import type { Media } from "../site/contract";
import {
	destinationAllowed,
	pageGroups,
	pageKinds,
	pagePath,
	slugPattern,
	type PageSummary,
} from "./registry";
export type Page = PageSummary & {
	body: string;
	meta_description: string;
	cover: Media | null;
	cta_label: string;
	cta_url: string;
	cta_secondary_label: string;
	cta_secondary_url: string;
	content_locale: Locale;
	fallback: boolean;
	updated_at: string;
};
const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const plain = (value: unknown, max = 4000): string =>
	typeof value === "string" &&
	value.length <= max &&
	!/[<>]/u.test(value) &&
	![...value].some((char) => {
		const code = char.charCodeAt(0);
		return code < 9 || (code > 10 && code < 32) || code === 127;
	})
		? value
		: "";
const body = (value: unknown): string =>
	typeof value === "string" &&
	value.length <= 200000 &&
	![...value].some((char) => {
		const code = char.charCodeAt(0);
		return (
			(code < 9 || (code > 10 && code < 32) || code === 127) && code !== 13
		);
	})
		? value
		: "";
const dimension = (value: unknown, fallback: number): number =>
	Number.isInteger(value) && Number(value) > 0 && Number(value) <= 20000
		? Number(value)
		: fallback;
function cover(value: unknown, mediaOrigin: string): Media | null {
	const item = record(value),
		url = typeof item.url === "string" ? item.url : "";
	if (
		!/^\/api\/v1\/site\/media\/[0-9a-f-]+\/$/.test(url) ||
		!["image/jpeg", "image/png", "image/webp"].includes(
			String(item.content_type),
		)
	)
		return null;
	return {
		url: mediaOrigin + url,
		width: dimension(item.width, 1536),
		height: dimension(item.height, 1024),
		content_type: String(item.content_type),
	};
}
function ctaUrl(value: unknown): string {
	const url = plain(value, 2048);
	if (!url || /[\s\\]/u.test(url)) return "";
	if (url.startsWith("/")) return url.startsWith("//") ? "" : url;
	return destinationAllowed(url) ? url : "";
}
/** Defensive contract for one published CMS page; never interprets raw HTML. */
export function parsePage(
	value: unknown,
	locale: Locale,
	mediaOrigin: string,
): Page | null {
	const data = record(value),
		slug = plain(data.slug, 80),
		title = plain(data.title, 300);
	if (!slugPattern.test(slug) || !title) return null;
	const group = pageGroups.includes(data.group as PageSummary["group"])
			? (data.group as PageSummary["group"])
			: "hidden",
		kind = pageKinds.includes(data.kind as PageSummary["kind"])
			? (data.kind as PageSummary["kind"])
			: "page",
		primaryLabel = plain(data.cta_label, 160),
		primaryUrl = ctaUrl(data.cta_url),
		secondaryLabel = plain(data.cta_secondary_label, 160),
		secondaryUrl = ctaUrl(data.cta_secondary_url);
	return {
		slug,
		path: pagePath(kind, slug),
		group,
		kind,
		title,
		intro: plain(data.intro, 1000),
		position: Number.isInteger(data.position) ? Number(data.position) : 0,
		show_in_footer: data.show_in_footer === true,
		body: body(data.body),
		meta_description: plain(data.meta_description, 400),
		cover: cover(data.cover, mediaOrigin),
		cta_label: primaryLabel && primaryUrl ? primaryLabel : "",
		cta_url: primaryLabel && primaryUrl ? primaryUrl : "",
		cta_secondary_label: secondaryLabel && secondaryUrl ? secondaryLabel : "",
		cta_secondary_url: secondaryLabel && secondaryUrl ? secondaryUrl : "",
		content_locale: isLocale(data.content_locale)
			? data.content_locale
			: locale,
		fallback: data.fallback === true,
		updated_at: plain(data.updated_at, 40),
	};
}
export const readPage = cache(async (locale: Locale, slug: string) => {
	try {
		const base = apiOrigin(process.env.API_INTERNAL_URL);
		const response = await fetch(
			`${base}/api/v1/site/pages/${locale}/${encodeURIComponent(slug)}/`,
			{
				cache: "no-store",
				credentials: "omit",
				signal: AbortSignal.timeout(5000),
			},
		);
		if (
			!response.ok ||
			!response.headers.get("content-type")?.includes("application/json")
		)
			return null;
		return parsePage(
			await response.json(),
			locale,
			apiOrigin(process.env.NEXT_PUBLIC_API_URL),
		);
	} catch {
		return null;
	}
});
