import { expect, type Browser, type Page } from "@playwright/test";
import {
	disposablePython,
	fixturePassword,
	apiOrigin,
} from "./identity-runtime";
import { privatePost } from "./messaging-runtime";
export { privatePost, apiOrigin };
export function commerceFixture() {
	return JSON.parse(
		disposablePython(`import json
from apps.organizations.models import BusinessProfile
from apps.catalogue.models import Product
from apps.orders.models import Invoice
a=BusinessProfile.objects.get(account__user__email='phase10-owner-a@example.test',kind='company')
b=BusinessProfile.objects.get(account__user__email='phase10-owner-b@example.test',kind='company')
p=Product.objects.get(seller=a,published__isnull=False)
v=p.variants.order_by('sku').first()
i=Invoice.objects.filter(order__buyer__user__email='phase10-buyer@example.test').order_by('issued_at').first()
print(json.dumps({'companyA':str(a.pk),'companyB':str(b.pk),'product':str(p.pk),'variant':str(v.pk),'invoice':str(i.pk),'number':i.number}))`),
	) as {
		companyA: string;
		companyB: string;
		product: string;
		variant: string;
		invoice: string;
		number: string;
	};
}
export async function commerceLogin(
	browser: Browser,
	role = "buyer",
	existing?: Page,
) {
	const context = role === "buyer" || role === "other" ? "buyer" : "seller",
		session =
			existing?.context() ?? (await browser.newContext({ offline: false })),
		page = existing ?? (await session.newPage());
	await page.goto(`/en/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(`phase10-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	const signed = page.waitForResponse(
		(r) =>
			r.url().endsWith(`/auth/${context}/signin/`) &&
			r.request().method() === "POST",
	);
	await page.locator(".account-card > form button[type=submit]").click();
	expect((await signed).status()).toBe(200);
	await expect(page).toHaveURL(new RegExp(`/account/${context}$`));
	return { session, page };
}
export async function clearCart(page: Page) {
	const cart = await (
		await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)
	).json();
	for (const line of cart.lines) {
		const result = await privatePost(page, "cart/buyer/", {
			command_id: crypto.randomUUID(),
			version: cart.version,
			action: "remove",
			line: line.id,
		});
		expect(result.status()).toBe(200);
		cart.version = (await result.json()).version;
	}
}
export async function addLine(
	page: Page,
	variant: string,
	quantity = "1.000",
	tier = "retail",
) {
	const cart = await (
		await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)
	).json();
	const result = await privatePost(page, "cart/buyer/", {
		command_id: crypto.randomUUID(),
		version: cart.version,
		action: "set",
		variant,
		tier,
		quantity,
	});
	expect(result.status()).toBe(200);
}
export async function fillCheckout(page: Page) {
	await page.getByLabel("Country (ISO code)").selectOption("AF");
	await page.getByLabel("City", { exact: true }).fill("Kabul");
	await page
		.getByRole("combobox", { name: "Payment method", exact: true })
		.selectOption("advance");
}
export async function noOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth + 1,
		),
	).toBe(true);
}
