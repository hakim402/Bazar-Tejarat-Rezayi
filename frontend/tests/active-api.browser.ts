import { expect, test } from "@playwright/test";
import { direction, locales } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";

const api = process.env.PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:8100";
for (const locale of locales) {
	test(`active API integration: ${locale} SSR and browser use the ready backend`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.setViewportSize({
			width: locale === "en" ? 1440 : 390,
			height: 900,
		});
		const response = await page.goto(`/${locale}`);
		expect(response?.status()).toBe(200);
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		await expect(page.locator("html")).toHaveAttribute(
			"dir",
			direction(locale),
		);
		await expect(
			page.getByRole("heading", {
				name: messages[locale].foundation,
				exact: true,
			}),
		).toBeVisible();
		const request = page.waitForResponse(`${api}/api/v1/bootstrap/`);
		await page.getByRole("button", { name: messages[locale].refresh }).click();
		const bootstrap = await request;
		expect(bootstrap.status()).toBe(200);
		expect((await bootstrap.json()).default_locale).toBe("fa-AF");
		expect(bootstrap.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
		const readiness = await page.evaluate(async (apiOrigin) => {
			const result = await fetch(`${apiOrigin}/api/v1/health/ready/`, {
				cache: "no-store",
			});
			return { status: result.status, body: await result.json() };
		}, api);
		expect(readiness).toEqual({ status: 200, body: { status: "ready" } });
		expect(errors).toEqual([]);
	});
}
