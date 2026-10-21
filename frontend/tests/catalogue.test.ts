import test from "node:test";
import assert from "node:assert/strict";
import { catalogueFailure } from "../features/catalogue/feedback.ts";
import { AccountError } from "../lib/api/private-client.ts";
import { catalogueRequest } from "../features/catalogue/api/catalogue.ts";
import { catalogueCopy } from "../lib/i18n/catalogue.ts";

test("catalogue feedback separates permission conflict invalid and dependency without exposing provider text", () => {
	for (const locale of ["fa-AF", "en", "ps", "ar"] as const) {
		const copy = catalogueCopy[locale];
		assert.equal(
			catalogueFailure(new AccountError(409), locale).message,
			copy.conflict,
		);
		assert.equal(
			catalogueFailure(new AccountError(403), locale).message,
			copy.denied,
		);
		assert.equal(
			catalogueFailure(new Error("PRIVATE PROVIDER RESPONSE"), locale).message,
			copy.unavailable,
		);
		assert.equal(
			catalogueFailure(
				new AccountError(400, [], "validation_error", [
					{ path: "body.variants.0.minimum", code: "increment" },
				]),
				locale,
			).issues[0].path,
			"body.variants.0.minimum",
		);
	}
});
test("catalogue transport uses current CSRF and decimal strings without new session or namespace", async () => {
	const savedFetch = global.fetch;
	const savedUrl = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:19999";
	const requests: { url: string; init?: RequestInit }[] = [];
	global.fetch = async (url, init) => {
		requests.push({ url: String(url), init });
		return new Response(
			JSON.stringify(
				requests.length === 1
					? { csrf_token: "synthetic-csrf" }
					: { id: "synthetic", version: 2 },
			),
			{ headers: { "Content-Type": "application/json" } },
		);
	};
	try {
		await catalogueRequest("seller", "products/synthetic/prices/", {
			version: 1,
			prices: [{ id: "variant", retail: "0.01", wholesale: null }],
		});
		assert.match(requests[0].url, /auth\/csrf\/$/);
		assert.match(
			requests[1].url,
			/catalogue\/seller\/products\/synthetic\/prices\/$/,
		);
		assert.equal(requests[1].init?.credentials, "include");
		assert.equal(
			JSON.parse(String(requests[1].init?.body)).prices[0].retail,
			"0.01",
		);
		assert.equal(
			new Headers(requests[1].init?.headers).get("X-CSRFToken"),
			"synthetic-csrf",
		);
	} finally {
		global.fetch = savedFetch;
		if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = savedUrl;
	}
});
test("all four catalogue interfaces include meaningful draft provider price and accessibility labels", () => {
	const keys = Object.keys(catalogueCopy.en);
	for (const locale of ["fa-AF", "en", "ps", "ar"] as const) {
		assert.deepEqual(Object.keys(catalogueCopy[locale]), keys);
		for (const value of Object.values(catalogueCopy[locale]))
			assert.ok(value.trim());
		assert.notEqual(catalogueCopy[locale].saved, catalogueCopy[locale].working);
		assert.notEqual(
			catalogueCopy[locale].providerPending,
			catalogueCopy[locale].success,
		);
	}
});

test("safe catalogue error transport preserves indexed field and cross-field row paths", async () => {
	const savedFetch = global.fetch;
	const savedUrl = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:19999";
	try {
		for (const [path, code] of [
			["prices.0.retail", "positive"],
			["prices.1.wholesale", "decimal"],
			["prices.1", "one_price"],
			["prices.2", "duplicate_price"],
		]) {
			global.fetch = async (url) =>
				String(url).endsWith("/csrf/")
					? new Response(JSON.stringify({ csrf_token: "synthetic" }), {
							headers: { "Content-Type": "application/json" },
						})
					: new Response(
							JSON.stringify({
								error: {
									code: "validation_error",
									violations: [{ path, code }],
									message: "PRIVATE VALUE",
								},
							}),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
			await assert.rejects(
				catalogueRequest("seller", "products/synthetic/prices/", {
					version: 1,
					prices: [],
				}),
				(error: unknown) => {
					assert.ok(error instanceof AccountError);
					for (const locale of ["fa-AF", "en", "ps", "ar"] as const) {
						assert.deepEqual(catalogueFailure(error, locale).issues, [
							{ path, code },
						]);
						assert.equal(
							catalogueFailure(error, locale).message,
							catalogueCopy[locale].invalid,
						);
						assert.notEqual(
							catalogueCopy[locale].onePrice,
							catalogueCopy[locale].decimal,
						);
						assert.notEqual(
							catalogueCopy[locale].duplicatePrice,
							catalogueCopy[locale].duplicate,
						);
					}
					return true;
				},
			);
		}
	} finally {
		global.fetch = savedFetch;
		if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = savedUrl;
	}
});
