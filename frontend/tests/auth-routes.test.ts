import test from "node:test";
import assert from "node:assert/strict";
import { authHref, modalScreens } from "../lib/routes/auth-routes.ts";
import { safeReturn } from "../features/identity/api/accounts.ts";
import { commerceRoute, sellerAccountRoute } from "../lib/routes/account-routes.ts";

test("aftercare route registry accepts order UUIDs and refuses extra command paths", () => {
	const id = "00000000-0000-4000-8000-000000000014";
	for (const route of ["cancellations", "aftercare"]) {
		assert.equal(commerceRoute([route]), true);
		assert.equal(commerceRoute([route, id]), true);
		for (const parts of [[route, "new"], [route, "invalid"], [route, id, "approve"], [route, id, "print"]])
			assert.equal(commerceRoute(parts), false);
	}
	assert.equal(sellerAccountRoute(["aftercare", id]), true);
	assert.equal(sellerAccountRoute(["cancellations", id]), false);
});
test("aftercare safe returns preserve locale, role, order and opaque seller scope", () => {
	const id = "00000000-0000-4000-8000-000000000014";
	for (const locale of ["fa-AF", "ps", "ar", "en"]) {
		for (const context of ["buyer", "seller"] as const) {
			const route = context === "buyer" ? "cancellations" : "aftercare";
			const url = `/${locale}/account/${context}/${route}/${id}${context === "seller" ? `?seller=${id}` : ""}`;
			assert.equal(safeReturn(url, locale, context), url);
		}
	}
});
test("aftercare safe returns reject cross-role and forged detail routes", () => {
	for (const context of ["buyer", "seller"] as const) {
		const route = context === "buyer" ? "cancellations" : "aftercare";
		const wrong = context === "buyer" ? "aftercare" : "cancellations";
		for (const path of [`${route}/invalid`, `${route}/00000000-0000-4000-8000-000000000014/approve`, wrong])
			assert.equal(safeReturn(`/en/account/${context}/${path}`, "en", context), `/en/account/${context}`);
	}
});
test("public auth URLs reopen one modal while privileged entry stays separate", () => {
	for (const locale of ["fa-AF", "ps", "ar", "en"]) {
		assert.equal(
			authHref(locale, "buyer-sign-in"),
			`/${locale}?auth=buyer-sign-in`,
		);
		assert.equal(
			authHref(locale, "seller-registration"),
			`/${locale}/sell?auth=seller-registration`,
		);
	}
	assert.equal(
		modalScreens.some(
			(screen) =>
				String(screen) === "mfa" || String(screen) === "staff-sign-in",
		),
		false,
	);
	assert.equal(
		safeReturn("/en/?auth=buyer-sign-in", "en", "buyer"),
		"/en/account/buyer",
	);
	assert.equal(
		safeReturn("/en/account/seller/settings", "en", "seller"),
		"/en/account/seller/settings",
	);
});

test("removed staff destinations cannot reopen through a safe return", () => {
	for (const context of ["buyer", "seller"] as const)
		assert.equal(
			safeReturn("/en/account/staff/verification", "en", context),
			`/en/account/${context}`,
		);
});
