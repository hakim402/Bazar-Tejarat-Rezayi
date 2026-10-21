import { test, expect, type Page } from "@playwright/test";
import {
	catalogueActor,
	catalogueApi,
	catalogueOwner,
	catalogueReviewProduct,
} from "./support/catalogue-runtime";
import { apiOrigin, disposablePython } from "./support/identity-runtime";
import { catalogueCopy } from "../lib/i18n/catalogue";
import { locales } from "../lib/i18n/locales";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	process.env.CATALOGUE_BROWSER_TESTS !== "1",
	"Use the owned Phase 6 harness.",
);
for (const locale of locales) {
	test(`indexed live-price fields and group feedback retain input and focus in ${locale}`, async ({
		browser,
	}) => {
		const product = catalogueReviewProduct();
		const context = await catalogueActor(browser),
			page = await context.newPage();
		if (locale === "ar")
			await page.addInitScript(() =>
				localStorage.setItem("rezayi-theme", "dark"),
			);
		await page.setViewportSize({
			width: locale === "en" ? 1280 : 390,
			height: 844,
		});
		await page.goto(`/${locale}/account/seller/catalogue/${product.id}`);
		const t = catalogueCopy[locale];
		await page.getByText(t.priceEdit, { exact: true }).first().click();
		const retail = page.locator("#catalogue-prices-0-retail"),
			wholesale = page.locator("#catalogue-prices-1-wholesale");
		async function submit(status: number) {
			const response = page.waitForResponse(
				(r) => r.url().endsWith("/prices/") && r.request().method() === "POST",
			);
			await page
				.getByRole("button", { name: t.priceEdit, exact: true })
				.click();
			expect((await response).status()).toBe(status);
		}
		await retail.fill("0");
		await submit(400);
		await expect(retail).toHaveValue("0");
		await expect(retail).toHaveAttribute("aria-invalid", "true");
		await expect(retail).toHaveAttribute(
			"aria-describedby",
			"catalogue-prices-0-retail-error",
		);
		await expect(page.locator("#catalogue-prices-0-retail-error")).toHaveText(
			t.decimal,
		);
		await page
			.getByRole("alert")
			.getByRole("button", { name: t.decimal, exact: true })
			.click();
		await expect(retail).toBeFocused();
		await page.screenshot({
			path: `${evidence}/review-price-${locale}.png`,
			fullPage: true,
		});
		await retail.fill("123.45");
		await expect(retail).toHaveAttribute("aria-invalid", "false");
		await wholesale.fill("0");
		await submit(400);
		await expect(wholesale).toHaveValue("0");
		await expect(wholesale).toHaveAttribute("aria-invalid", "true");
		await page
			.getByRole("alert")
			.getByRole("button", { name: t.decimal, exact: true })
			.click();
		await expect(wholesale).toBeFocused();
		let stored = (await catalogueApi(page, `seller/products/${product.id}/`))
			.body;
		expect(stored.prices[0].retail).toBe("120.50"); // earlier valid row rolled back
		await wholesale.fill("99.99");
		await retail.fill("");
		await page.locator("#catalogue-prices-0-wholesale").fill("");
		await submit(400);
		const group = page.locator("#catalogue-prices-0");
		await expect(group).toHaveAttribute("aria-invalid", "true");
		await expect(group).toHaveAttribute(
			"aria-describedby",
			"catalogue-prices-0-error",
		);
		await expect(page.locator("#catalogue-prices-0-error")).toHaveText(
			t.onePrice,
		);
		await page
			.getByRole("alert")
			.getByRole("button", { name: t.onePrice, exact: true })
			.click();
		await expect(group).toBeFocused();
		await retail.fill("123.45");
		await expect(group).toHaveAttribute("aria-invalid", "false");
		await submit(200);
		await expect(
			page.getByRole("status").filter({ hasText: t.success }),
		).toBeVisible();
		await expect(
			page.locator('[id^="catalogue-prices-"][aria-invalid="true"]'),
		).toHaveCount(0);
		stored = (await catalogueApi(page, `seller/products/${product.id}/`)).body;
		expect(stored.prices[0].retail).toBe("123.45");
		expect(stored.prices[1].wholesale).toBe("99.99");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).toBe(true);
		await context.close();
	});
}

async function ownerSave(page: Page, title: string) {
	await page.locator("#id_title").fill(title);
	await page
		.locator("#id_description")
		.fill("Synthetic translated description for review.");
	const image = await page.locator("#id_image_alts").inputValue();
	const alts = JSON.parse(image || "{}");
	for (const key of Object.keys(alts)) alts[key] = "Synthetic translated image";
	await page.locator("#id_image_alts").fill(JSON.stringify(alts));
	await page.locator("#id_action").selectOption("save");
	await page.locator("#catalogue-operation button[type=submit]").click();
	await expect(page.locator(".errorlist")).toHaveCount(0);
	await expect(page.locator("#id_title")).toHaveValue(title);
}

test("owner loads exact translation versions, saves and approves without repairing tokens, retains stale input", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const p = catalogueReviewProduct("food");
	const { context, page } = await catalogueOwner(browser);
	const base = `${apiOrigin}/admin/catalogue/product/${p.id}/workflow/`;
	await page.goto(`${base}?translation=1&locale=fa-AF`);
	await expect(page.locator("label[for=select_target]")).toHaveText(
		"زبان ترجمه:",
	);
	await expect(page.locator("#id_version")).toHaveValue("1");
	await expect(page.locator("#id_version")).toHaveAttribute("type", "hidden");
	await expect(page.locator("#select_target")).not.toContainText("fa-AF");
	const target = await page.locator("#id_locale").inputValue();
	await ownerSave(page, "ترجمهٔ آزمایشی مالک");
	await expect(page.locator("#id_version")).toHaveValue("2");
	await page.screenshot({
		path: `${evidence}/review-owner-dari.png`,
		fullPage: true,
	});
	// Independent editor opened the exact v2 snapshot before a second owner write.
	const stale = await context.newPage();
	await stale.goto(page.url());
	await ownerSave(page, "نسخهٔ تازهٔ ترجمه");
	await expect(page.locator("#id_version")).toHaveValue("3");
	await stale.locator("#id_title").fill("Retain this concurrent edit");
	await stale.locator("#id_action").selectOption("save");
	await stale.locator("#catalogue-operation button[type=submit]").click();
	await expect(stale.locator(".errorlist")).toBeVisible();
	await expect(stale.locator("#id_title")).toHaveValue(
		"Retain this concurrent edit",
	);
	await expect(stale.locator("#id_version")).toHaveValue("2");
	// Unsaved approval text conflicts rather than approving/discarding it.
	await page.locator("#id_title").fill("Unsaved approval must fail");
	await page.locator("#id_action").selectOption("approve");
	await page.locator("#catalogue-operation button[type=submit]").click();
	await expect(page.locator(".errorlist")).toBeVisible();
	await expect(page.locator("#id_title")).toHaveValue(
		"Unsaved approval must fail",
	);
	await page.goto(
		`${base}?translation=1&locale=en&revision=${p.revision}&target=${target}`,
	);
	await page.locator("#id_action").selectOption("approve");
	await page.locator("#catalogue-operation button[type=submit]").click();
	await expect(page.locator(".errorlist")).toHaveCount(0);
	await expect(page.locator("#id_version")).toHaveValue("4");
	await page.screenshot({
		path: `${evidence}/review-owner-english.png`,
		fullPage: true,
	});
	const other = target === "en" ? "ps" : "en";
	await page.locator("#select_target").selectOption(other);
	await page.locator("#translation-selection button[type=submit]").click();
	await expect(page.locator("#id_version")).toHaveValue("1");
	await ownerSave(page, "Another target draft");
	await expect(page.locator("#id_version")).toHaveValue("2");
	await page.locator("#select_target").selectOption(target);
	await page.locator("#translation-selection button[type=submit]").click();
	await expect(page.locator("#id_version")).toHaveValue("4");
	// A replacement has a new source identity and starts again at translation v1.
	const replacement = JSON.parse(
		disposablePython(
			`
import json,sys
from types import SimpleNamespace
from unittest.mock import patch
from apps.catalogue.models import Product
from apps.catalogue import services
from apps.organizations.access import Actor
p=Product.objects.get(pk=json.load(sys.stdin)['id']);a=Actor(SimpleNamespace(user=p.seller.account.user,account=p.seller.account),'seller')
with patch('apps.organizations.access.get_grant',side_effect=lambda request,context:request.account):
 result=services.save(a,p.pk,{'version':p.version,'body':p.published.body})
 p.refresh_from_db();services.transition(a,p.pk,{'version':p.version,'revision':result['revision'],'action':'submit'})
 p.refresh_from_db();print(json.dumps({'revision':str(result['revision']),'version':p.version}))
`,
			JSON.stringify({ id: p.id }),
		),
	);
	await page.reload();
	await expect(page.locator("#select_revision")).toContainText(
		replacement.revision,
	);
	await page.locator("#select_revision").selectOption(replacement.revision);
	await page.locator("#translation-selection button[type=submit]").click();
	await expect(page.locator("#id_version")).toHaveValue("1");
	await expect(page.locator("#id_title")).toHaveValue("");
	await page.goto(`${base}?locale=en`);
	await expect(page.locator("#id_version")).toHaveValue(
		String(replacement.version),
	);
	await page.locator("#id_revision").selectOption(replacement.revision);
	await page.locator("#id_action").selectOption("publish");
	await page.locator("#catalogue-operation button[type=submit]").click();
	await expect(page.locator(".errorlist")).toHaveCount(0);
	const publicRead = await page.request.get(
		`${apiOrigin}/api/v1/catalogue/published/en/${p.id}/`,
	);
	expect(publicRead.status()).toBe(200);
	expect((await publicRead.json()).source_fallback).toBe(true);
	await context.close();
});
