import { ApiError, apiOrigin } from "../../lib/api/client.ts";
import type { Locale } from "../../lib/i18n/locales";
export const marketPath = (locale: Locale, path: string) =>
	`/api/v1/marketplace/public/${locale}/${path}`;
export function mediaUrl(path: string) {
	if (
		!/^\/api\/v1\/(?:marketplace\/(?:public|seller)\/store-media|catalogue\/images)\/[0-9a-f-]{36}\/$/.test(
			path,
		)
	)
		throw new ApiError("invalid");
	return `${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}${path}`;
}
export async function publicRequest<T>(
	locale: Locale,
	path: string,
	signal?: AbortSignal,
): Promise<T> {
	const origin = apiOrigin(
		typeof window === "undefined"
			? process.env.API_INTERNAL_URL
			: process.env.NEXT_PUBLIC_API_URL,
	);
	let response: Response;
	try {
		response = await fetch(`${origin}${marketPath(locale, path)}`, {
			cache: "no-store",
			credentials: "omit",
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(10000)])
				: AbortSignal.timeout(10000),
			headers: { Accept: "application/json" },
		});
	} catch {
		throw new ApiError(signal?.aborted ? "cancelled" : "unavailable");
	}
	if (!response.ok) throw new ApiError("unavailable", response.status);
	if (!response.headers.get("content-type")?.includes("application/json"))
		throw new ApiError("invalid");
	const value: unknown = await response.json();
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ApiError("invalid");
	const row = value as Record<string, unknown>,
		route = path.split("?")[0];
	if (/^stores\/[0-9a-f-]{36}\/reviews\/summary\/$/.test(route)) {
		if (
			Object.keys(row).some((key) => key !== "count" && key !== "average") ||
			!Number.isSafeInteger(row.count) || Number(row.count) < 0 ||
			(row.count === 0 ? row.average !== null :
				typeof row.average !== "string" || !/^[1-5]\.[0-9]$/.test(row.average) || Number(row.average) > 5)
		) throw new ApiError("invalid");
	} else if ("results" in row) {
		if (
			!Array.isArray(row.results) ||
			row.results.length > 20 ||
			!Number.isSafeInteger(row.count) ||
			Number(row.count) < 0 ||
			!Number.isSafeInteger(row.page) ||
			Number(row.page) < 1 ||
			row.page_size !== 20
		)
			throw new ApiError("invalid");
	} else if (route === "home/") {
		if (
			!Array.isArray(row.products) ||
			row.products.length > 8 ||
			!Array.isArray(row.stores) ||
			row.stores.length > 6 ||
			!Array.isArray(row.categories) ||
			row.categories.length > 12 ||
			!("featured_store" in row)
		)
			throw new ApiError("invalid");
	} else if (route === "sitemap/") {
		if (
			!Array.isArray(row.products) ||
			row.products.length > 500 ||
			!Array.isArray(row.stores) ||
			row.stores.length > 500 ||
			!Array.isArray(row.categories) ||
			row.categories.length > 500 ||
			!Number.isSafeInteger(row.pages) ||
			Number(row.pages) < 1
		)
			throw new ApiError("invalid");
	} else if (
		typeof row.id !== "string" ||
		typeof row.resolved_locale !== "string" ||
		!("body" in row || "name" in row)
	)
		throw new ApiError("invalid");
	return value as T;
}
export function queryString(
	value: Record<string, string | string[] | undefined>,
) {
	const result = new URLSearchParams();
	for (const [key, item] of Object.entries(value)) {
		if (["auth", "return", "context"].includes(key)) continue;
		if (Array.isArray(item))
			for (const entry of item) result.append(key, entry);
		else if (item !== undefined && item !== "") result.append(key, item);
	}
	return result.toString();
}
