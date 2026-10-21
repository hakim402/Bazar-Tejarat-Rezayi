import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
	catalogueActor,
	catalogueApi,
	catalogueOwner,
} from "./support/catalogue-runtime";
import { apiOrigin, disposablePython } from "./support/identity-runtime";
import { catalogueCopy, catalogueStatuses } from "../lib/i18n/catalogue";
import { locales, type Locale } from "../lib/i18n/locales";
const enabled = process.env.CATALOGUE_BROWSER_TESTS === "1";
const evidence =
	process.env.PLAYWRIGHT_EVIDENCE_DIR ??
	"../doc/progress/phase-06-catalogue/evidence";
test.skip(!enabled, "Use the maintained Phase 06 disposable harness.");
async function fixture(page: Page, category = "food") {
	if (page.url() === "about:blank")
		await page.goto("/en/account/seller/catalogue");
	const list = await catalogueApi(page, "seller/products/");
	expect(list.status).toBe(200);
	for (const row of list.body.results) {
		const detail = await catalogueApi(page, `seller/products/${row.id}/`);
		const source = detail.body.revisions[0]?.body;
		// Select the maintained seed identity, not a published product created by another journey.
		if (
			source?.category === category &&
			source.variants.some(
				(v: { sku: string }) => v.sku === `SYN-${category.toUpperCase()}`,
			)
		)
			return detail.body;
	}
	throw new Error("Missing owned synthetic catalogue fixture");
}
async function save(page: Page, locale: Locale = "en") {
	const response = page.waitForResponse(
		(r) =>
			/\/api\/v1\/catalogue\/seller\/products\/[0-9a-f-]+\/$/.test(r.url()) &&
			r.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: catalogueCopy[locale].save, exact: true })
		.click();
	const result = await response;
	expect(result.status()).toBe(200);
	await expect(
		page.getByRole("status").filter({ hasText: catalogueCopy[locale].success }),
	).toBeVisible();
	return result.json();
}
async function action(page: Page, name: string) {
	const response = page.waitForResponse(
		(r) => r.url().endsWith("/actions/") && r.request().method() === "POST",
	);
	await page.getByRole("button", { name, exact: true }).click();
	expect((await response).status()).toBe(200);
}

test("seller creates uploads saves submits; staff publishes exact revision; replacement keeps live prices and source fallback", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const seller = await catalogueActor(browser);
	const page = await seller.newPage();
	await page.goto("/en/account/seller/catalogue");
	await expect(
		page.getByRole("button", { name: catalogueCopy.en.create, exact: true }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: catalogueCopy.en.create, exact: true })
		.click();
	await expect(page).toHaveURL(/catalogue\/[0-9a-f-]+$/);
	const id = page.url().split("/").pop() as string;
	await page
		.locator("#catalogue-body-title")
		.fill(`Synthetic browser ${randomUUID()}`);
	await page
		.locator("#catalogue-body-description")
		.fill("Synthetic source description for review.");
	await page.locator("#catalogue-body-locale").selectOption("fa-AF");
	await page.locator("#catalogue-body-category").selectOption("clothing");
	await page
		.locator("#catalogue-body-variants-0-sku")
		.fill(`SYN-${randomUUID().slice(0, 8)}`);
	await page.locator("#catalogue-body-variants-0-unit").selectOption("piece");
	await page.locator("#catalogue-body-variants-0-increment").fill("1");
	await page.locator("#catalogue-body-variants-0-minimum").fill("1");
	await page.locator("#catalogue-body-variants-0-retail").fill("12.50");
	await page.locator("#catalogue-body-variants-0-wholesale").fill("10.00");
	await page
		.locator("#catalogue-body-variants-0-attributes-size")
		.selectOption("M");
	await page
		.locator("#catalogue-body-variants-0-attributes-color")
		.fill("blue");
	await page
		.getByRole("button", { name: catalogueCopy.en.addVariant, exact: true })
		.click();
	await page
		.locator("#catalogue-body-variants-1-sku")
		.fill(`SYN-L-${randomUUID().slice(0, 8)}`);
	await page.locator("#catalogue-body-variants-1-unit").selectOption("piece");
	await page
		.locator("#catalogue-body-variants-1-attributes-size")
		.selectOption("L");
	await page
		.locator("#catalogue-body-variants-1-attributes-color")
		.fill("blue");
	await page.locator("#catalogue-body-variants-1-retail").fill("20.00");
	await page.locator("#catalogue-body-variants-1-wholesale").fill("15.00");
	const uploaded = page.waitForResponse(
		(r) => r.url().endsWith("/images/") && r.request().method() === "POST",
	);
	await page
		.locator("#catalogue-file")
		.setInputFiles("public/account-welcome.png");
	expect((await uploaded).status()).toBe(201);
	await expect(page.locator("#catalogue-image-add option")).toHaveCount(2);
	await page.locator("#catalogue-image-add").selectOption({ index: 1 });
	await page
		.locator("#catalogue-body-images-0-alt")
		.fill("Synthetic browser uploaded product image");
	const saved = await save(page);
	await page
		.getByRole("button", { name: catalogueCopy.en.saved, exact: true })
		.click();
	await expect(
		page.getByRole("region", { name: new RegExp(catalogueCopy.en.saved) }),
	).toContainText(saved.revision);
	await action(page, catalogueCopy.en.submit);
	const staff = await catalogueActor(browser, "full");
	const review = await staff.newPage();
	await review.goto(`/en/account/staff/catalogue/${id}`);
	await expect(review.locator("#catalogue-revision")).toContainText(
		catalogueStatuses.en.submitted,
	);
	await action(review, catalogueCopy.en.publish);
	const publicResult = await review.request.get(
		`${apiOrigin}/api/v1/catalogue/published/en/${id}/`,
	);
	expect(publicResult.status()).toBe(200);
	expect((await publicResult.json()).source_fallback).toBe(true);
	await review.goto(`/en/catalogue-preview/${id}`);
	await expect(review.getByText(catalogueCopy.en.sourceFallback)).toBeVisible();
	await review.goto(`/en/account/staff/catalogue/${id}`);
	await page.reload();
	await page.locator("#catalogue-body-title").fill("PRIVATE REPLACEMENT");
	await expect(
		page.getByRole("button", { name: catalogueCopy.en.submit, exact: true }),
	).toBeDisabled();
	await save(page);
	await action(page, catalogueCopy.en.submit);
	await page
		.getByText(catalogueCopy.en.priceEdit, { exact: true })
		.first()
		.click();
	await page.locator("#catalogue-prices-0-retail").fill("19.75");
	const priced = page.waitForResponse(
		(r) => r.url().endsWith("/prices/") && r.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: catalogueCopy.en.priceEdit, exact: true })
		.click();
	expect((await priced).status()).toBe(200);
	const before = await (
		await review.request.get(
			`${apiOrigin}/api/v1/catalogue/published/en/${id}/`,
		)
	).json();
	expect(before.body.title).not.toBe("PRIVATE REPLACEMENT");
	expect(before.variants[0].retail).toBe("19.75");
	await review.reload();
	await action(review, catalogueCopy.en.publish);
	const after = await (
		await review.request.get(
			`${apiOrigin}/api/v1/catalogue/published/en/${id}/`,
		)
	).json();
	expect(after.body.title).toBe("PRIVATE REPLACEMENT");
	expect(after.variants[0].retail).toBe("19.75");
	await review.screenshot({
		path: `${evidence}/catalogue-source-exact-en-desktop.png`,
		fullPage: true,
	});
	await seller.close();
	await staff.close();
});

for (const locale of locales)
	test(`catalogue ${locale} mobile/desktop validation dirty buffer keyboard and variant preview`, async ({
		browser,
	}) => {
		test.setTimeout(60000);
		const context = await catalogueActor(browser);
		const page = await context.newPage();
		const product = await fixture(page, "clothing");
		const t = catalogueCopy[locale];
		await page.setViewportSize({
			width: locale === "fa-AF" ? 1440 : 390,
			height: 900,
		});
		if (locale === "ar") await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/${locale}/account/seller/catalogue/${product.id}`);
		await expect(
			page.getByRole("heading", { name: t.title, exact: true }),
		).toBeVisible();
		await page.locator("#catalogue-body-title").fill("<invalid-title>");
		const rejected = page.waitForResponse(
			(r) =>
				r.url().endsWith(`/products/${product.id}/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: t.save, exact: true }).click();
		expect((await rejected).status()).toBe(400);
		await expect(page.locator("#catalogue-body-title")).toHaveValue(
			"<invalid-title>",
		);
		await expect(page.locator("#catalogue-body-title")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		await expect(
			page.getByRole("alert").filter({ hasText: t.invalid }),
		).toContainText(t.plainText);
		await expect(
			page.getByRole("alert").filter({ hasText: t.invalid }),
		).toBeFocused();
		await page.screenshot({
			path: `${evidence}/catalogue-validation-${locale}.png`,
		});
		await page
			.getByRole("alert")
			.filter({ hasText: t.invalid })
			.getByRole("button")
			.first()
			.click();
		await expect(page.locator("#catalogue-body-title")).toBeFocused();
		await expect(
			page.getByRole("button", { name: t.submit, exact: true }),
		).toBeDisabled();
		await page.getByRole("button", { name: t.reload, exact: true }).click();
		await page.getByRole("button", { name: t.cancel, exact: true }).click();
		await expect(page.locator("#catalogue-body-title")).toHaveValue(
			"<invalid-title>",
		);
		await page.getByRole("button", { name: t.discard, exact: true }).click();
		await page.getByRole("button", { name: t.confirm, exact: true }).click();
		await expect(page.locator("#catalogue-body-title")).toHaveValue(
			product.revisions[0].body.title,
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).toBe(true);
		await mkdir(evidence, { recursive: true });
		await page.screenshot({
			path: `${evidence}/catalogue-${locale}-editor.png`,
			fullPage: true,
		});
		await page.screenshot({
			path: `${evidence}/catalogue-${locale}-viewport.png`,
		});
		await page
			.getByRole("region", { name: t.preview, exact: true })
			.screenshot({
				path: `${evidence}/catalogue-${locale}-product-preview.png`,
			});
		if (locale === "fa-AF") {
			await page.setViewportSize({ width: 390, height: 844 });
			await page
				.locator("#catalogue-body-title")
				.fill(
					"محصول آزمایشی با مشخصات کامل و عنوان طولانی برای بررسی خوانایی در تلفون همراه؛ رنگ آبی و اندازهٔ متوسط با واحد فروش روشن و قیمت جداگانه برای هر گونه",
				);
			await page.screenshot({
				path: `${evidence}/catalogue-fa-AF-phone.png`,
				fullPage: true,
			});
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).toBe(true);
		}
		await context.close();
	});

test("automatic publication jobs and manual translation stay private until approval; unpublish revokes new media access", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const seller = await catalogueActor(browser),
		page = await seller.newPage();
	const product = await fixture(page, "electronics");
	const detail = (await catalogueApi(page, `seller/products/${product.id}/`))
		.body;
	const revision = detail.revisions[0];
	if (revision.state === "draft")
		expect(
			(
				await catalogueApi(page, `seller/products/${product.id}/actions/`, {
					version: detail.version,
					revision: revision.id,
					action: "submit",
				})
			).status,
		).toBe(200);
	const staff = await catalogueActor(browser, "full"),
		review = await staff.newPage();
	await review.goto(`/en/account/staff/catalogue/${product.id}`);
	await action(review, catalogueCopy.en.publish);
	await review.locator("#catalogue-translation-locale").selectOption("en");
	await expect(
		review.getByRole("button", {
			name: catalogueCopy.en.generate,
			exact: true,
		}),
	).toBeDisabled();
	await expect
		.poll(
			async () => {
				const d = await catalogueApi(review, `staff/products/${product.id}/`);
				const targets = d.body.translations.filter(
					(tr: { revision: string }) => tr.revision === revision.id,
				);
				return targets.length === 3 &&
					targets.every(
						(tr: { state: string; job?: { status: string } }) =>
							tr.job?.status === "completed" && tr.state === "draft",
					)
					? "completed"
					: "pending";
			},
			{ timeout: 20000 },
		)
		.toBe("completed");
	let published = await (
		await review.request.get(
			`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
		)
	).json();
	expect(published.source_fallback).toBe(true);
	await review
		.getByRole("button", { name: catalogueCopy.en.reload, exact: true })
		.click();
	await expect(review.locator("#catalogue-title")).toHaveValue(
		/^Synthetic en:/,
	);
	await review
		.getByRole("button", {
			name: catalogueCopy.en.translationApprove,
			exact: true,
		})
		.click();
	await expect
		.poll(async () => {
			return (
				await (
					await review.request.get(
						`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
					)
				).json()
			).source_fallback;
		})
		.toBe(false);
	await review.locator("#catalogue-translation-locale").selectOption("ar");
	await review.locator("#catalogue-title").fill("منتج تجريبي معتمد");
	await review.locator("#catalogue-description").fill("وصف تجريبي للمراجعة.");
	for (const field of await review
		.locator('[id^="catalogue-image_alts-"]')
		.all())
		await field.fill("صورة تجريبية");
	await review
		.getByRole("button", {
			name: catalogueCopy.en.translationSave,
			exact: true,
		})
		.click();
	await expect(
		review.getByRole("button", {
			name: catalogueCopy.en.translationApprove,
			exact: true,
		}),
	).toBeEnabled();
	await review
		.getByRole("button", {
			name: catalogueCopy.en.translationApprove,
			exact: true,
		})
		.click();
	await expect
		.poll(async () => {
			return (
				await (
					await review.request.get(
						`${apiOrigin}/api/v1/catalogue/published/ar/${product.id}/`,
					)
				).json()
			).body.title;
		})
		.toBe("منتج تجريبي معتمد");
	published = await (
		await review.request.get(
			`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
		)
	).json();
	const image = published.images[0].url;
	expect((await review.request.get(apiOrigin + image)).status()).toBe(200);
	await review
		.locator("#catalogue-reason")
		.first()
		.fill("Synthetic moderation reason");
	await action(review, catalogueCopy.en.unpublish);
	const absentPreview = await review.request.get(
		`/en/catalogue-preview/${product.id}`,
	);
	expect(absentPreview.status()).toBe(404);
	expect(await absentPreview.text()).not.toContain("منتج تجريبي معتمد");
	expect((await review.request.get(apiOrigin + image)).status()).toBe(404);
	expect(
		(
			await review.request.get(
				`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
			)
		).status(),
	).toBe(404);
	await seller.close();
	await staff.close();
});

test("wrong seller, unapproved applicant, restricted/revoked company member and anonymous image/optimizer cannot read drafts", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const seller = await catalogueActor(browser),
		page = await seller.newPage();
	const product = await fixture(page);
	expect(product.published).toBeNull();
	for (const role of ["unrelated", "unapproved", "restricted", "revoked"]) {
		const context = await catalogueActor(browser, role),
			other = await context.newPage();
		await other.goto("/en/account/seller/catalogue");
		expect([403, 404]).toContain(
			(await catalogueApi(other, `seller/products/${product.id}/`)).status,
		);
		await context.close();
	}
	const anonymous = await browser.newContext();
	const anon = await anonymous.newPage();
	const image = product.images[0];
	expect(
		(
			await anon.request.get(
				`${apiOrigin}/api/v1/catalogue/images/${image.id}/`,
			)
		).status(),
	).toBe(404);
	expect((await anon.request.get(apiOrigin + image.url)).status()).toBe(403);
	const optimizer = await anon.request.get(
		`/_next/image?url=${encodeURIComponent(apiOrigin + image.url)}&w=640&q=75`,
	);
	expect(optimizer.status()).toBe(400);
	await seller.close();
	await anonymous.close();
});

test("staff taxonomy permission can maintain schemas but cannot read product drafts", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const context = await catalogueActor(browser, "taxonomy"),
		page = await context.newPage();
	await page.goto("/en/account/staff/catalogue");
	await page.getByText(catalogueCopy.en.taxonomy, { exact: true }).click();
	await page
		.locator("#catalogue-code")
		.first()
		.fill(`synthetic-${randomUUID().slice(0, 8)}`);
	for (const locale of locales)
		await page
			.locator(`[id="catalogue-labels-${locale}"]`)
			.first()
			.fill(`Synthetic ${locale}`);
	const response = page.waitForResponse(
		(r) => r.url().endsWith("/taxonomy/") && r.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: catalogueCopy.en.save, exact: true })
		.first()
		.click();
	expect((await response).status()).toBe(200);
	const result = await catalogueApi(page, "staff/products/");
	expect(result.body.results).toEqual([]);
	await context.close();
});

test("source reviewer rejects; seller corrects and withdraws later submission without losing approved text", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const seller = await catalogueActor(browser),
		page = await seller.newPage();
	const product = await fixture(page, "food");
	await page.goto(`/en/account/seller/catalogue/${product.id}`);
	await save(page);
	await action(page, catalogueCopy.en.submit);
	const staff = await catalogueActor(browser, "source"),
		review = await staff.newPage();
	await review.goto(`/en/account/staff/catalogue/${product.id}`);
	await review
		.locator("#catalogue-reason")
		.fill("Synthetic source correction requested");
	await action(review, catalogueCopy.en.reject);
	await page.reload();
	await expect(
		page.getByText("Synthetic source correction requested", { exact: true }),
	).toBeVisible();
	await page
		.locator("#catalogue-body-title")
		.fill("Synthetic corrected product");
	await save(page);
	await action(page, catalogueCopy.en.submit);
	await review.reload();
	await action(review, catalogueCopy.en.publish);
	await page.reload();
	await page
		.locator("#catalogue-body-title")
		.fill("Private withdrawn replacement");
	await save(page);
	await action(page, catalogueCopy.en.submit);
	await action(page, catalogueCopy.en.withdraw);
	const publicResult = await (
		await review.request.get(
			`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
		)
	).json();
	expect(publicResult.body.title).toBe("Synthetic corrected product");
	await expect(
		review.getByRole("button", {
			name: catalogueCopy.en.unpublish,
			exact: true,
		}),
	).toBeDisabled();
	await seller.close();
	await staff.close();
});

test("active company catalogue membership revocation denies next action in same browser", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const context = await catalogueActor(browser, "cataloguer"),
		page = await context.newPage();
	await page.goto("/en/account/seller/catalogue");
	const list = await catalogueApi(page, "seller/products/");
	expect(list.body.sellers).toHaveLength(1);
	const created = await catalogueApi(page, "seller/products/", {
		seller: list.body.sellers[0].id,
		currency: "USD",
		pricing_mode: "negotiable",
	});
	expect(created.status).toBe(201);
	disposablePython(
		"from apps.organizations.models import Membership\nMembership.objects.filter(account__user__email='phase06-cataloguer@example.test').update(bundles=[])",
	);
	expect(
		(await catalogueApi(page, `seller/products/${created.body.id}/`)).status,
	).toBe(404);
	expect(
		(
			await catalogueApi(page, "seller/products/", {
				seller: list.body.sellers[0].id,
				currency: "USD",
				pricing_mode: "fixed",
			})
		).status,
	).toBe(403);
	await context.close();
});

test("Dari staff exact source review is usable on desktop and phone", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const context = await catalogueActor(browser, "full"),
		page = await context.newPage();
	await page.goto("/en/account/staff/catalogue");
	const rows = (await catalogueApi(page, "staff/products/")).body.results;
	const item = rows.find((row: { published: string | null }) => row.published);
	expect(item).toBeTruthy();
	await page.goto(`/fa-AF/account/staff/catalogue/${item.id}`);
	await page
		.getByRole("button", { name: catalogueCopy["fa-AF"].saved, exact: true })
		.click();
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).toBe(true);
		await page.screenshot({
			path: `${evidence}/catalogue-staff-fa-AF-${width}.png`,
			fullPage: true,
		});
		await page
			.getByRole("region", { name: new RegExp(catalogueCopy["fa-AF"].saved) })
			.screenshot({
				path: `${evidence}/catalogue-staff-saved-fa-AF-${width}.png`,
			});
	}
	await context.close();
});

test("owner admin ordinary save cannot publish a private revision and guarded forms remain available", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const record = JSON.parse(
		disposablePython(
			"import json\nfrom apps.catalogue.models import Product\nfor p in Product.objects.filter(published__isnull=False):\n r=p.revisions.filter(state='draft').first()\n if r:\n  print(json.dumps({'id':str(p.pk),'published':str(p.published_id),'draft':str(r.pk)}))\n  break",
		),
	);
	const { context, page } = await catalogueOwner(browser);
	await page.goto(`${apiOrigin}/admin/catalogue/product/${record.id}/change/`);
	const csrf = await page
		.locator("input[name=csrfmiddlewaretoken]")
		.first()
		.inputValue();
	const response = await page.request.post(
		`${apiOrigin}/admin/catalogue/product/${record.id}/change/`,
		{
			form: {
				csrfmiddlewaretoken: csrf,
				published: record.draft,
				_save: "Save",
			},
		},
	);
	expect(response.status()).toBe(200);
	const stored = JSON.parse(
		disposablePython(
			"import json,sys\nfrom apps.catalogue.models import Product\np=Product.objects.get(pk=json.load(sys.stdin)['id'])\nprint(json.dumps({'published':str(p.published_id)}))",
			JSON.stringify({ id: record.id }),
		),
	);
	expect(stored.published).toBe(record.published);
	await page.goto(
		`${apiOrigin}/admin/catalogue/product/${record.id}/workflow/?locale=fa-AF`,
	);
	await expect(page.locator("select[name=revision]")).toContainText(
		record.draft,
	);
	await expect(page.locator("textarea[name=reason]")).toHaveClass(
		/border-base/,
	);
	await page.screenshot({
		path: `${evidence}/catalogue-owner-workflow-fa-AF.png`,
		fullPage: true,
	});
	await context.close();
});
