import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { googleCopy } from "../lib/i18n/google";
import { authCopy } from "../lib/i18n/auth";
import { screenTitle } from "../lib/i18n/auth-screens";
import { locales } from "../lib/i18n/locales";
const folder = process.env.PLAYWRIGHT_EVIDENCE_DIR ?? "../doc/progress/phase-03-identity/addendum";
const emailPreviews = process.env.PLAYWRIGHT_EMAIL_PREVIEWS_DIR ?? "../doc/progress/phase-03-identity/email-previews";
for (const locale of locales) {
	test(`Google account entry and safe failure states ${locale}`, async ({
		page,
	}) => {
		await page.route("**/api/v1/auth/google/availability/", (route) =>
			route.fulfill({ json: { status: "google_available" } }),
		);
		await page.route("**/api/v1/auth/google/start/", (route) =>
			route.fulfill({
				status: 503,
				json: { error: { code: "provider_unavailable" } },
			}),
		);
		await page.goto(`/${locale}/auth/buyer-sign-in`);
		await expect(page.locator(".account-breadcrumb")).toContainText(
			screenTitle(locale, "buyer-sign-in"),
		);
		await expect(page).toHaveTitle(
			new RegExp(screenTitle(locale, "buyer-sign-in")),
		);
		const button = page.getByRole("button", {
			name: googleCopy[locale].button,
			exact: true,
		});
		await expect(button).toBeEnabled();
		await button.click();
		await expect(page.locator(".google-entry [role=alert]")).toHaveText(
			googleCopy[locale].provider_error,
		);
		await expect(
			page.getByLabel(authCopy[locale].password, { exact: true }),
		).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate(() => {
			(document.activeElement as HTMLElement)?.blur();
			window.scrollTo(0, 0);
		});
		await expect
			.poll(() =>
				page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			)
			.toBe(true);
		await page.screenshot({
			path: `${folder}/google-${locale}-mobile.png`,
			fullPage: true,
		});
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.screenshot({
			path: `${folder}/google-${locale}-desktop.png`,
			fullPage: true,
		});
		for (const state of [
			"cancelled",
			"link_required",
			"account_unavailable",
		] as const) {
			await page.goto(
				`/${locale}/auth/google-result?google=${state}&context=buyer`,
			);
			await expect(page.getByRole("status")).toHaveText(
				googleCopy[locale][state],
			);
			await expect(page).not.toHaveURL(/google=/);
		}
		await page.goto(
			`/${locale}/auth/google-result?google=onboarding&context=seller&attempt=00000000-0000-0000-0000-000000000001`,
		);
		await expect(
			page.getByRole("heading", { name: googleCopy[locale].onboarding }),
		).toBeVisible();
		await expect(page.getByRole("checkbox")).not.toBeChecked();
		await expect(
			page.getByText(authCopy[locale].policy, { exact: true }),
		).toBeVisible();
		await page.route("**/api/v1/auth/google/availability/", (route) =>
			route.fulfill({ json: { status: "google_unavailable" } }),
		);
		await page.goto(`/${locale}/auth/seller-registration`);
		await expect(
			page.getByRole("button", {
				name: googleCopy[locale].button,
				exact: true,
			}),
		).toBeDisabled();
		await expect(
			page.getByText(googleCopy[locale].unavailable, { exact: true }),
		).toBeVisible();
		await page.goto(`/${locale}/auth/staff-sign-in`);
		await expect(page.locator(".google-button")).toHaveCount(0);
	});
	test(`Email templates desktop mobile ${locale}`, async ({ page }) => {
		for (const purpose of ["verify", "reset"]) {
			await page.goto(
				pathToFileURL(
					resolve(
						`${emailPreviews}/${locale}-${purpose}.html`,
					),
				).href,
			);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				locale === "en" ? "ltr" : "rtl",
			);
			await expect(page.locator("h1")).toBeVisible();
			await expect(page.locator("img")).toBeVisible();
			await expect
				.poll(() =>
					page
						.locator("img")
						.evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
				)
				.toBe(true);
			for (const [label, width] of [
				["mobile", 390],
				["desktop", 1200],
			] as const) {
				await page.setViewportSize({ width, height: 900 });
				await expect
					.poll(() =>
						page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					)
					.toBe(true);
				await page.screenshot({
					path: `${emailPreviews}/${locale}-${purpose}-${label}.png`,
					fullPage: true,
				});
			}
			expect(await page.content()).not.toContain("#token=");
		}
	});
}
test("Owner auth uses supported language throughout public stages", async ({
	page,
}) => {
	for (const locale of locales) {
		await page.goto(`${process.env.PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:8100"}/admin/login/?locale=${locale}`);
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.evaluate(() => document.fonts.ready);
		await page.evaluate(() => {
			(document.activeElement as HTMLElement)?.blur();
			window.scrollTo(0, 0);
		});
		await expect
			.poll(() =>
				page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			)
			.toBe(true);
		await page.screenshot({
			path: `${folder}/owner-${locale}-mobile.png`,
			fullPage: true,
		});
	}
});
