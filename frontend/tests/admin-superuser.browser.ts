import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
import { adminLogin, adminAppearance } from "./support/admin-runtime";

test.skip(
	process.env.MARKETPLACE_BROWSER_TESTS !== "1",
	"Use the maintained owned-resource runner.",
);
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test("canonical super admin: native coverage, sidebar, forms and responsive important workflows", async ({
	browser,
}) => {
	test.setTimeout(240000);
	const identity = JSON.parse(
		disposablePython(
			"import json,sys,uuid\nfrom apps.accounts.models import User\nd=json.load(sys.stdin)\nu=User.objects.create_user('canonical-browser-'+uuid.uuid4().hex+'@example.test',d['password'],display_name='Canonical browser super admin',email_verified=True,is_staff=True,is_superuser=True,owner_authority=False)\nprint(json.dumps({'email':u.email,'id':str(u.pk)}))",
			JSON.stringify({ password: fixturePassword }),
		),
	) as { email: string; id: string };
	const context = await browser.newContext(),
		page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 1000 });
	await adminLogin(page, identity.email);
	await expect(page.getByTestId("owner-dashboard")).toBeVisible();
    const stylesheet = await page.locator('link[href*="/static/accounts/admin.css"]').getAttribute("href");
    expect(stylesheet).toMatch(/\?v=[a-f0-9]{16}$/);
    const css = await page.request.get(`${apiOrigin}${stylesheet}`);
    expect(css.status()).toBe(200);
    const fingerprint = createHash("sha256").update(await css.body()).digest("hex").slice(0, 16);
    expect(new URL(stylesheet!, apiOrigin).searchParams.get("v")).toBe(fingerprint);

	await expect(page.locator("header").first()).toContainText("Super admin");
	const nav = page.locator("#nav-sidebar-apps");
	if (!(await nav.isVisible()))
		await page
			.getByRole("button", { name: "Toggle navigation", exact: true })
			.click();
	for (const label of [
		"Accounts & Access",
		"Businesses & Verification",
		"Catalogue",
		"Marketplace & Stores",
		"Inventory",
		"System Records",
		"Site Settings",
	])
		await expect(
			nav.getByRole("button", { name: label, exact: true }),
		).toBeVisible();
	await nav
		.getByRole("button", { name: "Accounts & Access", exact: true })
		.click();
	await nav.getByRole("link", { name: "Seller accounts", exact: true }).click();
	await expect(nav.locator('[aria-current="page"]')).toContainText(
		"Seller accounts",
	);
	await page.goto(`${apiOrigin}/admin/accounts/user/?q=canonical-browser`);
	await expect(page.locator("#result_list")).toContainText(identity.email);
	await page.goto(`${apiOrigin}/admin/accounts/user/${identity.id}/change/`);
	await expect(page.getByLabel("Super admin", { exact: true })).toBeChecked();
	const pages = [
		"/admin/",
		"/admin/accounts/user/",
		`/admin/accounts/user/${identity.id}/change/`,
		"/admin/verification/reviewcase/",
		"/admin/catalogue/product/",
		"/admin/marketplace/storerevision/",
		"/admin/inventory/shortage/",
		"/admin/site-setting/general/",
	];
	for (const [index, url] of pages.entries()) {
		await page.goto(`${apiOrigin}${url}`);
		await expect(page.locator("#content")).toBeVisible();
		for (const [width, theme] of [
			[1440, "light"],
			[390, "dark"],
			[320, "light"],
		] as const) {
			await adminAppearance(page, width, theme);
			await page.screenshot({
				path: `${evidence}/admin-${index}-${width}-${theme}.png`,
				fullPage: true,
			});
			const overflowing = await page
				.locator("#content *")
				.evaluateAll((nodes) =>
					nodes
						.filter((node) => {
							const rect = node.getBoundingClientRect();
							return rect.right > innerWidth + 1 && rect.width > 0;
						})
						.map((node) => ({ tag: node.tagName, classes: node.className }))
						.slice(0, 8),
				);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
				JSON.stringify(overflowing),
			).toBeLessThanOrEqual(width);
			await page.screenshot({
				path: `${evidence}/admin-${index}-${width}-${theme}.png`,
				fullPage: true,
			});
		}
	}
	await page.setViewportSize({ width: 390, height: 900 });
	await page
		.getByRole("button", { name: "Toggle navigation", exact: true })
		.click();
	const all = page.getByRole("button", {
		name: "All applications",
		exact: true,
	});
	await all.click();
	await expect(all).toHaveAttribute("aria-expanded", "true");
	await expect(
		page
			.getByRole("dialog")
			.getByRole("link", { name: "Authenticators", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(all).toBeFocused();
	await expect(all).toHaveAttribute("aria-expanded", "false");
	const search = page.getByRole("button", {
		name: "Search apps and models...",
		exact: true,
	});
	await search.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("#search-input-command")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(search).toBeFocused();
	await context.close();
});

test("expanded native sidebar supports wheel, keyboard and last-link access at short viewport heights", async ({
	browser,
}) => {
	test.setTimeout(180000);
	const identity = JSON.parse(
		disposablePython(
			"import json,sys,uuid\nfrom apps.accounts.models import User\nd=json.load(sys.stdin)\nu=User.objects.create_user('scroll-'+uuid.uuid4().hex+'@example.test',d['password'],display_name='Synthetic scroll admin',email_verified=True,is_staff=True,is_superuser=True)\nprint(json.dumps({'email':u.email}))",
			JSON.stringify({ password: fixturePassword }),
		),
	) as { email: string };
	const context = await browser.newContext();
	const page = await context.newPage();
	await adminLogin(page, identity.email);
	for (const width of [1440, 390, 320]) {
		for (const theme of ["light", "dark"] as const) {
			await adminAppearance(page, width, theme);
			await page.setViewportSize({ width, height: 600 });
			const nav = page.locator("#nav-sidebar-apps");
            if (width < 1280) await expect(nav).toBeHidden();
			if (!(await nav.isVisible()))
				await page
					.getByRole("button", { name: "Toggle navigation", exact: true })
					.click();
            await expect(nav).toBeVisible();
			const groups = nav.getByRole("button");
			for (let i = 0; i < (await groups.count()); i++) {
				const group = groups.nth(i);
				if ((await group.getAttribute("aria-expanded")) === "false")
					await group.click();
			}
			const metrics = await nav.evaluate((el) => ({
				height: el.clientHeight,
				content: el.scrollHeight,
				overflow: getComputedStyle(el).overflowY,
			}));
			expect(metrics.height).toBeGreaterThan(100);
			expect(metrics.content).toBeGreaterThan(metrics.height);
			expect(metrics.overflow).toBe("auto");
			await test
				.info()
				.attach(`sidebar-${width}-${theme}-metrics`, {
					body: JSON.stringify(metrics),
					contentType: "application/json",
				});
			await nav.evaluate((el) => {
				el.scrollTop = 0;
			});
			await nav.hover();
			await page.mouse.wheel(0, 500);
			await expect
				.poll(() => nav.evaluate((el) => el.scrollTop))
				.toBeGreaterThan(0);
			await nav.evaluate((el) => {
				el.scrollTop = 0;
			});
			await nav.focus();
			await page.keyboard.press("PageDown");
			await expect
				.poll(() => nav.evaluate((el) => el.scrollTop))
				.toBeGreaterThan(0);
			await page.keyboard.press("End");
			const last = nav.getByRole("link").last();
			await expect(last).toBeInViewport();
			await expect(
				page.locator('[aria-controls="owner-user-menu"]'),
			).toBeInViewport();
			await expect(
				page.getByRole("button", {
					name: "Search apps and models...",
					exact: true,
				}),
			).toBeInViewport();
			await page.screenshot({
				path: `${evidence}/sidebar-scroll-${width}-${theme}.png`,
			});
			const href = await last.getAttribute("href");
			await last.click();
			await expect(page).toHaveURL(`${apiOrigin}${href}`);
			await expect(page.locator("#content")).toBeVisible();
		}
	}
	await context.close();
});
