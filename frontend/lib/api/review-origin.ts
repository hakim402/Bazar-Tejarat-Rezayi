import { apiOrigin } from "./client.ts";

/** Local auth cookies and OAuth callbacks must use the same loopback hostname. */
export function canonicalReviewUrl(
	requestUrl: string,
	host: string | null,
	publicApi: string | undefined,
): URL | null {
	try {
		const source = new URL(requestUrl),
			incoming = new URL(`${source.protocol}//${host ?? source.host}`),
			api = new URL(apiOrigin(publicApi));
		const loopback = (name: string) =>
			name === "localhost" || name === "127.0.0.1";
		if (
			source.protocol !== "http:" ||
			api.protocol !== "http:" ||
			source.username ||
			source.password ||
			!loopback(source.hostname) ||
			!loopback(incoming.hostname) ||
			!loopback(api.hostname) ||
			incoming.port !== source.port ||
			incoming.hostname === api.hostname
		)
			return null;
		source.hostname = api.hostname;
		return source;
	} catch {
		return null;
	}
}
