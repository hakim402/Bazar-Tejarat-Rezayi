import { test, expect } from "@playwright/test";
import {
	catalogueActor,
	catalogueReviewProduct,
} from "./support/catalogue-runtime";
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
	const product = catalogueReviewProduct("food");
	await page.goto(
		`${apiOrigin}/admin/catalogue/product/${product.id}/workflow/?translation=1&revision=${product.revision}&target=en`,
	);
	await expect(
		page.getByText(
			"Automatic draft provider disabled. Manual translation remains available.",
			{ exact: true },
		),
	).toBeVisible();
	await page.locator("#id_action").selectOption("generate");
	await page.locator("#catalogue-operation button").click();
	await expect(
		page.getByText(/en · blocked · Attempts 0 · provider_disabled/),
	).toBeVisible();
	const persisted = JSON.parse(
		disposablePython(
			"import json,sys\nfrom apps.catalogue.models import Translation\nfrom apps.catalogue.translation_provider import provider_status\nd=json.load(sys.stdin)\nt=Translation.objects.get(revision_id=d['revision'],locale='en')\nprint(json.dumps({'provider':provider_status(),'status':t.job.status,'title':t.title,'state':t.state}))",
			JSON.stringify({ revision: product.revision }),
		),
	);
	expect(persisted).toEqual({
		provider: "groq_unconfigured",
		status: "blocked",
		title: "",
		state: "draft",
	});
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
