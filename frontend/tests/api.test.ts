import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiOrigin, getBootstrap } from "../lib/api/client.ts";
import { localizePath } from "../lib/i18n/locales.ts";
const payload = {
	default_locale: "fa-AF",
	supported_locales: ["fa-AF", "en", "ps", "ar"],
	brand_names: {
		"fa-AF": "بازار رضایی",
		en: "Bazar Rezayi",
		ps: "رضايي بازار",
		ar: "سوق رضائي",
	},
	currencies: ["AFN", "USD"],
};
function response(data: unknown, status = 200) {
	return async () => Response.json(data, { status });
}
test("typed bootstrap succeeds with explicit public no-store requests", async () => {
	const result = await getBootstrap("http://127.0.0.1:8100", {
		fetcher: async (url, init) => {
			assert.equal(url, "http://127.0.0.1:8100/api/v1/bootstrap/");
			assert.equal(init?.cache, "no-store");
			assert.equal(init?.credentials, "omit");
			return Response.json(payload);
		},
	});
	assert.deepEqual(result, payload);
});
test("missing, invalid and credential-bearing origins fail safely", () => {
	for (const url of [
		undefined,
		"file:///etc/passwd",
		"http://name:private@localhost",
		"https://example.test/path",
		"https://example.test?secret=value",
	])
		assert.throws(
			() => apiOrigin(url),
			(error: unknown) =>
				error instanceof ApiError && !error.message.includes("private"),
		);
});
test("non-success, empty success and invalid shape never masquerade as bootstrap", async () => {
	await assert.rejects(
		getBootstrap("http://localhost", { fetcher: response({}, 503) }),
		(error: unknown) => error instanceof ApiError && error.status === 503,
	);
	for (const data of [
		{},
		[],
		{ ...payload, currencies: [] },
		{ ...payload, supported_locales: ["en"] },
	])
		await assert.rejects(
			getBootstrap("http://localhost", { fetcher: response(data) }),
			(error: unknown) => error instanceof ApiError && error.kind === "invalid",
		);
	await assert.rejects(
		getBootstrap("http://localhost", {
			fetcher: async () => new Response("<html>error</html>"),
		}),
		(error: unknown) => error instanceof ApiError && error.kind === "invalid",
	);
});
test("connection failures, timeout and cancellation are distinct and sanitized", async () => {
	await assert.rejects(
		getBootstrap("http://localhost", {
			fetcher: async () => {
				throw new Error("private internal failure");
			},
		}),
		(error: unknown) =>
			error instanceof ApiError && error.kind === "unavailable",
	);
	const hanging: typeof fetch = async (_, init) =>
		new Promise((_, reject) => {
			init?.signal?.addEventListener("abort", () =>
				reject(new Error("aborted")),
			);
		});
	const keepAlive = setTimeout(() => {}, 100);
	await assert.rejects(
		getBootstrap("http://localhost", { timeoutMs: 10, fetcher: hanging }),
		(error: unknown) => error instanceof ApiError && error.kind === "timeout",
	);
	clearTimeout(keepAlive);
	const abort = new AbortController();
	const pending = getBootstrap("http://localhost", {
		signal: abort.signal,
		fetcher: hanging,
	});
	abort.abort();
	await assert.rejects(
		pending,
		(error: unknown) => error instanceof ApiError && error.kind === "cancelled",
	);
});
test("language switch preserves equivalent deep path", () => {
	assert.equal(
		localizePath("/fa-AF/stores/abc/products/item", "en"),
		"/en/stores/abc/products/item",
	);
});

test("local review uses one auth hostname without redirecting remote or untrusted origins", async () => {
	const { canonicalReviewUrl } = await import("../lib/api/review-origin.ts");
	assert.equal(
		canonicalReviewUrl(
			"http://localhost:3100/en/auth/seller-registration?return=%2Fen%2Faccount%2Fseller",
			"localhost:3100",
			"http://127.0.0.1:8100",
		)?.href,
		"http://127.0.0.1:3100/en/auth/seller-registration?return=%2Fen%2Faccount%2Fseller",
	);
	// Next can normalize its URL internally; the actual Host prevents a redirect loop.
	assert.equal(
		canonicalReviewUrl(
			"http://localhost:3100/en",
			"127.0.0.1:3100",
			"http://127.0.0.1:8100",
		),
		null,
	);
	assert.equal(
		canonicalReviewUrl(
			"http://127.0.0.1:3100/en",
			"127.0.0.1:3100",
			"http://localhost:8100",
		)?.hostname,
		"localhost",
	);
	for (const [url, host, api] of [
		[
			"https://bazartejaratrezayi.com/en",
			"bazartejaratrezayi.com",
			"https://api.bazartejaratrezayi.com",
		],
		[
			"http://localhost:3100/en",
			"localhost:3100",
			"https://api.bazartejaratrezayi.com",
		],
		["http://localhost:3100/en", "localhost:8100", "http://127.0.0.1:8100"],
		[
			"http://localhost:3100/en",
			"localhost.evil.test:3100",
			"http://127.0.0.1:8100",
		],
		["http://evil.test:3100/en", "localhost:3100", "http://127.0.0.1:8100"],
		[
			"http://localhost:3100/en",
			"localhost:3100",
			"http://secret:private@127.0.0.1:8100",
		],
		["http://localhost:3100/en", "localhost:3100", "invalid"],
	])
		assert.equal(canonicalReviewUrl(url, host, api), null);
});
