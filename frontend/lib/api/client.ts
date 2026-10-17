import type { components } from "./schema";
export type Bootstrap = components["schemas"]["Bootstrap"];
export type ApiFailure = "unavailable" | "timeout" | "invalid" | "cancelled";
export class ApiError extends Error {
	readonly kind: ApiFailure;
	readonly status?: number;
	constructor(kind: ApiFailure, status?: number) {
		super(kind);
		this.name = "ApiError";
		this.kind = kind;
		this.status = status;
	}
}
export function apiOrigin(value: string | undefined) {
	try {
		const url = new URL(value ?? "");
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			throw new Error();
		return url.origin;
	} catch {
		throw new ApiError("unavailable");
	}
}
export function validBootstrap(value: unknown): value is Bootstrap {
	if (!value || typeof value !== "object") return false;
	const data = value as Record<string, unknown>;
	const supported = ["fa-AF", "en", "ps", "ar"];
	return (
		data.default_locale === "fa-AF" &&
		Array.isArray(data.supported_locales) &&
		data.supported_locales.length === 4 &&
		supported.every((locale) =>
			(data.supported_locales as unknown[]).includes(locale),
		) &&
		Array.isArray(data.currencies) &&
		data.currencies.length === 2 &&
		data.currencies[0] === "AFN" &&
		data.currencies[1] === "USD" &&
		!!data.brand_names &&
		typeof data.brand_names === "object" &&
		supported.every(
			(locale) =>
				typeof (data.brand_names as Record<string, unknown>)[locale] ===
					"string" && !!(data.brand_names as Record<string, unknown>)[locale],
		)
	);
}
export async function getBootstrap(
	origin: string | undefined,
	options: {
		signal?: AbortSignal;
		timeoutMs?: number;
		fetcher?: typeof fetch;
	} = {},
): Promise<Bootstrap> {
	const base = apiOrigin(origin);
	const timeout = AbortSignal.timeout(options.timeoutMs ?? 5000);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeout])
		: timeout;
	try {
		const response = await (options.fetcher ?? fetch)(
			`${base}/api/v1/bootstrap/`,
			{
				cache: "no-store",
				credentials: "omit",
				headers: { Accept: "application/json" },
				signal,
			},
		);
		if (!response.ok) throw new ApiError("unavailable", response.status);
		if (!response.headers.get("content-type")?.includes("application/json"))
			throw new ApiError("invalid");
		const value: unknown = await response.json();
		if (!validBootstrap(value)) throw new ApiError("invalid");
		return value;
	} catch (error) {
		if (error instanceof ApiError) throw error;
		if (options.signal?.aborted) throw new ApiError("cancelled");
		if (timeout.aborted) throw new ApiError("timeout");
		if (error instanceof SyntaxError) throw new ApiError("invalid");
		throw new ApiError("unavailable");
	}
}
