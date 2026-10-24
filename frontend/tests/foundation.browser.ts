import { choosePreference } from "./support/site-preferences";
import { expect, test } from "@playwright/test";
import { heroUI } from "../features/site/ui";
import { messages } from "../lib/i18n/messages";
import { locales } from "../lib/i18n/locales";
const apiOrigin = process.env.PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:8100";
const evidence =
	process.env.PLAYWRIGHT_EVIDENCE_DIR ?? "../doc/progress/phase-02-foundation";
for (const locale of locales) {
	for (const width of [390, 1440])
		test(`${locale} ${width}: real API, fonts, direction, controls and theme`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.setViewportSize({ width, height: 900 });
			const response = await page.goto(`/${locale}`);
			expect(response?.status()).toBe(200);
			const t = messages[locale];
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				locale === "en" ? "ltr" : "rtl",
			);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(page.locator("main section").first()).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			await expect
				.poll(() =>
					page.evaluate(() =>
						[...document.images]
							.filter((img) => img.getBoundingClientRect().width > 0)
							.every((img) => img.complete && img.naturalWidth > 0),
					),
				)
				.toBe(true);
			expect(
				await page.evaluate(
					() =>
						[...document.fonts].filter((font) => font.status === "loaded")
							.length,
				),
			).toBeGreaterThan(0);
			for (const theme of ["dark", "light", "system"]) {
				await choosePreference(page, t.theme, theme);
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
			}
			await choosePreference(page, t.theme, "dark");
			await page.reload();
			await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
			const api = await page.request.get(
				`${apiOrigin}/api/v1/site/public/${locale}/`,
			);
			expect(api.status()).toBe(200);
			expect(api.headers()["cache-control"]).toBe("no-store");

			// Reload can retain the browser's previous sequential focus position.
			// Start at the skip link, then prove the actual next keyboard target.
			await page.getByRole("link", { name: t.skip, exact: true }).focus();
			await page.keyboard.press("Tab");
			await expect(page.locator("header a").first()).toBeFocused();
			await page.evaluate(() => {
				(document.activeElement as HTMLElement)?.blur();
				window.scrollTo(0, 0);
			});
			await page.screenshot({
				path: `${evidence}/${locale}-${width}-dark.png`,
				fullPage: true,
			});
			await choosePreference(page, t.theme, "light");
			await page.evaluate(() => {
				(document.activeElement as HTMLElement)?.blur();
				window.scrollTo(0, 0);
			});
			await page.screenshot({
				path: `${evidence}/${locale}-${width}-light.png`,
				fullPage: true,
			});
			expect(errors).toEqual([]);
		});
}
test("Dari default ignores browser language; switch preserves query and hash", async ({
	page,
}) => {
	await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
	await page.goto("/?currency=USD#main");
	await expect(page).toHaveURL(/\/fa-AF\?currency=USD#main$/);
	await choosePreference(page, messages["fa-AF"].language, "en");
	await expect(page).toHaveURL(/\/en\?currency=USD#main$/);
	await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
test("localized unknown routes have honest 404 and preserve deep language path", async ({
	page,
}) => {
	const response = await page.goto(
		"/fa-AF/stores/not-implemented?currency=AFN#main",
	);
	expect(response?.status()).toBe(404);
	await choosePreference(page, messages["fa-AF"].language, "ps");
	await expect(page).toHaveURL(
		/\/ps\/stores\/not-implemented\?currency=AFN#main$/,
	);
	await expect(page.locator("html")).toHaveAttribute("lang", "ps");
});

test("actual API outage produces SSR and browser failure without fallback", async ({
	page,
}) => {
	test.skip(
		process.env.API_EXPECT_OFFLINE !== "1",
		"Requires controlled local backend stop.",
	);
	const response = await page.goto("/en");
	expect(response?.status()).toBe(503);
	expect(response?.headers()["retry-after"]).toBe("300");
	await expect(page.locator("main")).toContainText(heroUI.en.unavailable);

	await page.screenshot({
		path: `${evidence}/actual-api-outage.png`,
		fullPage: true,
	});
	await page.goto("/en/auth/buyer-sign-in");
	await expect(page.locator("[name=email]")).toBeVisible();
});

test("system theme follows device and keyboard skip link reaches main", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/en");
	await choosePreference(page, messages.en.theme, "system");
	const light = await page
		.locator("body")
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	await page.emulateMedia({ colorScheme: "dark" });
	const dark = await page
		.locator("body")
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(light).not.toBe(dark);
	await page.keyboard.press("Control+Home");
	await page.locator(".skip-link").focus();
	expect(
		await page
			.locator(".skip-link")
			.evaluate((el) => getComputedStyle(el).outlineStyle),
	).toBe("solid");
	await page.keyboard.press("Enter");
	await expect(page.locator("#main")).toBeFocused();
});
