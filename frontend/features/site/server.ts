import "server-only";
import { cache } from "react";
import { apiOrigin } from "../../lib/api/client";
import type { Locale } from "../../lib/i18n/locales";
import { parseSite } from "./contract";
export const readSite = cache(async (locale: Locale) => {
	try {
		const base = apiOrigin(process.env.API_INTERNAL_URL);
		const response = await fetch(`${base}/api/v1/site/public/${locale}/`, {
			cache: "no-store",
			credentials: "omit",
			signal: AbortSignal.timeout(5000),
		});
		if (
			!response.ok ||
			!response.headers.get("content-type")?.includes("application/json")
		)
			return null;
		return parseSite(
			await response.json(),
			locale,
			apiOrigin(process.env.NEXT_PUBLIC_API_URL),
		);
	} catch {
		return null;
	}
});
