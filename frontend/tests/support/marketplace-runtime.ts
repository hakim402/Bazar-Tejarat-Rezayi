import { expect, type Browser, type Page } from "@playwright/test";
import { disposablePython, fixturePassword } from "./identity-runtime";
export function marketFixture() {
	return JSON.parse(
		disposablePython(
			"import json\nfrom apps.organizations.models import BusinessProfile\nfrom apps.catalogue.models import Product\np=BusinessProfile.objects.get(account__user__email='phase08-seller@example.test',kind='individual')\nc=BusinessProfile.objects.get(account__user__email='phase08-company@example.test')\ne=BusinessProfile.objects.get(account__user__email='phase08-empty@example.test')\nr=Product.objects.filter(seller=p,published__isnull=False).order_by('created_at').first()\nprint(json.dumps({'seller':str(p.pk),'company':str(c.pk),'empty':str(e.pk),'product':str(r.pk)}))",
		),
	) as { seller: string; company: string; empty: string; product: string };
}
export async function marketSeller(browser: Browser, role = "seller") {
	const context = await browser.newContext(),
		page = await context.newPage();
	await page.goto("/en/auth/seller-sign-in");
	await page.locator("[name=email]").fill(`phase08-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	const signed = page.waitForResponse(
		(response) =>
			response.url().endsWith("/auth/seller/signin/") &&
			response.request().method() === "POST",
	);
	await page.locator(".account-card > form button[type=submit]").click();
	expect((await signed).status()).toBe(200);
	await expect(page).toHaveURL(/\/account\/seller$/);
	return { context, page };
}
export async function settleMarketplaceImages(page: Page) {
	await page.evaluate(async () => {
		const height = document.documentElement.scrollHeight;
		for (let y = 0; y < height; y += 800) {
			window.scrollTo(0, y);
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		window.scrollTo(0, 0);
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();
	});
	await page.mouse.move(0, 0);
	await expect
		.poll(
			() =>
				page
					.locator("main#main img")
					.evaluateAll((nodes) =>
						nodes.every(
							(node) =>
								node instanceof HTMLImageElement &&
								node.complete &&
								node.naturalWidth > 0,
						),
					),
			{
				timeout: 15000,
				message: "Public media must finish loading before visual inspection",
			},
		)
		.toBe(true);
}
