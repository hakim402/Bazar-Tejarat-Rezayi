import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { authCopy } from "../lib/i18n/auth";
import { googleCopy } from "../lib/i18n/google";
import { locales } from "../lib/i18n/locales";
import {
	identityTestsEnabled as enabled,
	fixturePassword as password,
	disposablePython,
	apiOrigin,
} from "./support/identity-runtime";
test.skip(!enabled, "Run with the maintained isolated services.");
for (const locale of locales) {
	test(`local alias basic seller registration ${locale}`, async ({
		page,
		baseURL,
	}) => {
		const alias = new URL(
			`/${locale}/auth/seller-registration?return=%2F${locale}%2Faccount%2Fseller`,
			baseURL,
		);
		alias.hostname = "localhost";
		await page.goto(alias.href);
		await expect(page).toHaveURL(
			new RegExp(
				`^http://127\\.0\\.0\\.1:[0-9]+/${locale}/sell\\?return=`,
			),
		);
		const t = authCopy[locale],
			email = `company-${locale.toLowerCase()}-${randomBytes(5).toString("hex")}@example.test`;
		await expect(page.getByRole("radio", {name:t.company,exact:true})).toHaveCount(0);
		await page
			.locator('dialog input[name="display_name"]')
			.fill("Synthetic Company Applicant");
		await page.locator('dialog input[name="email"]').fill(email);
		await page.locator('dialog input[name="password"]').fill(password);
		await page.locator('dialog input[name="consent"]').check();
		const received = page.waitForResponse(
			(r) =>
				r.url() === `${apiOrigin}/api/v1/auth/seller/register/` &&
				r.request().method() === "POST",
		);
		await page.locator('.account-card > form button[type="submit"]').click();
		expect((await received).status()).toBe(202);
		await expect(
			page.getByRole("status").filter({ hasText: t.requested }),
		).toBeVisible();
		const row = JSON.parse(
			disposablePython(
				`from apps.accounts.models import User\nimport json\nu=User.objects.get(email=${JSON.stringify(email)})\na=u.accounts.get(context='seller')\nprint(json.dumps({'intent':a.intent,'review':a.review_status,'verified':u.email_verified}))`,
			),
		);
		expect(row).toEqual({
			intent: "individual",
			review: "pending",
			verified: false,
		});
		if (locale === "en" || locale === "fa-AF")
			await page.screenshot({
				path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/basic-seller-${locale}.png`,
				fullPage: true,
			});
	});
	test(`local alias Google availability uses real API ${locale}`, async ({
		page,
		baseURL,
	}) => {
		const alias = new URL(`/${locale}/auth/buyer-sign-in`, baseURL);
		alias.hostname = "localhost";
		const availability = page.waitForResponse(
			(r) => r.url() === `${apiOrigin}/api/v1/auth/google/availability/`,
		);
		await page.goto(alias.href);
		expect((await availability).status()).toBe(200);
		await expect(page).toHaveURL(
			new RegExp(
				`^http://127\\.0\\.0\\.1:[0-9]+/${locale}\\?auth=buyer-sign-in$`,
			),
		);
		// Providers stay disabled in the disposable runtime; reaching the real API is the assertion.
		await expect(
			page.getByRole("button", {
				name: googleCopy[locale].button,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByText(googleCopy[locale].unavailable, { exact: true }),
		).toBeVisible();
	});
}
