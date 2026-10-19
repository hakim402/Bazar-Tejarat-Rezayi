import { expect, test } from "@playwright/test";
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
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
			await expect(
				page.getByRole("heading", { name: t.foundation, exact: true }),
			).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			expect(
				await page.evaluate(() =>
					[...document.images].every(
						(img) => img.complete && img.naturalWidth > 0,
					),
				),
			).toBe(true);
			expect(
				await page.evaluate(
					() =>
						[...document.fonts].filter((font) => font.status === "loaded")
							.length,
				),
			).toBeGreaterThan(0);
			for (const theme of ["dark", "light", "system"]) {
				await page.getByLabel(t.theme, { exact: true }).selectOption(theme);
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
			}
			await page.getByLabel(t.theme, { exact: true }).selectOption("dark");
			await page.reload();
			await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
			const api = page.waitForResponse(
				`${apiOrigin}/api/v1/bootstrap/`,
			);
			await page.getByRole("button", { name: t.refresh }).click();
			expect((await api).status()).toBe(200);
			await expect(page.getByRole("status")).toContainText(t.updated);
			expect(
				await page
					.locator(".currency-list bdi")
					.first()
					.evaluate((el) => getComputedStyle(el).direction),
			).toBe("ltr");
			await page.keyboard.press("Tab");
			expect(
				await page.evaluate(() => document.activeElement?.tagName !== "BODY"),
			).toBe(true);
			await page.evaluate(() => {
				(document.activeElement as HTMLElement)?.blur();
				window.scrollTo(0, 0);
			});
			await page.screenshot({
				path: `${evidence}/${locale}-${width}-dark.png`,
				fullPage: true,
			});
			await page.getByLabel(t.theme, { exact: true }).selectOption("light");
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
	await page
		.getByLabel(messages["fa-AF"].language, { exact: true })
		.selectOption("en");
	await expect(page).toHaveURL(/\/en\?currency=USD#main$/);
	await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
test("unavailable and invalid browser responses are honest, retry recovers", async ({
	page,
}) => {
	await page.goto("/en");
	await page.route(`${apiOrigin}/api/v1/bootstrap/`, (route) =>
		route.abort("connectionrefused"),
	);
	await page.getByRole("button", { name: messages.en.refresh }).click();
	await expect(page.locator(".notice-error[role=alert]")).toHaveText(
		messages.en.unavailable,
	);
	await expect(page.locator(".foundation-grid")).toHaveCount(0);
	await page.unrouteAll();
	await page.route(`${apiOrigin}/api/v1/bootstrap/`, (route) =>
		route.fulfill({ contentType: "application/json", body: "{}" }),
	);
	await page.getByRole("button", { name: messages.en.refresh }).click();
	await expect(page.locator(".notice-error[role=alert]")).toHaveText(
		messages.en.invalid,
	);
	await page.unrouteAll();
	await page.getByRole("button", { name: messages.en.refresh }).click();
	await expect(
		page.getByRole("heading", { name: messages.en.foundation, exact: true }),
	).toBeVisible();
});
test("localized unknown routes have honest 404 and preserve deep language path", async ({
	page,
}) => {
	const response = await page.goto(
		"/fa-AF/stores/not-implemented?currency=AFN#main",
	);
	expect(response?.status()).toBe(404);
	await page
		.getByLabel(messages["fa-AF"].language, { exact: true })
		.selectOption("ps");
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
	await page.goto("/en");
	await expect(page.locator(".notice-error[role=alert]")).toHaveText(
		messages.en.unavailable,
	);
	await expect(page.locator(".foundation-grid")).toHaveCount(0);
	await page.getByRole("button", { name: messages.en.refresh }).click();
	await expect(page.locator(".notice-error[role=alert]")).toHaveText(
		messages.en.unavailable,
	);
	await page.screenshot({
		path: `${evidence}/actual-api-outage.png`,
		fullPage: true,
	});
});

test("system theme follows device and keyboard skip link reaches main", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/en");
	await page
		.getByLabel(messages.en.theme, { exact: true })
		.selectOption("system");
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
