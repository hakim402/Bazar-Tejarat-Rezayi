import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { authCopy } from "../lib/i18n/auth";
import { accessCopy } from "../lib/i18n/access";
import { messages } from "../lib/i18n/messages";
import { locales, direction } from "../lib/i18n/locales";
import { choosePreference } from "./support/site-preferences";
import {
	identityTestsEnabled as enabled,
	disposablePython,
	fixturePassword as password,
} from "./support/identity-runtime";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(!enabled, "Use the owned native test runner.");
for (const locale of locales) {
	for (const width of [390, 1440]) {
		test(`access guide and dialog ${locale} ${width}`, async ({ page }) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const t = accessCopy[locale],
				auth = authCopy[locale];
			await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
			await page.goto(`/${locale}`);
			const sellerRoute = page
				.locator(".site-header")
				.getByRole("link", { name: t.becomeSeller, exact: true });
			await expect(sellerRoute).toHaveAttribute("href", `/${locale}/sell`);
			await expect(page.locator(".site-header details")).toHaveCount(1);
			await sellerRoute.click();
			await expect(page).toHaveURL(new RegExp(`/${locale}/sell$`));
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				direction(locale),
			);
			await expect(page.getByRole("heading", { name: t.steps })).toBeVisible();
			await choosePreference(
				page,
				messages[locale].theme,
				width === 390 ? "dark" : "light",
			);
			await page.evaluate(async () => {
				await document.fonts.ready;
				(document.activeElement as HTMLElement)?.blur();
			});
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			if (evidence)
				await page.screenshot({
					path: `${evidence}/seller-${locale}-${width}.png`,
					fullPage: true,
				});
			const trigger = page
				.locator("header")
				.getByRole("link", { name: t.login, exact: true });
			await trigger.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("heading", { level: 1 })).toHaveText(
				auth.buyerSignin,
			);
			await expect(dialog.getByRole("heading", { level: 1 })).toBeFocused();
			await expect(
				dialog.getByLabel(auth.email, { exact: true }),
			).toBeVisible();
			expect(
				await dialog.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			if (evidence)
				await page.screenshot({
					path: `${evidence}/login-${locale}-${width}.png`,
				});
			await dialog
				.getByRole("link", { name: auth.newAccount, exact: true })
				.click();
			await expect(dialog.getByRole("heading", { level: 1 })).toHaveText(
				auth.buyerRegister,
			);
			await expect(dialog.getByRole("heading", { level: 1 })).toBeFocused();
			await expect(dialog.getByLabel(auth.name, { exact: true })).toBeVisible();
			await expect(dialog.locator(`a[href*="/auth/seller-"]`)).toHaveCount(0);
			await expect(
				dialog.getByRole("navigation", { name: auth.intent, exact: true }),
			).toHaveCount(0);
			const dimensions = await dialog
				.locator(".overscroll-contain")
				.evaluate((element) => ({
					visible: element.clientHeight,
					content: element.scrollHeight,
				}));
			expect(dimensions.content).toBeLessThanOrEqual(dimensions.visible + 1);
			if (evidence)
				await page.screenshot({
					path: `${evidence}/buyer-registration-${locale}-${width}.png`,
				});
			for (let i = 0; i < 22; i++) {
				await page.keyboard.press("Tab");
				expect(
					await dialog.evaluate((element) =>
						element.contains(document.activeElement),
					),
				).toBe(true);
			}
			await page.keyboard.press("Escape");
			await expect(dialog).not.toBeVisible();
			await expect(trigger).toBeFocused();
			await page.getByRole("link", { name: t.start, exact: true }).click();
			await expect(
				page.getByRole("dialog").getByRole("heading", { level: 1 }),
			).toHaveText(auth.sellerRegister);
			const sellerDialog = page.getByRole("dialog");
			await expect(sellerDialog.locator(`a[href*="/auth/buyer-"]`)).toHaveCount(
				0,
			);
			const sellerDimensions = await sellerDialog
				.locator(".overscroll-contain")
				.evaluate((element) => ({
					visible: element.clientHeight,
					content: element.scrollHeight,
				}));
			expect(sellerDimensions.content).toBeLessThanOrEqual(
				sellerDimensions.visible + 1,
			);
			if (evidence)
				await page.screenshot({
					path: `${evidence}/seller-registration-${locale}-${width}.png`,
				});
			await sellerDialog
				.getByRole("link", { name: auth.existing, exact: true })
				.click();
			await expect(sellerDialog.getByRole("heading", { level: 1 })).toHaveText(
				auth.sellerSignin,
			);
			if (evidence)
				await page.screenshot({
					path: `${evidence}/seller-login-${locale}-${width}.png`,
				});
			if (locale === "en" && width === 1440) {
				await sellerDialog
					.getByRole("link", { name: auth.forgot, exact: true })
					.click();
				await sellerDialog
					.getByRole("link", { name: auth.backSignin, exact: true })
					.click();
				await expect(
					sellerDialog.getByRole("heading", { level: 1 }),
				).toHaveText(auth.sellerSignin);
			}
			await page.getByRole("button", { name: t.close }).click();
			await page.goto(`/${locale}/auth/seller-registration`);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				auth.sellerRegister,
			);
			await expect(
				page.getByRole("radio", { name: auth.company, exact: true }),
			).toBeVisible();
			await expect(
				page
					.locator("main .account-card")
					.getByLabel(auth.email, { exact: true }),
			).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			if (evidence)
				await page.screenshot({
					path: `${evidence}/seller-registration-page-${locale}-${width}.png`,
				});
			expect(errors).toEqual([]);
		});
	}
}
for (const role of ["buyer", "seller"] as const) {
	test(`real ${role} registration through dialog`, async ({ page }) => {
		const email = `access-${role}-${randomBytes(5).toString("hex")}@example.test`;
		await page.goto("/en/sell");
		if (role === "seller")
			await page
				.getByRole("link", { name: accessCopy.en.start, exact: true })
				.click();
		else {
			await page
				.locator("header")
				.getByRole("link", { name: accessCopy.en.login, exact: true })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("link", { name: authCopy.en.newAccount, exact: true })
				.click();
		}
		const dialog = page.getByRole("dialog");
		await dialog
			.getByLabel(authCopy.en.name, { exact: true })
			.fill("Synthetic Access Person");
		await dialog.getByLabel(authCopy.en.email, { exact: true }).fill(email);
		await dialog
			.getByLabel(authCopy.en.password, { exact: true })
			.fill(password);
		await dialog.getByLabel(authCopy.en.consent, { exact: true }).check();
		await dialog.locator(".account-card > form button[type=submit]").click();
		await expect(dialog.getByRole("status")).toHaveText(authCopy.en.requested);
		const result = JSON.parse(
			disposablePython(
				`from apps.accounts.models import User\nimport json\nu=User.objects.get(email=${JSON.stringify(email)})\nprint(json.dumps({'verified':u.email_verified,'roles':list(u.accounts.values_list('context',flat=True))}))`,
			),
		);
		expect(result).toEqual({ verified: false, roles: [role] });
	});
}
test("real login separate buyer and seller grants appear in navbar", async ({
	page,
}) => {
	test.setTimeout(60000);
	for (const role of ["buyer", "seller"] as const) {
		await page.goto("/en/sell");
		if (role === "buyer")
			await page
				.locator("header")
				.getByRole("link", { name: accessCopy.en.login, exact: true })
				.click();
		else
			await page
				.getByRole("link", { name: authCopy.en.sellerSignin, exact: true })
				.first()
				.click();
		const dialog = page.getByRole("dialog");
		await dialog
			.getByLabel(authCopy.en.email, { exact: true })
			.fill("phase03-linked@example.test");
		await dialog
			.getByLabel(authCopy.en.password, { exact: true })
			.fill(password);
		await dialog.locator(".account-card > form button[type=submit]").click();
		await expect(page).toHaveURL(new RegExp(`/en/account/${role}$`));
		await page.goto("/en/sell");
		const profile = page
			.locator(".site-header")
			.getByRole("link", { name: accessCopy.en.account, exact: true });
		await expect(profile).toBeVisible();
		await expect(profile).toHaveAttribute("href", `/en/account/${role}`);
		await expect(profile).toHaveText("");
		await expect(
			page
				.locator(".site-header")
				.getByText(accessCopy.en.account, { exact: true }),
		).toHaveCount(0);
	}
	// Use the real account sign-out controls on the overview.
	await page.goto("/en/account/seller");
	await page
		.getByRole("button", { name: authCopy.en.logoutAll, exact: true })
		.click();
	await expect(
		page
			.locator("header")
			.getByRole("link", { name: accessCopy.en.login, exact: true }),
	).toBeVisible();
	// Opening a modal over a standalone auth route must keep every label association unique.
	await page.context().clearCookies();
	await page.goto("/en/auth/buyer-sign-in");
	await page
		.locator("header")
		.getByRole("link", { name: accessCopy.en.login, exact: true })
		.click();
	await expect(
		page.getByRole("dialog").getByLabel(authCopy.en.email, { exact: true }),
	).toBeVisible();
	const ids = await page
		.locator('input[name="email"]')
		.evaluateAll((elements) => elements.map((element) => element.id));
	expect(new Set(ids).size).toBe(ids.length);
});

test("access MFA error labels remain associated", async ({ page }) => {
	await page.goto("/en/auth/staff-sign-in");
	await page
		.locator("main input[name=email]")
		.fill("phase03-support@example.test");
	await page.locator("main input[name=password]").fill(password);
	await page.locator(".account-card > form button[type=submit]").click();
	await page
		.getByRole("button", { name: authCopy.en.beginEnroll, exact: true })
		.click();
	const code = page.locator('input[name="code"]');
	await code.fill("invalid");
	await page.locator(".account-card > form button[type=submit]").click();
	const error = page.locator(".account-error");
	await expect(error).toContainText(authCopy.en.denied);
	await expect(error).toBeFocused();
	const id = await error.getAttribute("id");
	expect(id).toBeTruthy();
	await expect(code).toHaveAttribute("aria-describedby", id ?? "");
});
