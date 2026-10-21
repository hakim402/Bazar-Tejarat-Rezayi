import type { components } from "../../../lib/api/schema";
import { ApiError } from "../../../lib/api/client.ts";

export type AuthResult = components["schemas"]["AuthResult"];
export type SessionData = components["schemas"]["SessionData"];
export type AccountContext = "buyer" | "seller" | "staff";
import { privateCall } from "../../../lib/api/private-client.ts";
export { AccountError } from "../../../lib/api/private-client.ts";
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
		return url.origin === "https://return.example" &&
			url.pathname.startsWith(`/${locale}/`) &&
			!url.pathname.startsWith(`/${locale}/auth/`)
			? url.pathname + url.search + url.hash
			: fallback;
	} catch {
		return fallback;
	}
}

export async function googleAvailability() {
	return call<AuthResult>("google/availability/", "GET");
}
