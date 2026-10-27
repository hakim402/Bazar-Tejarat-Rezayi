import test from "node:test";
import assert from "node:assert/strict";
import { authHref, modalScreens } from "../lib/routes/auth-routes.ts";
import { safeReturn } from "../features/identity/api/accounts.ts";
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
