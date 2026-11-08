import { test, expect } from "@playwright/test";
import { catalogueActor } from "./support/catalogue-runtime";
import { stockFixture, inventoryApi } from "./support/inventory-runtime";
import { inventoryCopy } from "../lib/i18n/inventory";
import { sellerShellCopy } from "../lib/i18n/seller-shell";
import { locales } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
import { choosePreference } from "./support/site-preferences";
import { adminActor } from "./support/admin-runtime";
import { apiOrigin, disposablePython } from "./support/identity-runtime";
test.skip(
	process.env.INVENTORY_BROWSER_TESTS !== "1",
	"Use the owned Phase 7 runner.",
);
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
for (const locale of locales)
	for (const width of [1440, 390, 320])
		test(`${locale} ${width}: operational screens inherit the approved light/dark design and reflow`, async ({
			browser,
		}) => {
			test.setTimeout(150000);
			const context = await catalogueActor(browser, "stock"),
				page = await context.newPage(),
				f = stockFixture("P7-i-01"),
				batched = stockFixture("P7-i-03"),
				large = stockFixture("P7-i-04"),
				scope = `?seller=${f.seller}`,
				base = `/${locale}/account/seller`;
			await page.setViewportSize({ width, height: 1000 });
			for (const theme of ["light", "dark"]) {
				await page.goto(base + scope);
				await choosePreference(page, messages[locale].theme, theme);
				const screens = [
					"",
					"inventory",
					`inventory/${f.variant}`,
					`inventory/${f.variant}/receipts/new`,
					`inventory/${f.variant}/adjustments/new`,
					`inventory/${f.variant}/settings`,
					"inventory/movements",
					"profile",
					"catalogue",
					`inventory/${batched.variant}/batches/${batched.batch}`,
					`inventory/${batched.variant}/receipts/new`,
					`inventory/${large.variant}`,
					`inventory/${large.variant}/adjustments/new`,
				];
				for (const screen of screens) {
					await page.goto(`${base}${screen ? `/${screen}` : ""}${scope}`);
					await expect(page.locator("main h1").first()).toBeVisible();
					if (!screen && width === 320) {
						const heading = await page.locator("main h1").boundingBox();
						expect(heading?.width).toBeGreaterThanOrEqual(width - 40);
					}
					if (screen === "catalogue")
						await expect(
							page.getByTestId("catalogue-count-total"),
						).toBeVisible();
					await page.evaluate(() => document.fonts.ready);
					await expect(page.locator("main [role=status]")).toHaveCount(0);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					await page.screenshot({
						path: `${evidence}/seller-${locale}-${width}-${theme}-${screen.replaceAll("/", "_") || "overview"}.png`,
						fullPage: true,
					});
				}
			}
			if (width === 390) {
				await page.goto(base + scope);
				const more = page.getByRole("button", {
					name: sellerShellCopy[locale].more,
					exact: true,
				});
				await more.focus();
				await more.press("Enter");
				const drawer = page.getByRole("dialog");
				await expect(drawer).toBeVisible();
				await expect(
					drawer.getByRole("navigation", {
						name: sellerShellCopy[locale].navigation,
						exact: true,
					}),
				).toBeVisible();
				await expect(drawer.locator('a[href*="/notifications"]')).toBeVisible();
				await page.keyboard.press("Escape");
				await expect(drawer).not.toBeVisible();
				await expect(more).toBeFocused();
			}
			await context.close();
		});
test("seller Overview groups, truthful summaries and custom controls remain keyboard accessible", async ({
	browser,
}) => {
	const context = await catalogueActor(browser, "stock");
	const page = await context.newPage();
	const fixture = stockFixture();
	const base = `/en/account/seller?seller=${fixture.seller}`;
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto(base);
	const main = page.locator("main");
	await expect(
		main.getByRole("heading", { name: inventoryCopy.en.overview, exact: true }),
	).toBeVisible();
	await expect(main).toContainText(sellerShellCopy.en.salesUnavailable);
	await expect(main).toContainText(sellerShellCopy.en.attentionCategoriesHint);
	await expect(
		main.getByRole("link", { name: new RegExp(inventoryCopy.en.addProduct) }),
	).toHaveCount(1);
	const sidebar = page.locator("aside");
	const settings = sidebar.getByRole("button", {
		name: sellerShellCopy.en.settingsSecurity,
		exact: true,
	});
	await expect(settings).toHaveAttribute("aria-expanded", "false");
	await settings.press("Enter");
	await expect(settings).toHaveAttribute("aria-expanded", "true");
	await expect(sidebar.locator('a[href*="/password"]')).toBeVisible();
	await settings.click();
	await expect(sidebar.locator('a[href*="/password"]')).not.toBeVisible();
	await page
		.getByRole("button", { name: sellerShellCopy.en.jumpTo, exact: true })
		.click();
	const jump = page.getByRole("dialog", {
		name: sellerShellCopy.en.jumpTo,
		exact: true,
	});
	await jump.getByRole("searchbox").fill("password");
	await expect(jump.locator('a[href*="/password"]')).toBeVisible();
	await jump.getByRole("searchbox").fill("ZZZ-NO-PAGE");
	await expect(jump.getByRole("status")).toHaveText(sellerShellCopy.en.noPages);
	await page.keyboard.press("Escape");
	await expect(jump).not.toBeVisible();
	const theme = page
		.locator("header")
		.getByRole("combobox", { name: messages.en.theme, exact: true });
	await theme.press("End");
	await theme.press("Enter");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await theme.press("Home");
	await theme.press("Enter");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
	const business = main.getByRole("combobox", {
		name: inventoryCopy.en.business,
		exact: true,
	});
	await business.click();
	await expect(
		page.getByRole("listbox", { name: inventoryCopy.en.business, exact: true }),
	).toBeVisible();
	await business.press("Escape");
	await expect(business).toBeFocused();
	await expect(page).toHaveURL(base);
	await page.goto(
		`/en/account/seller/inventory/movements?seller=${fixture.seller}`,
	);
	await expect(
		sidebar.getByRole("button", {
			name: inventoryCopy.en.inventory,
			exact: true,
		}),
	).toHaveAttribute("aria-expanded", "true");
	await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute(
		"href",
		`/en/account/seller/inventory/movements?seller=${fixture.seller}`,
	);
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(base);
	await expect(
		page.getByRole("button", { name: sellerShellCopy.en.jumpTo, exact: true }),
	).toBeVisible();
	const more = page.getByRole("button", {
		name: sellerShellCopy.en.more,
		exact: true,
	});
	await more.click();
	const drawer = page.getByRole("dialog", {
		name: sellerShellCopy.en.navigation,
		exact: true,
	});
	const drawerTheme = drawer.getByRole("combobox", {
		name: messages.en.theme,
		exact: true,
	});
	await drawerTheme.press("End");
	await page.keyboard.press("Escape");
	await expect(drawer).toBeVisible();
	await expect(drawerTheme).toBeFocused();
	await drawerTheme.press("Tab");
	await expect(
		drawer.getByRole("button", { name: sellerShellCopy.en.close, exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(drawer).not.toBeVisible();
	await expect(more).toBeFocused();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(320);
	await context.close();
});

test("strict direct URLs, full-scope filters, pagination, back and profile selection", async ({
	browser,
}) => {
	const context = await catalogueActor(browser, "stock"),
		page = await context.newPage(),
		f = stockFixture();
	await page.goto(`/en/account/seller/inventory?seller=${f.seller}`);
	await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(20);
	await page
		.getByRole("button", { name: inventoryCopy.en.next, exact: true })
		.click();
	await expect(page).toHaveURL(/page=2/);
	await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(6);
	await page.goBack();
	await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(20);
	await page
		.getByRole("combobox", { name: inventoryCopy.en.filter, exact: true })
		.selectOption("unconfigured");
	await expect(page).toHaveURL(/state=unconfigured/);
	const filtered = await inventoryApi(
		page,
		`seller/overview/?seller=${f.seller}&state=unconfigured`,
	);
	expect(filtered.body.count).toBeGreaterThan(0);
	await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(
		filtered.body.count,
	);
	await page
		.getByRole("table")
		.locator("tbody tr")
		.first()
		.locator("td")
		.first()
		.getByRole("link")
		.click();
	await expect(page).toHaveURL(/state=unconfigured/);
	await page
		.locator("main")
		.getByRole("link", { name: inventoryCopy.en.inventory, exact: true })
		.click();
	await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(
		filtered.body.count,
	);
	// Batch movements are a different paginated collection from the stock list.
	const batched = stockFixture("P7-i-03");
	await page.goto(
		`/en/account/seller/inventory/${batched.variant}?seller=${batched.seller}&sort=-sku&page=2`,
	);
	await page.locator('main a[href*="/batches/"]').first().click();
	await expect(page).toHaveURL(
		(url) =>
			url.searchParams.get("page") === null &&
			url.searchParams.get("sort") === "-sku" &&
			url.searchParams.get("seller") === batched.seller,
	);
	await expect(
		page.getByRole("table").locator("tbody tr").first(),
	).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/page=2/);
	for (const route of [
		"inventory/movements/extra",
		"inventory/invalid",
		"inventory/------------------------012345678901",
		"profile/extra",
		"inventory/shortages",
		"mfa-reset",
	]) {
		const r = await page.goto(`/en/account/seller/${route}`);
		expect(r?.status()).toBe(404);
	}
	await page.goto(`/en/account/seller/inventory?seller=${crypto.randomUUID()}`);
	await expect(page.locator("main")).toContainText(inventoryCopy.en.denied);
	await expect(page.getByRole("table")).toHaveCount(0);
	await context.close();
});
test("native shortage reader is scoped and loses access on the next action", async ({
	browser,
}) => {
	const actor = await adminActor(browser, "inventory", ["read_shortages"]);
	await actor.page.goto(`${apiOrigin}/admin/inventory/shortage/`);
	await expect(actor.page.locator("body")).toContainText("synthetic-shortage");
	disposablePython(
		"import json,sys\nfrom django.contrib.auth.models import Group\nGroup.objects.get(pk=json.load(sys.stdin)['group']).permissions.clear()",
		JSON.stringify({ group: actor.group }),
	);
	expect((await actor.page.reload())?.status()).toBe(403);
	await actor.context.close();
});
test("network failure is visibly unavailable and never reports zero", async ({
	browser,
}) => {
	const context = await catalogueActor(browser, "stock"),
		page = await context.newPage(),
		f = stockFixture();
	await page.route("**/api/v1/inventory/seller/overview/**", (r) => r.abort());
	await page.goto(`/en/account/seller?seller=${f.seller}`);
	await expect(page.locator("main").getByRole("alert")).toHaveText(
		inventoryCopy.en.unavailable,
	);
	await expect(page.getByRole("table")).toHaveCount(0);
	await page.screenshot({
		path: `${evidence}/inventory-unavailable.png`,
		fullPage: true,
	});
	await context.close();
});

for (const [role, text] of [
	["unapproved", "denied"],
	["stock-noprofile", "noProfile"],
] as const)
	test(`seller onboarding remains explicit for ${role}`, async ({
		browser,
	}) => {
		const context = await catalogueActor(browser, role),
			page = await context.newPage();
		await page.setViewportSize({ width: 390, height: 900 });
		await page.goto("/fa-AF/account/seller");
		await expect(page.locator("main")).toContainText(
			inventoryCopy["fa-AF"][text],
		);
		await expect(page.getByRole("table")).toHaveCount(0);
		await expect(page.locator("main")).not.toContainText(
			inventoryCopy["fa-AF"].readOnly,
		);
		await expect(
			page
				.locator("main")
				.getByRole("link", { name: inventoryCopy["fa-AF"].help, exact: true }),
		).toBeVisible();
		await page.screenshot({
			path: `${evidence}/seller-${role}-fa-AF-390.png`,
			fullPage: true,
		});
		await context.close();
	});

test("read-only stock details remain usable across locales, themes and phone/desktop widths", async ({
	browser,
}) => {
	test.setTimeout(150000);
	const context = await catalogueActor(browser, "stock-fulfilment"),
		page = await context.newPage(),
		fixture = stockFixture("P7-c-01");
	for (const locale of locales)
		for (const width of [1440, 390, 320])
			for (const theme of ["light", "dark"]) {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(
					`/${locale}/account/seller/inventory/${fixture.variant}?seller=${fixture.seller}`,
				);
				await choosePreference(page, messages[locale].theme, theme);
				await expect(page.locator("main")).toContainText(
					inventoryCopy[locale].readOnly,
				);
				await expect(page.locator("main")).toContainText("P7-c-01");
				await expect(page.locator("main [role=status]")).toHaveCount(0);
				await page.evaluate(() => document.fonts.ready);
				await expect(
					page.locator("main").getByRole("link", {
						name: inventoryCopy[locale].receipt,
						exact: true,
					}),
				).toHaveCount(0);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({
					path: `${evidence}/inventory-readonly-${locale}-${width}-${theme}.png`,
					fullPage: true,
				});
			}
	await context.close();
});
test("a valid empty search stays distinct from unavailable stock in four locales and both themes", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const context = await catalogueActor(browser, "stock"),
		page = await context.newPage(),
		fixture = stockFixture();
	await page.setViewportSize({ width: 390, height: 900 });
	for (const locale of locales)
		for (const theme of ["light", "dark"]) {
			await page.goto(
				`/${locale}/account/seller/inventory?seller=${fixture.seller}&q=ZZZ-NO-SYNTHETIC-MATCH`,
			);
			await choosePreference(page, messages[locale].theme, theme);
			await expect(page.locator("main")).toContainText(
				inventoryCopy[locale].empty,
			);
			await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(0);
			await expect(page.locator("main")).not.toContainText(
				inventoryCopy[locale].unavailable,
			);
			await page.screenshot({
				path: `${evidence}/inventory-empty-${locale}-390-${theme}.png`,
				fullPage: true,
			});
		}
	await context.close();
});
