import { test, expect } from "@playwright/test";
import {
	catalogueActor,
	catalogueApi,
	catalogueReviewProduct,
} from "./support/catalogue-runtime";
import { catalogueCopy, catalogueStatuses } from "../lib/i18n/catalogue";
import { apiOrigin, disposablePython } from "./support/identity-runtime";
test.skip(
	process.env.CATALOGUE_DISABLED_BROWSER_TESTS !== "1",
	"Run in the dedicated unconfigured-provider mode.",
);
test("unconfigured Groq remains visibly pending and never reports a completed draft", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const context = await catalogueActor(browser, "full"),
		page = await context.newPage();
	await page.goto("/en/account/staff/catalogue");
	const product = catalogueReviewProduct("food");
	await page.goto(`/en/account/staff/catalogue/${product.id}`);
	await expect(page.getByText(catalogueCopy.en.providerPending)).toBeVisible();
	const generated = page.waitForResponse(
		(r) =>
			r.url().includes("/translations/") && r.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: catalogueCopy.en.generate, exact: true })
		.click();
	expect((await generated).status()).toBe(200);
	await expect(
		page.getByRole("status").filter({ hasText: catalogueStatuses.en.blocked }),
	).toBeVisible();
	const detail = (await catalogueApi(page, `staff/products/${product.id}/`))
		.body;
	expect(detail.provider).toBe("groq_unconfigured");
	const row = detail.translations.find(
		(t: { locale: string }) => t.locale === "en",
	);
	expect(row.job.status).toBe("blocked");
	expect(row.title).toBe("");
	expect(
		(
			await (
				await page.request.get(
					`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
				)
			).json()
		).source_fallback,
	).toBe(true);
	const before = await (
		await page.request.get(
			`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
		)
	).json();
	disposablePython(
		"import json,sys\nfrom apps.catalogue.models import Product\np=Product.objects.get(pk=json.load(sys.stdin)['id'])\nassert p.seller.display_name.startswith('Synthetic')\np.seller.cases.filter(revision=p.seller.revision).update(status='suspended')",
		JSON.stringify({ id: product.id }),
	);
	expect(
		(
			await page.request.get(
				`${apiOrigin}/api/v1/catalogue/published/en/${product.id}/`,
			)
		).status(),
	).toBe(404);
	expect(
		(await page.request.get(apiOrigin + before.images[0].url)).status(),
	).toBe(404);
	expect(
		(await page.request.get(`/en/catalogue-preview/${product.id}`)).status(),
	).toBe(404);
	await context.close();
});
