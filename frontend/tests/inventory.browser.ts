import { test, expect } from "@playwright/test";
import { catalogueActor } from "./support/catalogue-runtime";
import { inventoryApi, stockFixture } from "./support/inventory-runtime";
import { inventoryCopy as copy } from "../lib/i18n/inventory";
test.skip(
	process.env.INVENTORY_BROWSER_TESTS !== "1",
	"Use the owned Phase 7 runner.",
);
test("seller configures, receives, adjusts, reloads, reviews stale input and inspects immutable history", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const context = await catalogueActor(browser, "stock"),
		page = await context.newPage(),
		f = stockFixture(),
		scope = `?seller=${f.seller}`,
		base = `/en/account/seller/inventory/${f.variant}`;
	await page.goto(`${base}/settings${scope}`);
	await page
		.getByLabel(copy.en.reason, { exact: true })
		.fill("Synthetic first stock policy");
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	const confirmation = page.getByRole("dialog");
	await expect(confirmation).toBeVisible();
	await page.keyboard.press("Shift+Tab");
	await expect(
		confirmation.getByRole("button", { name: copy.en.keep, exact: true }),
	).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(
		confirmation.getByRole("button", { name: copy.en.confirm, exact: true }),
	).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(
		confirmation.getByRole("button", { name: copy.en.keep, exact: true }),
	).toBeFocused();
	await page.screenshot({
		path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/inventory-confirmation.png`,
	});
	await page.keyboard.press("Escape");
	await expect(confirmation).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: copy.en.save, exact: true }),
	).toBeFocused();
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();

	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.getByRole("status")).toHaveText(copy.en.saved);
	await page.goto(`${base}/receipts/new${scope}`);
	await page.getByLabel(/Quantity/).fill("10");
	await page
		.getByLabel(copy.en.reason, { exact: true })
		.fill("Synthetic warehouse count");
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText("10.000");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.getByRole("status")).toHaveText(copy.en.saved);
	await page.goto(`${base}/adjustments/new${scope}`);
	await page.getByLabel(/Quantity/).fill("-2");
	await page
		.getByLabel(copy.en.reason, { exact: true })
		.fill("Synthetic correction");
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.getByRole("status")).toHaveText(copy.en.saved);
	await page.goto(base + scope);
	await page.reload();
	await expect(page.locator("main")).toContainText("8.000");
	await page.goto(`${base}/adjustments/new${scope}`);
	await page.getByLabel(/Quantity/).fill("1");
	await page
		.getByLabel(copy.en.reason, { exact: true })
		.fill("Synthetic stale correction");
	const current = await inventoryApi(
		page,
		`seller/variants/${f.variant}/${scope}`,
	);
	expect(current.status).toBe(200);
	expect(
		(
			await inventoryApi(
				page,
				`seller/variants/${f.variant}/adjustments/${scope}`,
				{
					token: crypto.randomUUID(),
					version: current.body.version,
					quantity: "1",
					reason: "Synthetic concurrent count",
				},
			)
		).status,
	).toBe(200);
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.locator("main").getByRole("alert")).toHaveText(
		copy.en.stale,
	);
	await expect(page.getByLabel(/Quantity/)).toHaveValue("1");
	await page.locator("main").focus();
	await page.evaluate(() => scrollTo(0, 0));
	await page.screenshot({
		path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/inventory-stale.png`,
		fullPage: true,
	});
	await page.getByRole("button", { name: copy.en.reload, exact: true }).click();
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.getByRole("status")).toHaveText(copy.en.saved);
	await page.goto(
		`/en/account/seller/inventory/movements${scope}&variant=${f.variant}`,
	);
	await expect(page.getByRole("table")).toContainText(
		"Synthetic stale correction",
	);
	expect(
		(await inventoryApi(page, `seller/variants/${f.variant}/${scope}`)).body
			.physical,
	).toBe("10.000");
	await context.close();
});
test("batch receipt uses exact scope, rejects expired receipt and protects unsaved input", async ({
	browser,
}) => {
	const context = await catalogueActor(browser, "stock"),
		page = await context.newPage(),
		f = stockFixture("P7-i-03"),
		base = `/en/account/seller/inventory/${f.variant}`,
		scope = `?seller=${f.seller}`;
	await page.goto(`${base}/receipts/new${scope}`);
	const existing = await page
		.locator("select[name=batch] option")
		.filter({ hasText: "SYN-LATE" })
		.getAttribute("value");
	if (!existing) throw Error("Missing eligible owned batch");
	await page
		.getByRole("combobox", { name: copy.en.chooseBatch, exact: true })
		.selectOption(existing);
	await expect(page.getByLabel(copy.en.batchCode, { exact: true })).toHaveCount(
		0,
	);
	await page.getByLabel(/Quantity/).fill("1");
	await page
		.getByLabel(copy.en.reason, { exact: true })
		.fill("Synthetic eligible batch receipt");
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.getByRole("status")).toHaveText(copy.en.saved);
	await page.goto(`${base}/receipts/new${scope}`);

	await page.getByLabel(/Quantity/).fill("1");
	await page
		.getByLabel(copy.en.reason, { exact: true })
		.fill("Synthetic receipt");
	await page
		.getByLabel(copy.en.batchCode, { exact: true })
		.fill("SYN-EXPIRED-UI");
	await page.getByLabel(copy.en.expires, { exact: true }).fill("2000-01-01");
	await page.getByRole("button", { name: copy.en.save, exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.confirm, exact: true })
		.click();
	await expect(page.locator("main").getByRole("alert")).toBeVisible();
	await expect(page.locator("main").getByRole("alert")).toBeFocused();
	await page.screenshot({
		path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/inventory-expired-receipt-error.png`,
		fullPage: true,
	});

	const company = stockFixture("P7-c-01");
	await page
		.getByRole("combobox", { name: copy.en.business, exact: true })
		.selectOption(company.seller);
	await expect(page.getByRole("dialog")).toHaveAttribute("open", "");
	await page.screenshot({
		path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/inventory-discard-business.png`,
	});

	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.keep, exact: true })
		.click();
	await expect(
		page.getByRole("combobox", { name: copy.en.business, exact: true }),
	).toHaveValue(f.seller);
	await page.getByRole("link", { name: copy.en.back, exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveAttribute("open", "");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.keep, exact: true })
		.click();
	await expect(page.getByLabel(/Quantity/)).toHaveValue("1");
	await page.getByRole("link", { name: copy.en.back, exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.discardConfirm, exact: true })
		.click();
	await expect(page).toHaveURL(base + scope);
	await page.goto(`${base}/receipts/new${scope}`);
	await page.getByLabel(/Quantity/).fill("2");
	await page
		.getByRole("combobox", { name: copy.en.business, exact: true })
		.selectOption(company.seller);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: copy.en.discardConfirm, exact: true })
		.click();
	await expect(page).toHaveURL(
		`/en/account/seller/inventory?seller=${company.seller}`,
	);
	await expect(page.getByRole("table")).toContainText("P7-c-01");
	await expect(page.getByRole("table")).not.toContainText("P7-i-03");
	await context.close();
});
test("fulfilment read-only and revoked company grants clear current stock", async ({
	browser,
}) => {
	const context = await catalogueActor(browser, "stock-fulfilment"),
		page = await context.newPage(),
		f = stockFixture("P7-c-01");
	await page.goto(
		`/en/account/seller/inventory/${f.variant}?seller=${f.seller}`,
	);
	await expect(page.locator("main")).toContainText(copy.en.readOnly);
	await expect(
		page.getByRole("link", { name: copy.en.receipt, exact: true }),
	).toHaveCount(0);
	const result = await inventoryApi(
		page,
		`seller/variants/${f.variant}/receipts/?seller=${f.seller}`,
		{
			token: crypto.randomUUID(),
			version: 2,
			quantity: "1",
			reason: "Synthetic forbidden",
		},
	);
	expect(result.status).toBe(403);
	await page.route("**/api/v1/inventory/seller/profiles/", (route) =>
		route.fulfill({
			status: 403,
			contentType: "application/json",
			body: '{"code":"permission_denied"}',
		}),
	);
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(page.locator("main")).toContainText(copy.en.denied);
	await expect(page.getByRole("table")).toHaveCount(0);
	await context.close();
});
