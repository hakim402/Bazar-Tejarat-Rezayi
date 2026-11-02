import { sellerAccountRoute, commerceRoute, communicationRoute } from "../../../lib/routes/account-routes.ts";
import { marketplaceRoute } from "../../../lib/routes/marketplace-routes.ts";
import type { components } from "../../../lib/api/schema.d";
import { ApiError } from "../../../lib/api/client.ts";

export type AuthResult = components["schemas"]["AuthResult"];
export type SessionData = components["schemas"]["SessionData"];
export type AccountContext = "buyer" | "seller";
import { privateCall } from "../../../lib/api/private-client.ts";
export { AccountError } from "../../../lib/api/private-client.ts";
export const ACCOUNT_SESSION_CHANGED = "rezayi:account-session-changed";
let csrf: string | null = null;
function call<T>(path: string, method: string, data?: unknown): Promise<T> {
	return privateCall<T>(path, method, data, csrf);
}
export async function authMutation(
	path: string,
	data: unknown = {},
	method = "POST",
) {
	// Acquire before each mutation. Never replay a failed non-idempotent request after CSRF rotation.
	const acquired = await call<AuthResult>("csrf/", "GET");
	csrf = acquired.csrf_token ?? null;
	if (!csrf) throw new ApiError("invalid");
	const result = await call<AuthResult>(path, method, data);
	csrf = result.csrf_token ?? csrf;
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED));
	return result;
}
export async function accountSession(context: AccountContext) {
	const result = await call<SessionData>(`${context}/session/`, "GET");
	if (
		!result.identity ||
		!result.accounts?.[0] ||
		result.accounts[0].context !== context
	)
		throw new ApiError("invalid");
	return result;
}
export function safeReturn(
	value: string | null,
	locale: string,
	context: AccountContext,
) {
	const fallback = `/${locale}/account/${context}`;
	if (
		!value ||
		[...value].some(
			(character) => character.charCodeAt(0) <= 32 || character === "\\",
		) ||
		!value.startsWith(`/${locale}/`)
	)
		return fallback;
	try {
		const url = new URL(value, "https://return.example");
		const publicPath = url.pathname.slice(locale.length + 1),
			section = publicPath.split("/")[1];
		if (
			["categories", "products", "search", "stores"].includes(section) &&
			!marketplaceRoute(publicPath)
		)
			return fallback;
		if (
			context === "seller" &&
			url.pathname.startsWith(`/${locale}/account/`)
		) {
			const parts = url.pathname.split("/").filter(Boolean);
			if (parts[2] !== "seller" || !sellerAccountRoute(parts.slice(3)))
				return fallback;
		}
		if(context === "buyer" && url.pathname.startsWith(`/${locale}/account/`)) { const parts=url.pathname.split("/").filter(Boolean); if(parts[2]!=="buyer" || (["messages","notifications"].includes(parts[3]) && !communicationRoute(parts.slice(3)) || ["checkout","checkouts","orders","invoices"].includes(parts[3]) && !commerceRoute(parts.slice(3)))) return fallback; }
		return url.origin === "https://return.example" &&
			url.pathname.startsWith(`/${locale}/`) &&
			!url.pathname.startsWith(`/${locale}/auth/`) &&
			!url.pathname.startsWith(`/${locale}/account/staff`) &&
			!url.searchParams.has("auth") &&
			!["staff", "owner"].includes(url.searchParams.get("context") ?? "")
			? url.pathname + url.search + url.hash
			: fallback;
	} catch {
		return fallback;
	}
}

export async function googleAvailability() {
	return call<AuthResult>("google/availability/", "GET");
}
