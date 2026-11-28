import { AccountError } from "@/lib/api/private-client";
import { ApiError } from "@/lib/api/client";
import { authCopy } from "@/lib/i18n/auth";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import type { Locale } from "@/lib/i18n/locales";

export type AuthOperation =
	| "signin"
	| "register"
	| "verify"
	| "reset"
	| "request"
	| "link"
	| "google";
export function authFailure(
	error: unknown,
	locale: Locale,
	operation: AuthOperation,
) {
	const t = authFeedback[locale];
	const fields: Record<string, string> = {};
	if (error instanceof AccountError) {
		if (error.status === 429) return { message: t.limited, fields };
		if (error.code === "registration_closed")
			return { message: authCopy[locale].registrationClosed, fields };
		if (error.code === "csrf_failed") return { message: t.stale, fields };
		if ((error.status ?? 0) >= 500) return { message: t.service, fields };
		if (error.status === 401 || error.status === 403)
			return {
				message:
					operation === "signin" ? t.credentials : authCopy[locale].denied,
				fields,
			};
		const messages: Record<string, string> = {
			email: t.email,
			password: t.password,
			display_name: t.name,
			consent: t.consent,
			code: t.codeInvalid,
			token: t.linkInvalid,
		};
		for (const field of error.fields)
			if (messages[field]) fields[field] = messages[field];
		return {
			message:
				fields.token ??
				(operation === "verify" && fields.code ? t.codeInvalid : t.invalid),
			fields,
		};
	}
	if (error instanceof ApiError) {
		if (error.kind === "timeout") return { message: t.timeout, fields };
		if (error.kind === "unavailable" || error.kind === "cancelled")
			return { message: t.network, fields };
	}
	return { message: t.service, fields };
}
