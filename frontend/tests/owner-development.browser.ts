import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { locales, direction } from "../lib/i18n/locales";
import { apiOrigin, disposablePython, fixturePassword } from "./support/identity-runtime";

const enabled = process.env.OWNER_DEVELOPMENT_BROWSER_TESTS === "1";
test.skip(!enabled, "Runs separately with the disposable development owner MFA setting disabled.");

for (const locale of locales) {
	test(`development owner password-only sign-in ${locale}`, async ({ page }) => {
		const email = `owner-development-${randomBytes(6).toString("hex")}@example.test`;
		disposablePython(
			"import sys,json\nfrom django.conf import settings\nfrom apps.accounts.models import User\nassert not settings.PRODUCTION and not settings.OWNER_MFA_REQUIRED\ndata=json.load(sys.stdin)\nUser.objects.create_superuser(data['email'],data['password'],display_name='Synthetic development owner',email_verified=True)",
			JSON.stringify({ email, password: fixturePassword }),
		);
		await page.setViewportSize({ width: locale === "en" ? 1440 : 390, height: 900 });
		await page.goto(`${apiOrigin}/admin/login/?locale=${locale}`);
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		await expect(page.locator("html")).toHaveAttribute("dir", direction(locale));
		await expect(page.locator(".private")).toHaveCount(0);
		await page.locator("[name=email]").fill(email);
		await page.locator("[name=password]").fill("incorrect");
		await page.locator("form button").click();
		await expect(page.getByRole("alert")).toBeVisible();
		await page.locator("[name=email]").fill(email);
		await page.locator("[name=password]").fill(fixturePassword);
		await page.locator("form button").click();
		await expect(page).toHaveURL(`${apiOrigin}/admin/`);
		await expect(page.locator('a[href="/admin/accounts/user/"]:visible').first()).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({
			path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/owner-development-${locale}.png`, fullPage: true,
		});
	});
}
