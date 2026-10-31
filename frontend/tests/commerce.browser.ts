import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import {
	commerceFixture,
	commerceLogin,
	clearCart,
	addLine,
	fillCheckout,
	noOverflow,
	privatePost,
	apiOrigin,
} from "./support/commerce-runtime";
import { commerceCopy } from "../features/orders/copy";
import { disposablePython } from "./support/identity-runtime";
import { catalogueCopy } from "../lib/i18n/catalogue";
const enabled = process.env.COMMERCE_BROWSER_TESTS === "1";
test.describe("Phase 10 complete commerce slice", () => {
	test.beforeEach(() => {
		if (enabled)
			disposablePython(
				"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
			);
	});
	test.skip(!enabled, "Use the maintained disposable Phase 10 runner.");
	test("guest product selection survives buyer sign-in and merges once", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			session = await browser.newContext({ offline: false }),
			page = await session.newPage();
		try {
			await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
			const entry = page.getByTestId("product-cart-action");
			await expect(entry).toBeVisible();
			await entry
				.getByRole("button", { name: "Add to cart", exact: true })
				.click();
			await expect(
				entry.getByText("Saved to cart", { exact: true }),
			).toBeVisible();
			await page.goto("/en/cart");
			await expect(page.getByTestId("cart-workspace")).toContainText("P10-A");
			await commerceLogin(browser, "buyer", page);
			await clearCart(page);
			await page.goto("/en/cart");
			const merge = page.getByRole("button", {
				name: "Merge saved guest selections",
				exact: true,
			});
			await expect(merge).toBeVisible();
			await merge.click();
			await expect(
				page.getByText("Saved selections merged.", { exact: true }),
			).toBeVisible();
			const cart = await (
				await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)
			).json();
			expect(cart.lines).toHaveLength(1);
			expect(cart.lines[0].quantity).toBe("1.000");
			await page.reload();
			await expect(merge).toHaveCount(0);
			await noOverflow(page);
		} finally {
			await session.close();
		}
	});
	test("buyer current-price checkout issues retained invoice and actual protected PDF", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser);
		try {
			await clearCart(page);
			await addLine(page, f.variant);
			await page.goto("/en/cart");
			await page.getByRole("link", { name: /Checkout · AFN/ }).click();
			await expect(
				page.getByText(commerceCopy.en.currentPrice, { exact: true }),
			).toBeVisible();
			await expect(page.getByTestId("checkout-seller-name")).toContainText(
				"Synthetic commerce A",
			);
			await expect(page.getByTestId("checkout-seller-name")).not.toContainText(
				f.companyA,
			);
			await fillCheckout(page);
			disposablePython(`from apps.catalogue.models import Variant
Variant.objects.filter(pk=${JSON.stringify(f.variant)}).update(retail="13.75")`);
			const response = page.waitForResponse(
				(r) =>
					r.url().endsWith("/orders/buyer/checkouts/") &&
					r.request().method() === "POST",
			);
			await page
				.getByRole("button", { name: "Submit fixed-price orders", exact: true })
				.dblclick();
			const submitted = await (await response).json();
			expect(submitted.outcomes[0].state).toBe("accepted");
			await expect(page.getByTestId("submission-result")).toBeVisible();
			await page
				.getByRole("link", {
					name: new RegExp(submitted.outcomes[0].number + ".*Invoices"),
				})
				.click();
			await expect(page.getByTestId("invoice-document")).toContainText(
				"Unpaid",
			);
			await expect(page.getByTestId("accepted-price-change")).toContainText(
				"12.50 AFN",
			);
			await expect(page.getByTestId("accepted-price-change")).toContainText(
				"13.75 AFN",
			);
			const download = page.waitForEvent("download");
			await page
				.getByRole("button", { name: "Download PDF", exact: true })
				.click();
			const file = await (await download).path();
			expect(file).toBeTruthy();
			if (file)
				expect((await fs.readFile(file)).subarray(0, 5).toString()).toBe(
					"%PDF-",
				);
			await noOverflow(page);
			const cart = await (
				await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)
			).json();
			expect(cart.lines).toHaveLength(0);
		} finally {
			disposablePython(`from apps.catalogue.models import Variant
Variant.objects.filter(pk=${JSON.stringify(f.variant)}).update(retail="12.50")`);
			await session.close();
		}
	});
	for (const status of [400, 409, 429])
		test(`lost acknowledgement ${status} keeps UUID and recovers through full locale navigation`, async ({
			browser,
		}) => {
			const f = commerceFixture(),
				{ session, page } = await commerceLogin(browser);
			let first = true;
			const commands: string[] = [];
			try {
				await clearCart(page);
				await addLine(page, f.variant);
				await page.route("**/api/v1/orders/buyer/checkouts/", async (route) => {
					if (route.request().method() !== "POST") return route.continue();
					commands.push(route.request().postDataJSON().command_id);
					if (first) {
						first = false;
						await route.fetch();
						await route.fulfill({
							status,
							contentType: "application/json",
							body: JSON.stringify({
								error: {
									code: "synthetic_lost_response",
									message: "Synthetic",
								},
							}),
						});
					} else await route.continue();
				});
				await page.goto("/en/account/buyer/checkout?currency=AFN");
				await fillCheckout(page);
				await page
					.getByRole("button", {
						name: "Submit fixed-price orders",
						exact: true,
					})
					.click();
				await expect(
					page.getByRole("button", { name: "Retry same request", exact: true }),
				).toBeVisible();
				await expect.poll(() => commands.length).toBe(1);
				expect(new URL(page.url()).searchParams.get("attempt")).toBe(
					commands[0],
				);
				const retained = new URL(page.url());
				retained.pathname = retained.pathname.replace("/en/", "/ar/");
				page.once("dialog", (dialog) => void dialog.accept());
				await page.goto(retained.toString());
				await expect(page.getByTestId("submission-result")).toBeVisible();
				expect(commands).toHaveLength(1);
				await expect(page.getByTestId("submission-result")).toContainText(
					commerceCopy.ar.accepted,
				);
			} finally {
				await session.close();
			}
		});
	test("offline submit retains exact command and online retry reconciles", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser);
		try {
			await clearCart(page);
			await addLine(page, f.variant);
			await page.goto("/en/account/buyer/checkout?currency=AFN");
			await fillCheckout(page);
			await session.setOffline(true);
			await page
				.getByRole("button", { name: "Submit fixed-price orders", exact: true })
				.click();
			await expect(
				page.getByRole("button", { name: "Retry same request", exact: true }),
			).toBeVisible();
			const key = new URL(page.url()).searchParams.get("attempt");
			expect(key).toBeTruthy();
			await session.setOffline(false);
			let command = "";
			page.on("request", (r) => {
				if (
					r.method() === "POST" &&
					r.url().endsWith("/orders/buyer/checkouts/")
				)
					command = r.postDataJSON().command_id;
			});
			await page
				.getByRole("button", { name: "Retry same request", exact: true })
				.click();
			await expect(page.getByTestId("submission-result")).toBeVisible();
			expect(command).toBe(key);
		} finally {
			await session.setOffline(false);
			await session.close();
		}
	});
	test("wholesale failure keeps selection and never falls back to retail", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser);
		try {
			await clearCart(page);
			await addLine(page, f.variant, "1.000", "wholesale");
			await page.goto("/en/account/buyer/checkout?currency=AFN");
			await fillCheckout(page);
			await page
				.getByRole("button", { name: "Submit fixed-price orders", exact: true })
				.click();
			await expect(page.getByTestId("submission-result")).toContainText(
				commerceCopy.en.wholesaleHelp,
			);
			const cart = await (
				await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)
			).json();
			expect(cart.lines[0].tier).toBe("wholesale");
			await clearCart(page);
		} finally {
			await session.close();
		}
	});
	test("finance-only business reads invoices and typed notices without order authority", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser, "finance");
		try {
			await page.goto(`/en/account/seller/invoices?seller=${f.companyA}`);
			await expect(page.getByTestId("orders-workspace")).toContainText(
				f.number,
			);
			expect(
				(
					await page.request.get(
						`${apiOrigin}/api/v1/orders/seller/orders/?seller=${f.companyA}`,
					)
				).status(),
			).toBe(404);
			await page.goto(`/en/account/seller/notifications?seller=${f.companyA}`);
			const notice = page
				.getByRole("link", { name: /Accepted · Invoices/ })
				.first();
			await expect(notice).toBeVisible();
			expect(await notice.getAttribute("href")).toContain("/invoices/");
			await notice.click();
			await expect(page.getByTestId("invoice-document")).toBeVisible();
			await expect(
				page.getByRole("link", { name: "Invoices", exact: true }).first(),
			).toHaveAttribute("aria-current", "page");
			expect(
				(
					await privatePost(
						page,
						`orders/seller/checkout-terms/${f.companyA}/`,
						{
							version: 1,
							enabled: false,
							destinations: [],
							methods: [],
							reason: "forged",
						},
						"PUT",
					)
				).status(),
			).toBe(403);
		} finally {
			await session.close();
		}
	});
	test("owner term settings retain unsaved values and save an exact audited version", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser, "owner-a");
		try {
			await page.goto(
				`/en/account/seller/settings/checkout?seller=${f.companyA}`,
			);
			await expect(page.getByTestId("checkout-settings")).toContainText(
				"Enable checkout",
			);
			await page
				.getByLabel("Reason", { exact: true })
				.fill("Synthetic browser terms attestation");
			await page
				.getByRole("button", { name: "Reload current data", exact: true })
				.click();
			await expect(
				page.getByRole("alert").filter({ hasText: catalogueCopy.en.dirty }),
			).toBeVisible();
			await page
				.getByRole("button", { name: catalogueCopy.en.cancel, exact: true })
				.click();
			await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
				"Synthetic browser terms attestation",
			);
			const saved = page.waitForResponse(
				(r) =>
					r.request().method() === "PUT" && r.url().includes("checkout-terms"),
			);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			expect((await saved).status()).toBe(200);
			await expect(
				page.getByText("Saved to cart", { exact: true }),
			).toBeVisible();
			await noOverflow(page);
		} finally {
			await session.close();
		}
	});
	test("business A to B to A ignores a late read from the old reader", async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser, "operations");
		let release: () => void = () => {};
		let late = false;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			await page.goto(`/en/account/seller/orders?seller=${f.companyA}`);
			await expect(page.getByTestId("orders-workspace")).toContainText(
				f.number,
			);
			await page.route("**/api/v1/orders/seller/orders/**", async (route) => {
				const url = new URL(route.request().url());
				if (url.searchParams.get("seller") === f.companyB && !late) {
					late = true;
					const response = await route.fetch();
					await held;
					await route.fulfill({ response });
				} else await route.continue();
			});
			await page
				.getByLabel("Business", { exact: true })
				.selectOption(f.companyB);
			await expect.poll(() => late).toBe(true);
			await page
				.getByLabel("Business", { exact: true })
				.selectOption(f.companyA);
			await expect(page.getByTestId("orders-workspace")).toContainText(
				f.number,
			);
			release();
			await page.waitForTimeout(100);
			await expect(page.getByTestId("orders-workspace")).toContainText(
				f.number,
			);
		} finally {
			release();
			await session.close();
		}
	});
	for (const locale of ["fa-AF", "ps", "ar", "en"] as const)
		for (const theme of ["light", "dark"] as const)
			test(`invoice and cart ${locale} ${theme} mobile/desktop keyboard and overflow`, async ({
				browser,
			}) => {
				const f = commerceFixture(),
					{ session, page } = await commerceLogin(browser);
				try {
					await page.setViewportSize({ width: 390, height: 844 });
					await page.goto(`/${locale}/account/buyer/invoices/${f.invoice}`);
					await expect(page.getByTestId("invoice-document")).toBeVisible();
					await page.evaluate((theme) => {
						document.documentElement.dataset.theme = theme;
					}, theme);
					await expect(page.locator("html")).toHaveAttribute(
						"dir",
						locale === "en" ? "ltr" : "rtl",
					);
					await noOverflow(page);
					await page.keyboard.press("Tab");
					expect(
						await page.evaluate(() => document.activeElement !== document.body),
					).toBe(true);
					await page.evaluate(() => document.fonts.ready);
					const output = process.env.PLAYWRIGHT_EVIDENCE_DIR;
					if (output && theme === "dark") {
						await fs.mkdir(output, { recursive: true });
						await page.screenshot({
							path: path.join(
								output,
								`commerce-invoice-${locale}-mobile-dark.png`,
							),
						});
					}
					await page.setViewportSize({ width: 1440, height: 960 });
					await noOverflow(page);
					await page.goto(`/${locale}/cart`);
					await expect(page.getByTestId("cart-workspace")).toBeVisible();
					await noOverflow(page);
					await expect(page.getByTestId("cart-workspace")).toContainText(
						commerceCopy[locale].delivery,
					);
				} finally {
					await session.close();
				}
			});
});

for (const locale of ["fa-AF", "ps", "ar", "en"] as const)
	test(`Phase10 localized checkout and owner settings ${locale}`, async ({
		browser,
	}) => {
		test.skip(!enabled, "Use the maintained disposable Phase10 runner.");
		disposablePython(
			"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
		);
		const f = commerceFixture(),
			t = commerceCopy[locale],
			buyer = await commerceLogin(browser),
			owner = await commerceLogin(browser, "owner-a");
		try {
			await clearCart(buyer.page);
			await addLine(buyer.page, f.variant);
			await buyer.page.setViewportSize({ width: 390, height: 844 });
			await buyer.page.goto(`/${locale}/account/buyer/checkout?currency=AFN`);
			await expect(buyer.page.getByTestId("checkout-workspace")).toContainText(
				t.currentPrice,
			);
			await buyer.page
				.getByRole("combobox", { name: t.country, exact: true })
				.selectOption("AF");
			await buyer.page
				.getByRole("textbox", { name: t.city, exact: true })
				.fill("کابل Kabul");
			await buyer.page
				.getByRole("combobox", { name: t.method, exact: true })
				.selectOption("advance");
			await expect(
				buyer.page.getByRole("button", { name: t.submit, exact: true }),
			).toBeEnabled();
			await noOverflow(buyer.page);
			await buyer.page.keyboard.press("Tab");
			expect(
				await buyer.page.evaluate(
					() => document.activeElement !== document.body,
				),
			).toBe(true);
			const output = process.env.PLAYWRIGHT_EVIDENCE_DIR;
			if (output) {
				await fs.mkdir(output, { recursive: true });
				await buyer.page.screenshot({
					fullPage: true,
					path: path.join(
						output,
						`commerce-checkout-${locale}-mobile-light.png`,
					),
				});
			}
			await buyer.page.setViewportSize({ width: 1440, height: 960 });
			await noOverflow(buyer.page);
			await owner.page.goto(
				`/${locale}/account/seller/settings/checkout?seller=${f.companyA}`,
			);
			await expect(owner.page.getByTestId("checkout-settings")).toContainText(
				t.termsHelp,
			);
			await expect(
				owner.page
					.locator(`aside nav a[href^="/${locale}/account/seller/settings"]`)
					.first(),
			).toHaveAttribute("aria-current", "page");
			await owner.page.setViewportSize({ width: 390, height: 844 });
			await noOverflow(owner.page);
			await owner.page
				.getByRole("textbox", { name: t.reason, exact: true })
				.fill("آزمایشی Synthetic unsent reason");
			await owner.page
				.getByRole("button", { name: t.reload, exact: true })
				.click();
			await expect(
				owner.page
					.getByRole("alert")
					.filter({ hasText: catalogueCopy[locale].dirty }),
			).toBeVisible();
			await owner.page
				.getByRole("button", {
					name: catalogueCopy[locale].cancel,
					exact: true,
				})
				.click();
			await expect(
				owner.page.getByRole("textbox", { name: t.reason, exact: true }),
			).toHaveValue("آزمایشی Synthetic unsent reason");
			await owner.page.setViewportSize({ width: 1440, height: 960 });
			await owner.page.evaluate(() => {
				document.documentElement.dataset.theme = "dark";
			});
			await noOverflow(owner.page);
			if (output)
				await owner.page.screenshot({
					path: path.join(
						output,
						`commerce-settings-${locale}-desktop-dark.png`,
					),
				});
		} finally {
			await buyer.session.close();
			await owner.session.close();
		}
	});
test("Phase10 protected native print uses local fonts and paginates in all four locales", async ({
	browser,
}) => {
	test.skip(!enabled, "Use the maintained disposable Phase10 runner.");
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	);
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	try {
		for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
			await page.setViewportSize({ width: 1100, height: 900 });
			const response = await page.goto(
				`${apiOrigin}/api/v1/orders/buyer/invoices/${f.invoice}/print/?locale=${locale}`,
			);
			expect(response?.status()).toBe(200);
			expect(response?.headers()["cache-control"]).toContain("no-store");
			await page.evaluate(() => document.fonts.ready);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				locale === "en" ? "ltr" : "rtl",
			);
			await expect(page.locator("tbody tr")).toHaveCount(40);
			await expect(page.locator("body")).toContainText(f.number);
			const css = await page.locator("style").textContent();
			expect(css).toContain("InvoiceLatin");
			expect(css).toContain("InvoiceArabic");
			expect(await page.locator("body").innerText()).not.toContain(
				"NEVER-PUBLIC",
			);
			const output = process.env.PLAYWRIGHT_EVIDENCE_DIR;
			if (output) {
				await fs.mkdir(output, { recursive: true });
				await page.screenshot({
					path: path.join(output, `commerce-print-${locale}-desktop.png`),
				});
				const printed = await page.pdf({ format: "A4", printBackground: true });
				expect(printed.subarray(0, 5).toString()).toBe("%PDF-");
				await fs.writeFile(
					path.join(output, `commerce-browser-print-${locale}.pdf`),
					printed,
				);
			}
			await page.setViewportSize({ width: 390, height: 844 });
			await noOverflow(page);
		}
	} finally {
		await session.close();
	}
});
