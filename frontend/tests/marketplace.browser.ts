import { test, expect } from "@playwright/test";
import { locales } from "../lib/i18n/locales";
import { marketplaceCopy } from "../features/marketplace/copy";
import { choosePreference } from "./support/site-preferences";
import { messages } from "../lib/i18n/messages";
import {
	marketFixture,
	settleMarketplaceImages,
} from "./support/marketplace-runtime";
import { apiOrigin } from "./support/identity-runtime";
import { writeFile } from "node:fs/promises";
test.skip(
	process.env.MARKETPLACE_BROWSER_TESTS !== "1",
	"Use the owned Phase 8 runner.",
);
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
for (const locale of locales)
	for (const width of [1440, 390, 320])
		test(`${locale} ${width}: real marketplace destinations, native direction and themes`, async ({
			page,
		}) => {
			test.setTimeout(150000);
			const f = marketFixture(),
				t = marketplaceCopy[locale];
			await page.setViewportSize({ width, height: 1000 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			for (const theme of width === 390
				? (["light", "dark"] as const)
				: width === 320
					? (["dark"] as const)
					: (["light"] as const)) {
				await page.goto(`/${locale}`);
				await choosePreference(page, messages[locale].theme, theme);
				for (const [name, path] of [
					["home", ""],
					["sell", "/sell"],
					["categories", "/categories"],
					["category", "/categories/food"],
					["products", "/products"],
					["search", "/search?q=Synthetic"],
					["product", `/products/${f.product}`],
					["stores", "/stores"],
					["store", `/stores/${f.seller}`],
					["about", `/stores/${f.seller}/about`],
					["reviews", `/stores/${f.seller}/reviews`],
				] as const) {
					const response = await page.goto(`/${locale}${path}`);
					expect(response?.status()).toBe(200);
					await expect(page.locator("main#main")).toBeVisible();
					await page.evaluate(() => document.fonts.ready);
					expect(await page.locator("html").getAttribute("dir")).toBe(
						locale === "en" ? "ltr" : "rtl",
					);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					expect(await page.locator("main#main").innerText()).not.toContain(
						"PRIVATE-",
					);
					expect(
						await page
							.locator('script[type="application/ld+json"]')
							.allTextContents()
							.then((values) => values.join("\n")),
					).not.toContain("AggregateRating");
					if (name === "reviews")
						await expect(
							page.getByText(t.reviewsLater, { exact: true }),
						).toBeVisible();
					if (["home", "sell", "products", "product", "store"].includes(name)) {
						await settleMarketplaceImages(page);
						if (name === "products" || name === "product") {
							const frame = await page
								.locator(
									name === "products"
										? '[data-testid="marketplace-list"] article img'
										: '[data-testid="product-detail"] section img',
								)
								.first()
								.boundingBox();
							expect(frame).not.toBeNull();
							if (frame)
								expect(
									Math.abs(frame.width - frame.height),
								).toBeLessThanOrEqual(1);
						}
						await page.screenshot({
							path: `${evidence}/market-${locale}-${width}-${theme}-${name}.png`,
							fullPage: true,
						});
					}
					if (name === "home" || name === "sell") {
						const regions = await page.evaluate(() =>
							[
								...document.querySelectorAll(
									"header,footer,main aside,main .hero",
								),
							].map((node) => {
								const s = getComputedStyle(node),
									r = node.getBoundingClientRect();
								return {
									tag: node.tagName,
									class: node.className,
									width: r.width,
									height: r.height,
									padding: s.padding,
									borderRadius: s.borderRadius,
									font: s.fontFamily,
									color: s.color,
									background: s.backgroundColor,
								};
							}),
						);
						await writeFile(
							`${evidence}/protected-${locale}-${width}-${theme}-${name}.json`,
							JSON.stringify(regions, null, 2),
						);
					}
				}
			}
		});
test("URL filters, scope, pagination, back, header search, empty, 404 and unavailable", async ({
	page,
	request,
}) => {
	test.setTimeout(120000);
	const f = marketFixture();
	await page.goto("/en/products");
	await expect(
		page.getByTestId("marketplace-list").locator("article"),
	).toHaveCount(20);
	await page.getByRole("link", { name: "Next", exact: true }).first().click();
	await expect(page).toHaveURL(/page=2/);
	await page.goBack();
	await expect(page).toHaveURL(/\/en\/products$/);
	await page.locator('main input[name="q"]').fill("NoSuchPublicResult");
	await page.locator('main button[type="submit"]').click();
	await expect(
		page.getByText(marketplaceCopy.en.noMatches, { exact: true }),
	).toBeVisible();
	await page.goto(
		`/en/stores/${f.seller}?currency=AFN&tier=retail&sort=price_asc`,
	);
	await expect(page.locator('main select[name="currency"]')).toHaveValue("AFN");
	await expect(page.locator('main select[name="tier"]')).toHaveValue("retail");
	await page.locator('main input[name="q"]').fill("company");
	await page.locator('main button[type="submit"]').click();
	await expect(
		page.getByText(marketplaceCopy.en.noMatches, { exact: true }),
	).toBeVisible();
	await page.goto(`/en/stores/${f.empty}`);
	await expect(
		page.getByText(marketplaceCopy.en.empty, { exact: true }),
	).toBeVisible();
	await page.locator('header input[name="q"]').fill("Synthetic");
	await page.locator('header input[name="q"]').press("Enter");
	await expect(page).toHaveURL(/\/en\/search\?q=Synthetic/);
	expect(
		(
			await request.get("/en/products/00000000-0000-4000-8000-000000000000")
		).status(),
	).toBe(404);
	expect((await request.get("/en/categories/no-such-category")).status()).toBe(
		404,
	);
	expect((await request.get("/en/account/staff")).status()).toBe(404);
	const redirect = await request.get(`/en/catalogue-preview/${f.product}`, {
		maxRedirects: 0,
	});
	expect(redirect.status()).toBe(308);
	expect(redirect.headers().location).toContain(`/products/${f.product}`);
	const product = await request.get(
		`${apiOrigin}/api/v1/marketplace/public/en/products/${f.product}/`,
	);
	const body = await product.json();
	expect(body.variants[0].retail).toBe("123456789.12");
	expect(body.variants[0].availability).toBe("available");
	expect(JSON.stringify(body)).not.toMatch(
		/PRIVATE-|storage_alias|physical|held|contact_phone/,
	);
	const sitemap = await request.get("/sitemap.xml");
	expect(sitemap.status()).toBe(200);
	expect(await sitemap.text()).not.toContain(f.product);
});
