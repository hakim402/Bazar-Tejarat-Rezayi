import { test } from "node:test";
import assert from "node:assert/strict";
import { marketplaceRoute } from "../lib/routes/marketplace-routes.ts";
import { queryString, mediaUrl, publicRequest } from "../features/marketplace/api.ts";
import { marketplaceCopy } from "../features/marketplace/copy.ts";
import { sellerAccountRoute } from "../lib/routes/account-routes.ts";
import { safeReturn } from "../features/identity/api/accounts.ts";
test("marketplace routes only admit delivered resource identities and tabs", () => {
	const id = "12345678-1234-4234-8234-123456789012";
	for (const path of [
		"/products",
		"/categories",
		"/search",
		"/stores",
		`/products/${id}`,
		`/stores/${id}`,
		`/stores/${id}/about`,
		`/stores/${id}/reviews`,
		"/categories/food",
	])
		assert.ok(marketplaceRoute(path));
	for (const path of [
		"/products/new",
		"/stores/private",
		"/stores/id/about",
		"/stores/../admin",
		`/products/${id}/reviews`,
		`/stores/${id}/contact`,
		`/stores/${id}/reviews/new`,
		"/categories/a%2fb",
		"/staff",
	])
		assert.equal(marketplaceRoute(path), null);
	assert.ok(sellerAccountRoute(["settings", "store"]));
	assert.equal(sellerAccountRoute(["settings", "store", "publish"]), false);
	assert.equal(
		safeReturn(`/en/products/${id}?variant=${id}`, "en", "buyer"),
		`/en/products/${id}?variant=${id}`,
	);
	assert.equal(
		safeReturn(`/en/stores/${id}/contact`, "en", "buyer"),
		"/en/account/buyer",
	);
	assert.equal(
		safeReturn(
			`/en/account/seller/settings/store?seller=${id}`,
			"en",
			"seller",
		),
		`/en/account/seller/settings/store?seller=${id}`,
	);
});
test("query adapter preserves repeated values for API rejection and strips modal plumbing", () => {
	assert.equal(
		queryString({
			q: "محصول",
			currency: ["AFN", "USD"],
			page: "2",
			auth: "buyer-sign-in",
			context: "buyer",
		}),
		"q=%D9%85%D8%AD%D8%B5%D9%88%D9%84&currency=AFN&currency=USD&page=2",
	);
});
test("untrusted store media cannot become a remote or private arbitrary URL", () => {
	const old = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
	try {
		assert.equal(
			mediaUrl(
				"/api/v1/marketplace/public/store-media/12345678-1234-4234-8234-123456789012/",
			),
			"https://api.example.test/api/v1/marketplace/public/store-media/12345678-1234-4234-8234-123456789012/",
		);
		for (const path of [
			"https://evil.test/image.jpg",
			"//evil.test/x",
			"/admin/private/",
			"/api/v1/marketplace/public/store-media/../x/",
		])
			assert.throws(() => mediaUrl(path));
	} finally {
		if (old === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = old;
	}
});
test("all four complete UI dictionaries include future-action and privacy explanations", () => {
	const keys = Object.keys(marketplaceCopy.en).sort();
	for (const dictionary of Object.values(marketplaceCopy)) {
		assert.deepEqual(Object.keys(dictionary).sort(), keys);
		assert.ok(Object.values(dictionary).every((value) => value.trim()));
	}
});

test("public review summaries accept real empty/positive aggregates and reject placeholder or malformed ratings", async () => {
	const fetchBefore = globalThis.fetch, originBefore = process.env.API_INTERNAL_URL;
	process.env.API_INTERNAL_URL = "https://api.example.test";
	const path = "stores/12345678-1234-4234-8234-123456789012/reviews/summary/";
	try {
		for (const row of [{ count: 0, average: null }, { count: 3, average: "4.3" }, { count: 1, average: "5.0" }]) {
			globalThis.fetch = async () => new Response(JSON.stringify(row), { headers: { "Content-Type": "application/json" } });
			assert.deepEqual(await publicRequest("en", path), row);
		}
		for (const row of [{ count: 0, average: "0.0" }, { count: -1, average: null }, { count: 1, average: null }, { count: 1, average: "5.1" }, { count: 1.5, average: "4.0" }, { count: 1, average: 4 }, { count: 0, average: null, id: "private" }]) {
			globalThis.fetch = async () => new Response(JSON.stringify(row), { headers: { "Content-Type": "application/json" } });
			await assert.rejects(publicRequest("en", path));
		}
	} finally {
		globalThis.fetch = fetchBefore;
		if (originBefore === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = originBefore;
	}
});
