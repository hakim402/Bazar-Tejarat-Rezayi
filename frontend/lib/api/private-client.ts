import { ApiError, apiOrigin } from "./client.ts";
export type ValidationIssue = { path: string; code: string };
export function safeValidationIssues(value: unknown): ValidationIssue[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, 32).flatMap((entry: unknown) => {
		if (
			!entry ||
			typeof entry !== "object" ||
			!("path" in entry) ||
			!("code" in entry) ||
			typeof entry.path !== "string" ||
			!/^[a-zA-Z0-9_.]{1,160}$/.test(entry.path) ||
			typeof entry.code !== "string" ||
			!/^[a-z_]{1,40}$/.test(entry.code)
		)
			return [];
		return [{ path: entry.path, code: entry.code }];
	});
}
export class AccountError extends ApiError {
	readonly fields: string[];
	readonly code: string;
	readonly violations: ValidationIssue[];
	constructor(
		status: number,
		fields: string[] = [],
		code = "request_failed",
		violations: ValidationIssue[] = [],
	) {
		super("invalid", status);
		this.fields = fields;
		this.code = code;
		this.violations = violations;
	}
}

export async function privateCall<T>(
	path: string,
	method: string,
	data?: unknown,
	csrf: string | null = null,
	namespace = "auth/",
): Promise<T> {
	const base = apiOrigin(process.env.NEXT_PUBLIC_API_URL);
	let response: Response;
	try {
		response = await fetch(`${base}/api/v1/${namespace}${path}`, {
			method,
			credentials: "include",
			cache: "no-store",
			signal: AbortSignal.timeout(
				(namespace === "auth/" && path === "mfa/challenge/") ||
					data instanceof FormData
					? 30000
					: 10000,
			),
			headers: {
				Accept: "application/json",
				...(data !== undefined
					? {
							...(data instanceof FormData
								? {}
								: { "Content-Type": "application/json" }),
							"X-CSRFToken": csrf ?? "",
						}
					: {}),
			},
			...(data !== undefined
				? { body: data instanceof FormData ? data : JSON.stringify(data) }
				: {}),
		});
	} catch {
		throw new ApiError("unavailable");
	}
	if (!response.headers.get("content-type")?.includes("application/json"))
		throw new AccountError(response.status);
	const body: unknown = await response.json();
	if (!response.ok) {
		const fields =
			typeof body === "object" &&
			body &&
			"error" in body &&
			typeof body.error === "object" &&
			body.error &&
			"fields" in body.error
				? Object.keys(body.error.fields ?? {})
				: [];
		const envelope = body as {
			error?: { code?: unknown; violations?: unknown };
		} | null;
		const code =
			typeof envelope?.error?.code === "string"
				? envelope.error.code
				: "request_failed";
		throw new AccountError(
			response.status,
			fields,
			code,
			safeValidationIssues(envelope?.error?.violations),
		);
	}
	if (!body || typeof body !== "object") throw new ApiError("invalid");
	return body as T;
}

export async function privateRequest<T>(
	path: string,
	data?: unknown,
	method = "POST",
): Promise<T> {
	let csrf: string | null = null;
	if (data !== undefined) {
		const ready = await privateCall<{ csrf_token?: string }>("csrf/", "GET");
		csrf = ready.csrf_token ?? null;
		if (!csrf) throw new ApiError("invalid");
	}
	return privateCall<T>(
		path,
		data === undefined ? "GET" : method,
		data,
		csrf,
		"",
	);
}
