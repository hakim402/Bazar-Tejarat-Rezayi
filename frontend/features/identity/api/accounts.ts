import type { components } from "../../../lib/api/schema";
import { ApiError, apiOrigin } from "../../../lib/api/client.ts";

export type AuthResult = components["schemas"]["AuthResult"];
export type SessionData = components["schemas"]["SessionData"];
export type AccountContext = "buyer" | "seller" | "staff";
export class AccountError extends ApiError {
	readonly fields: string[];
	readonly code: string;
	constructor(status: number, fields: string[] = [], code = "request_failed") {
		super("invalid", status);
		this.fields = fields;
		this.code = code;
	}
}
let csrf: string | null = null;
async function call<T>(
	path: string,
	method: string,
	data?: unknown,
): Promise<T> {
	const base = apiOrigin(process.env.NEXT_PUBLIC_API_URL);
	let response: Response;
	try {
		response = await fetch(`${base}/api/v1/auth/${path}`, {
			method,
			credentials: "include",
			cache: "no-store",
			signal: AbortSignal.timeout(10000),
			headers: {
				Accept: "application/json",
				...(data !== undefined
					? { "Content-Type": "application/json", "X-CSRFToken": csrf ?? "" }
					: {}),
			},
			...(data !== undefined ? { body: JSON.stringify(data) } : {}),
		});
	} catch {
		throw new ApiError("unavailable");
	}
	if (!response.headers.get("content-type")?.includes("application/json"))
		throw new AccountError(response.status);
	const body: unknown = await response.json();
	if (!response.ok) {
		csrf = null;
		const fields =
			typeof body === "object" &&
			body &&
			"error" in body &&
			typeof body.error === "object" &&
			body.error &&
			"fields" in body.error
				? Object.keys(body.error.fields ?? {})
				: [];
		const envelope = body as { error?: { code?: unknown } } | null;
		const code =
			typeof envelope?.error?.code === "string"
				? envelope.error.code
				: "request_failed";
		throw new AccountError(response.status, fields, code);
	}
	if (!body || typeof body !== "object") throw new ApiError("invalid");
	return body as T;
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
