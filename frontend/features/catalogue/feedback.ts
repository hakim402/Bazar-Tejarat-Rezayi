import { AccountError } from "../../lib/api/private-client.ts";
import { catalogueCopy } from "../../lib/i18n/catalogue.ts";
import type { Locale } from "../../lib/i18n/locales";
export function catalogueFailure(error: unknown, locale: Locale) {
	const t = catalogueCopy[locale];
	return {
		message:
			error instanceof AccountError
				? error.status === 409
					? t.conflict
					: error.status === 400
						? t.invalid
						: error.status === 403 || error.status === 401
							? t.denied
							: t.unavailable
				: t.unavailable,
		issues: error instanceof AccountError ? error.violations : [],
	};
}
