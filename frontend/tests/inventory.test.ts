import { safeReturn } from "../features/identity/api/accounts.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
	sellerRoute,
	sellerHref,
	sellerAccountRoute,
} from "../lib/routes/account-routes.ts";
import { inventoryRequest } from "../features/inventory/api/inventory.ts";
import { inventoryCopy } from "../lib/i18n/inventory.ts";
import { sellerShellCopy } from "../lib/i18n/seller-shell.ts";
const id = "aabbccdd-1234-5678-abcd-0123456789ab";
test("strict seller registry reserves movements and rejects malformed/trailing routes", () => {
	assert.equal(sellerRoute()?.screen, "overview");
	assert.equal(sellerRoute(["inventory", "movements"])?.screen, "movements");
	for (const [parts, screen] of [
		[["inventory", id], "detail"],
		[["inventory", id, "receipts", "new"], "receipt"],
		[["inventory", id, "adjustments", "new"], "adjustment"],
		[["inventory", id, "settings"], "settings"],
		[["inventory", id, "batches", id], "batch"],
	] as const)
		assert.equal(sellerRoute([...parts])?.screen, screen);
	for (const parts of [
		["inventory", "movements", "extra"],
		["inventory", "-".repeat(36)],
		["inventory", id, "receipts"],
		["inventory", id, "batches", "wrong"],
		["profile", "extra"],
		["mfa-reset"],
	])
		assert.equal(sellerRoute(parts), null);
	assert.equal(
		sellerHref("ps", "inventory", id),
		`/ps/account/seller/inventory?seller=${id}`,
	);
});
test("inventory private transport preserves exact strings and current CSRF without a new token store", async () => {
	const previousUrl = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:19999";
	const original = global.fetch,
		requests: { url: string; init?: RequestInit }[] = [];
	global.fetch = async (url, init) => {
		requests.push({ url: String(url), init });
		return new Response(
			JSON.stringify(
				requests.length === 1
					? { csrf_token: "synthetic" }
					: { status: "completed" },
			),
			{ headers: { "Content-Type": "application/json" } },
		);
	};
	try {
		await inventoryRequest(`seller/variants/${id}/receipts/?seller=${id}`, {
			quantity: "999999999.125",
			token: id,
			version: 3,
		});
		assert.match(requests[0].url, /auth\/csrf\/$/);
		assert.match(requests[1].url, /inventory\/seller\/variants\//);
		assert.equal(requests[1].init?.credentials, "include");
		assert.equal(requests[1].init?.cache, "no-store");
		assert.equal(
			JSON.parse(String(requests[1].init?.body)).quantity,
			"999999999.125",
		);
	} finally {
		global.fetch = original;
		if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = previousUrl;
	}
});
test("every stock label is supplied in all four locales", () => {
	for (const locale of ["fa-AF", "ps", "ar"] as const) {
		assert.deepEqual(
			Object.keys(inventoryCopy[locale]).sort(),
			Object.keys(inventoryCopy.en).sort(),
		);
		assert.notEqual(
			inventoryCopy[locale].inventory,
			inventoryCopy.en.inventory,
		);
	}
});

test("seller navigation and unavailable-summary copy has four-locale parity", () => {
	const keys = Object.keys(sellerShellCopy.en).sort();
	for (const locale of ["fa-AF", "en", "ps", "ar"] as const) {
		assert.deepEqual(Object.keys(sellerShellCopy[locale]).sort(), keys);
		for (const value of Object.values(sellerShellCopy[locale]))
			assert.ok(value.trim().length > 0);
	}
});

test("proxy and dispatcher share the strict private-route registry", () => {
	assert.equal(sellerAccountRoute(["inventory", id, "receipts", "new"]), true);
	assert.equal(sellerAccountRoute(["catalogue", id]), true);
	assert.equal(sellerAccountRoute(["mfa-reset"]), false);
});

test("stock detail links preserve filters and replace state without duplicate scope keys", () => {
	const filters = new URLSearchParams(
		"q=SYN&state=low&sort=-available&page=2&seller=other",
	);
	const link = sellerHref("fa-AF", `inventory/${id}`, id, filters);
	const values = new URL(link, "https://example.test").searchParams;
	assert.equal(values.get("seller"), id);
	assert.equal(values.get("q"), "SYN");
	assert.equal(values.get("page"), "2");
	assert.deepEqual(
		new URL(
			sellerHref("fa-AF", "inventory", id, filters, {
				state: "zero",
				page: "1",
			}),
			"https://example.test",
		).searchParams.getAll("state"),
		["zero"],
	);
});

test("seller login retains valid stock deep links and falls back from invalid or another account context", () => {
	const url = `/en/account/seller/inventory/${id}/receipts/new?seller=${id}#main`;
	assert.equal(safeReturn(url, "en", "seller"), url);
	assert.equal(
		safeReturn("/en/account/seller/inventory/not-an-id", "en", "seller"),
		"/en/account/seller",
	);
	assert.equal(
		safeReturn("/en/account/staff", "en", "seller"),
		"/en/account/seller",
	);
	assert.equal(safeReturn("/en/help", "en", "seller"), "/en/help");
});
