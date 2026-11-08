import { loadRenderedImages } from "./support/rendered-images";
import { inventoryCopy } from "../lib/i18n/inventory";
import { choosePreference } from "./support/site-preferences";
import { writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { locales } from "../lib/i18n/locales";
import { authScreens, screenTitle } from "../lib/i18n/auth-screens";
import { fixturePassword } from "./support/identity-runtime";
import { messages } from "../lib/i18n/messages";
import { storefrontCopy } from "../features/storefront/copy";
import { interfaceCopy } from "../lib/i18n/interface";
import { catalogueCopy } from "../lib/i18n/catalogue";
import { catalogueActor } from "./support/catalogue-runtime";
import { designProduct } from "./support/design-runtime";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.use({ actionTimeout: 10000 });
test.skip(
	process.env.CATALOGUE_BROWSER_TESTS !== "1",
	"Use the maintained disposable native harness.",
);
async function reflow(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	const overflow = await page.evaluate(() => ({
		width: innerWidth,
		scroll: document.documentElement.scrollWidth,
		elements: [...document.querySelectorAll("body *")]
			.filter((element) => {
				const r = element.getBoundingClientRect();
				return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
			})
			.slice(0, 12)
			.map((element) => `${element.tagName}.${element.className}`),
	}));
	expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(
		overflow.width,
	);
	await loadRenderedImages(page);
}
for (const locale of locales)
	for (const width of [360, 1440])
		test(`${locale} ${width}: approved public/auth layouts, original logos and responsive themes`, async ({
			page,
		}) => {
			test.setTimeout(120000);
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`/${locale}`);
			await expect(page.locator("h1")).toHaveCount(1);
			await expect(page.locator("header img").first()).toHaveAttribute(
				"src",
				`/brand/${locale}-horizontal-blue.svg`,
			);
			for (const theme of ["light", "dark"]) {
				await choosePreference(page, messages[locale].theme, theme);
				await reflow(page);
				await page.screenshot({
					path: `${evidence}/approved-home-${locale}-${width}-${theme}.png`,
					fullPage: true,
				});
			}
			await page.goto(`/${locale}/sell`);
			for (const theme of ["light", "dark"]) {
				await choosePreference(page, messages[locale].theme, theme);
				await reflow(page);
				await page.screenshot({
					path: `${evidence}/approved-sell-${locale}-${width}-${theme}.png`,
					fullPage: true,
				});
			}
			for (const screen of authScreens) {
				await test.step(`legacy modal entry ${screen}`, async () => {
					await page.goto(`/${locale}/auth/${screen}`);
					const dialog = page.getByRole("dialog");
					await expect(dialog).toBeVisible({ timeout: 15000 });
					await expect(dialog.locator("h1")).toHaveCount(1);
					await expect(dialog.locator("h1")).toHaveText(
						screenTitle(locale, screen),
					);
					await reflow(page);
				});
			}
			await page.goto(
				`/${locale}/auth/${width === 360 ? "buyer-sign-in" : "seller-registration"}`,
			);
			await choosePreference(page, messages[locale].theme, "light");
			await reflow(page);
			await page.screenshot({
				path: `${evidence}/approved-auth-${locale}-${width}.png`,
				fullPage: true,
			});
		});
test("live category search, footer destinations and compact preferences support keyboard", async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 900 });
	await page.goto("/en");
	const search = page.getByRole("searchbox", {
		name: storefrontCopy.en.search,
	});
	await search.fill("zzzzzz");
	await expect(
		page.getByRole("status").filter({ hasText: storefrontCopy.en.noResults }),
	).toBeVisible();
	await search.press("Escape");
	await expect(search).toHaveValue("");
	await search.fill("Food");
	await page
		.getByRole("link", {
			name: "Food",
			exact: true,
		})
		.last()
		.click();
	await expect(page).toHaveURL("/en/categories/food");
	await page
		.locator("footer")
		.getByRole("link", { name: "Help centre", exact: true })
		.click();
	await expect(page).toHaveURL("/en/help");
	const summary = page
		.locator("header summary")
		.filter({ has: page.locator("svg") })
		.last();
	await summary.click();
	await expect(summary.locator("..")).toHaveAttribute("open", "");
	await summary.press("Escape");
	await expect(summary.locator("..")).not.toHaveAttribute("open", "");
	await expect(summary).toBeFocused();
	await page.getByRole("link", { name: messages.en.skip, exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("main")).toBeFocused();
	await page.evaluate(() => {
		document.body.style.zoom = "2";
	});
	await reflow(page);
});
for (const width of [390, 1440])
	test(`${width}: image-backed product gallery, live prices, dashboard and guarded navigation`, async ({
		browser,
	}) => {
		test.setTimeout(120000);
		const product = designProduct();
		designProduct("saffron");
		const context = await catalogueActor(browser),
			page = await context.newPage();
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/fa-AF/catalogue-preview/${product.id}`);
		await expect(page).toHaveURL(`/fa-AF/products/${product.id}`);
		const gallery = page
				.getByTestId("product-detail")
				.locator("section")
				.first(),
			thumbnails = gallery.getByRole("button");
		await expect(thumbnails).toHaveCount(2);
		await thumbnails.nth(1).focus();
		await page.keyboard.press("Enter");
		await expect(thumbnails.nth(1)).toHaveAttribute("aria-pressed", "true");
		await expect(gallery.locator("img").first()).toHaveAttribute(
			"alt",
			"هدفون آبی، نمای 2",
		);
		await expect(page.getByText("2990.00 AFN", { exact: true })).toBeVisible();
		await expect(page.getByText("2490.00 AFN", { exact: true })).toBeVisible();
		await reflow(page);
		await page.screenshot({
			path: `${evidence}/approved-product-${width}.png`,
			fullPage: true,
		});
		await page.goto("/fa-AF/account/seller/catalogue");
		await expect(
			page.getByRole("region", { name: interfaceCopy["fa-AF"].summary }),
		).toBeVisible();
		expect(
			Number(await page.getByTestId("catalogue-count-published").innerText()),
		).toBeGreaterThanOrEqual(2);
		await reflow(page);
		await page.screenshot({
			path: `${evidence}/approved-dashboard-${width}.png`,
			fullPage: true,
		});
		await page.goto(`/fa-AF/account/seller/catalogue/${product.id}`);
		const input = page.locator("#catalogue-body-title");
		await input.fill("DEMO · ویرایش ذخیره‌نشده");
		const nav = page.getByRole("navigation", {
			name: inventoryCopy["fa-AF"].menu,
		});
		const menu = page.locator("aside summary");
		if (await menu.isVisible()) await menu.click();
		await nav.getByRole("link").first().click();
		const alert = page
			.getByRole("alert")
			.filter({ hasText: catalogueCopy["fa-AF"].dirty });
		await expect(alert).toBeVisible();
		await alert
			.getByRole("button", { name: catalogueCopy["fa-AF"].cancel, exact: true })
			.click();
		await expect(input).toHaveValue("DEMO · ویرایش ذخیره‌نشده");
		await choosePreference(page, messages["fa-AF"].language, "en");
		await alert
			.getByRole("button", {
				name: catalogueCopy["fa-AF"].confirm,
				exact: true,
			})
			.click();
		await expect(page).toHaveURL(`/en/account/seller/catalogue/${product.id}`);
		await context.close();
	});

for (const width of [390, 1440])
	test(`${width}: populated buyer profile and account security cards`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/fa-AF/auth/buyer-sign-in");
		await page.locator("[name=email]").fill("phase03-buyer@example.test");
		await page.locator("[name=password]").fill(fixturePassword);
		await page.locator(".account-card > form button[type=submit]").click();
		await expect(page).toHaveURL("/fa-AF/account/buyer");
		await expect(page.locator(".account-summary")).toBeVisible();
		await reflow(page);
		await page.screenshot({
			path: `${evidence}/approved-buyer-${width}.png`,
			fullPage: true,
		});
		await page.goto("/fa-AF/account/buyer/password");
		await expect(page.locator("[name=current_password]")).toBeVisible();
		await reflow(page);
	});
test("semantic colour contrast and final control styling", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/fa-AF/auth/buyer-sign-in");
	const results: {
		theme: string;
		pairs: {
			foreground: string;
			background: string;
			ratio: number;
			minimum: number;
		}[];
	}[] = [];
	for (const theme of ["light", "dark"]) {
		await choosePreference(page, messages["fa-AF"].theme, theme);
		const pairs = await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			function luminance(hex: string) {
				const v = hex.trim().replace("#", "");
				const h =
					v.length === 3
						? v
								.split("")
								.map((c) => c + c)
								.join("")
						: v;
				const rgb = [0, 2, 4]
					.map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
					.map((c) =>
						c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
					);
				return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
			}
			return [
				["--ink", "--surface", 4.5],
				["--muted", "--surface", 4.5],
				["--action", "--surface", 4.5],
				["--button-text", "--button", 4.5],
				["--control", "--surface", 3],
				["--error", "--error-bg", 4.5],
				["--success", "--success-bg", 4.5],
				["--warning", "--warning-bg", 4.5],
			].map(([a, b, minimum]) => {
				const foreground = style.getPropertyValue(String(a)).trim(),
					background = style.getPropertyValue(String(b)).trim();
				const [low, high] = [luminance(foreground), luminance(background)].sort(
					(x, y) => x - y,
				);
				return {
					foreground,
					background,
					ratio: (high + 0.05) / (low + 0.05),
					minimum: Number(minimum),
				};
			});
		});
		for (const pair of pairs)
			expect(
				pair.ratio,
				`${theme} ${pair.foreground}/${pair.background}`,
			).toBeGreaterThanOrEqual(pair.minimum);
		results.push({ theme, pairs });
		await reflow(page);
		await page.evaluate(() => {
			(document.activeElement as HTMLElement)?.blur();
			window.scrollTo(0, 0);
		});
		await page.screenshot({
			path: `${evidence}/approved-final-controls-${theme}-1440.png`,
			fullPage: true,
		});
	}
	writeFileSync(
		`${evidence}/semantic-contrast.json`,
		JSON.stringify(results, null, 2),
	);
});
for (const width of [1280, 375])
	test(`${width}: Phase 4 editor and inventory composition screenshots`, async ({
		browser,
	}) => {
		test.setTimeout(120000);
		const product = designProduct(),
			context = await catalogueActor(browser),
			page = await context.newPage();
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/en/account/seller/catalogue/${product.id}`);
		for (const title of [
			catalogueCopy.en.basicInfo,
			catalogueCopy.en.variants,
			catalogueCopy.en.pricing,
			catalogueCopy.en.images,
		])
			await expect(
				page.getByRole("heading", { name: title, exact: true }),
			).toBeVisible();
		await expect(page.locator("#catalogue-revision")).toBeVisible();
		await expect(page.locator("#catalogue-revision option").first()).toHaveText(
			catalogueCopy.en.selectRevision,
		);
		await expect(
			page.getByRole("button", { name: /Variant 1/ }).first(),
		).toBeVisible();
		await expect(page.locator("label[for=catalogue-file]")).toBeVisible();
		await expect(
			page.getByRole("region", { name: catalogueCopy.en.preview }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: catalogueCopy.en.save, exact: true }),
		).toBeVisible();
		await choosePreference(page, messages.en.theme, "light");
		await reflow(page);
		await page.screenshot({
			path: `${evidence}/phase4-editor-en-${width}-light.png`,
			fullPage: true,
		});
		await page.goto("/en/account/seller/inventory");
		await page.waitForSelector("main dl a", { timeout: 90000 });
		await expect(
			page.getByRole("heading", {
				name: inventoryCopy.en.inventoryAtGlance,
				exact: true,
			}),
		).toBeVisible();
		expect(await page.locator("main dl a").count()).toBe(7);
		await expect(
			page.getByRole("button", {
				name: inventoryCopy.en.filters,
				exact: true,
			}),
		).toBeVisible();
		if (width === 1280) await expect(page.getByRole("table")).toBeVisible();
		else await expect(page.getByRole("table")).toBeHidden();
		await choosePreference(page, messages.en.theme, "light");
		await reflow(page);
		await page.screenshot({
			path: `${evidence}/phase4-inventory-en-${width}-light.png`,
			fullPage: true,
		});
		await context.close();
	});
