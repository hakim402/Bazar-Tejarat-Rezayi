import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { authCopy } from "../lib/i18n/auth";
import { accessCopy } from "../lib/i18n/access";
import { direction, locales } from "../lib/i18n/locales";
import { accountSettingsCopy } from "../lib/i18n/account-settings";
import { organizationCopy } from "../lib/i18n/organizations";
import { messages } from "../lib/i18n/messages";
import { choosePreference } from "./support/site-preferences";
import {
	disposablePython,
	fixturePassword,
	identityTestsEnabled,
} from "./support/identity-runtime";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	!identityTestsEnabled,
	"Use the maintained disposable native runner.",
);
for (const locale of locales)
	for (const width of [390, 1440]) {
		test(`modal-only access, history and refresh ${locale} ${width}`, async ({
			page,
		}) => {
			test.setTimeout(60000);
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`/${locale}/about#main`);
			const trigger = page
				.locator("header")
				.getByRole("link", { name: accessCopy[locale].login, exact: true });
			await trigger.click();
			const modal = page.getByRole("dialog");
			await expect(modal).toBeVisible();
			await expect(modal.getByRole("heading", { level: 1 })).toBeFocused();
			await page.keyboard.press("Escape");
			await expect(modal).toHaveCount(0);
			expect(new URL(page.url()).hash).toBe("#main");
			await expect(trigger).toBeFocused();
			await trigger.click();
			await modal
				.getByRole("link", { name: authCopy[locale].newAccount, exact: true })
				.click();
			await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
				authCopy[locale].buyerRegister,
			);
			await expect(modal.locator('[name="intent"]')).toHaveCount(0);
			await expect(page.getByRole("dialog")).toHaveCount(1);
			await expect(
				page.locator('form:has(input[name="password"])'),
			).toHaveCount(1);
			await page.goBack();
			await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
				authCopy[locale].buyerSignin,
			);
			await page.goForward();
			await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
				authCopy[locale].buyerRegister,
			);
			await page.reload();
			await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
				authCopy[locale].buyerRegister,
			);
			expect(new URL(page.url()).pathname).toBe(`/${locale}/about`);
			for (const theme of ["light", "dark"]) {
				await choosePreference(page, messages[locale].theme, theme);
				await expect(modal).toBeVisible();
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				await page.screenshot({
					path: `${evidence}/consolidated-modal-${locale}-${width}-${theme}.png`,
					fullPage: false,
				});
			}
		});
	}
for (const role of ["buyer", "seller"] as const) {
	test(`basic ${role} business setup stays draft and preserves primary account`, async ({
		page,
	}) => {
		test.setTimeout(120000);
		const email = `consolidated-${role}-${randomBytes(5).toString("hex")}@example.test`;
		disposablePython(
			"import json,sys\nfrom apps.accounts.models import User,Account\nd=json.load(sys.stdin)\nu=User.objects.create_user(d['email'],d['password'],email_verified=True,display_name='DEMO basic account')\nAccount.objects.create(user=u,context=d['role'])",
			JSON.stringify({ email, password: fixturePassword, role }),
		);
		await page.goto(`/en/auth/${role}-sign-in`);
		const modal = page.getByRole("dialog");
		await modal.getByLabel(authCopy.en.email, { exact: true }).fill(email);
		await modal
			.getByLabel(authCopy.en.password, { exact: true })
			.fill(fixturePassword);
		await modal
			.getByRole("button", { name: authCopy.en.signin, exact: true })
			.click();
		await expect(page).toHaveURL(new RegExp(`/account/${role}$`));
		await page.goto(`/en/account/${role}/settings`);
		await expect(page.getByTestId("account-settings")).toBeVisible();
		await page
			.getByText(accountSettingsCopy.en.create, { exact: true })
			.click();
		await expect(page.locator('[name="kind"] option')).toHaveCount(1);
		await expect(page.locator('[name="kind"]')).toHaveValue(
			role === "seller" ? "company" : "business",
		);
		const name = `DEMO ${role} business`;
		await page.locator('[name="display_name"]').fill(name);
		await page
			.getByRole("button", { name: organizationCopy.en.create, exact: true })
			.click();
		await expect(
			page.getByRole("link").filter({ hasText: name }),
		).toBeVisible();
		const result = JSON.parse(
			disposablePython(
				"import json,sys\nfrom apps.accounts.models import Account\nfrom apps.organizations.models import BusinessProfile\nfrom apps.organizations.profiles import effective_entitlement\nd=json.load(sys.stdin)\na=Account.objects.get(user__email=d['email'],context=d['role'])\np=BusinessProfile.objects.get(account=a)\nprint(json.dumps(dict(intent=a.intent,kind=p.kind,status=p.cases.get().status,entitled=effective_entitlement(p,a))))",
				JSON.stringify({ email, role }),
			),
		);
		expect(result).toEqual({
			intent: "individual",
			kind: role === "seller" ? "company" : "business",
			status: "draft",
			entitled: false,
		});
		await page.evaluate(() => window.scrollTo(0, 0));
		for (const locale of locales)
			for (const width of [390, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(`/${locale}/account/${role}/settings`);
				await expect(
					page.getByRole("link").filter({ hasText: name }),
				).toBeVisible();
				await expect(
					page.getByRole("heading", {
						level: 1,
						name: accountSettingsCopy[locale].title,
						exact: true,
					}),
				).toBeVisible();
				await expect(page.locator("html")).toHaveAttribute(
					"dir",
					direction(locale),
				);
				for (const theme of ["light", "dark"]) {
					await choosePreference(page, messages[locale].theme, theme);
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
					await page.evaluate(() => window.scrollTo(0, 0));
					await page.screenshot({
						path: `${evidence}/consolidated-settings-${role}-${locale}-${width}-${theme}.png`,
						fullPage: true,
					});
				}
			}
	});
}
test("legacy recovery and Google results use the shared modal without business selectors", async ({
	page,
}) => {
	await page.goto(
		"/en/auth/reset-password#token=synthetic-reset-token-with-sufficient-length",
	);
	const modal = page.getByRole("dialog");
	await expect(modal).toBeVisible();
	await expect(page).not.toHaveURL(/#token=/);
	await expect(modal.locator('[name="password"]')).toBeVisible();
	await page.goto(
		"/en/auth/google-result?google=onboarding&context=seller&action=register&attempt=00000000-0000-0000-0000-000000000000",
	);
	await expect(modal.locator('[name="display_name"]')).toBeVisible();
	await expect(modal.locator('[name="intent"]')).toHaveCount(0);
	expect(new URL(page.url()).pathname).toBe("/en/sell");
	await page.keyboard.press("Escape");
	for (const path of [
		"/en/account/staff/settings",
		"/en/about/components",
		"/en/(public)/about",
		"/en/account/seller/inventory/not-a-uuid",
	])
		expect((await page.request.get(path)).status()).toBe(404);
});

test("invitation modal refresh preserves safe return while scrubbing the private fragment", async ({
	page,
}) => {
	const token = randomBytes(32).toString("base64url");
	await page.goto(
		`/en/invitation?auth=seller-sign-in&return=%2Fen%2Finvitation#token=${token}`,
	);
	const modal = page.getByRole("dialog");
	await expect(modal).toBeVisible();
	await expect(page).not.toHaveURL(/#token=/);
	expect(new URL(page.url()).searchParams.get("return")).toBe("/en/invitation");
	await page.reload();
	await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
		authCopy.en.sellerSignin,
	);
	expect(new URL(page.url()).searchParams.get("return")).toBe("/en/invitation");
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
	expect(new URL(page.url()).pathname).toBe("/en/invitation");
});
