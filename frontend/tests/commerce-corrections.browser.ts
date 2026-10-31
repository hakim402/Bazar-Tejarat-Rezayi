import { choosePreference } from "./support/site-preferences";
import { messages } from "../lib/i18n/messages";
import { test, expect, type Page } from "@playwright/test";
import {
	commerceFixture,
	commerceLogin,
	clearCart,
	addLine,
	apiOrigin,
} from "./support/commerce-runtime";
import {
	privatePost,
	fillCheckout,
	noOverflow,
} from "./support/commerce-runtime";
import { commerceCopy } from "../features/orders/copy";
import type { Locale } from "../lib/i18n/locales";
import { disposablePython } from "./support/identity-runtime";
test.setTimeout(90000);
const enabled = process.env.COMMERCE_BROWSER_TESTS === "1";
test.skip(!enabled, "Use the maintained disposable Phase10 runner.");
test.beforeEach(() => {
	if (enabled)
		disposablePython(
			"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
		);
});
test("R1 delayed cookie-free read cannot hide an acknowledged guest add", async ({
	browser,
}) => {
	const f = commerceFixture(),
		context = await browser.newContext(),
		page = await context.newPage();
	let release!: () => void;
	const barrier = new Promise<void>((r) => (release = r));
	let blocked!: () => void;
	const held = new Promise<void>((r) => (blocked = r));
	let hold = false;
	await context.route("**/api/v1/cart/guest/**", async (route) => {
		if (hold && route.request().method() === "GET") {
			hold = false;
			const reply = await fetch(route.request().url(), {
				headers: route.request().headers(),
			});
			const body = await reply.text();
			blocked();
			await barrier;
			await route.fulfill({
				status: reply.status,
				headers: Object.fromEntries(
					[...reply.headers.entries()].filter(
						([key]) =>
							![
								"content-encoding",
								"content-length",
								"transfer-encoding",
							].includes(key),
					),
				),
				body,
			});
		} else await route.continue();
	});
	try {
		await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
		await expect(page.getByTestId("product-cart-action")).toBeVisible();
		const second = await context.newPage();
		await second.goto("/en");
		const fetchRead = (p: typeof page) =>
			p.evaluate(async (url) => {
				const r = await fetch(url, { credentials: "include" });
				return r.json();
			}, `${apiOrigin}/api/v1/cart/guest/`);
		// Both requests start with no guest cookie. Retain the second response until an add is acknowledged.
		hold = true;
		const late = fetchRead(second);
		await held;
		await fetchRead(page);
		await page
			.getByRole("button", { name: "Add to cart", exact: true })
			.click();
		await expect(
			page.getByText("Saved to cart", { exact: true }),
		).toBeVisible();
		release();
		await late;
		await page.goto("/en/cart");
		await expect(page.getByTestId("cart-workspace")).toContainText("P10-A");
		await commerceLogin(browser, "buyer", page);
		await clearCart(page);
		await page.goto("/en/cart");
		await page
			.getByRole("button", { name: commerceCopy.en.merge, exact: true })
			.click();
		await expect(
			page.getByText(commerceCopy.en.merged, { exact: true }),
		).toBeVisible();
		const original = await (
			await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)
		).json();
		expect(original.lines).toHaveLength(1);
		expect(original.lines[0].quantity).toBe("1.000");
		const receipt = await privatePost(page, "cart/merge/", {
			command_id: crypto.randomUUID(),
			version: original.version,
			guest_version: 0,
		});
		expect(receipt.status()).toBe(200);
		await privatePost(page, "auth/buyer/logout/", {});
		await commerceLogin(browser, "other", page);
		const otherMerge = await privatePost(page, "cart/merge/", {
			command_id: crypto.randomUUID(),
			version: 0,
			guest_version: 1,
		});
		expect(otherMerge.status()).toBe(409);
	} finally {
		release?.();
		await context.close();
	}
});
test("R2 visible Update persists one mouse and keyboard mutation", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	try {
		await clearCart(page);
		await addLine(page, f.variant);
		await page.goto("/en/cart");
		const row = page.getByTestId("cart-workspace").locator("article").first();
		await row.getByRole("textbox").fill("2.000");
		let writes = 0;
		page.on("request", (r) => {
			if (r.method() === "POST" && r.url().endsWith("/cart/buyer/")) writes++;
		});
		await row.getByRole("button", { name: "Update", exact: true }).click();
		await expect.poll(() => writes, { timeout: 2500 }).toBe(1);
		await page.reload();
		await expect(row.getByRole("textbox")).toHaveValue("2.000");
		await row.getByRole("textbox").fill("3.000");
		await row.getByRole("button", { name: "Update", exact: true }).focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => writes).toBe(2);
		await page.reload();
		await expect(row.getByRole("textbox")).toHaveValue("3.000");
	} finally {
		await session.close();
	}
});
test("R3 healthy selections render despite another seller terms 404", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	const variantB = disposablePython(
		`from apps.catalogue.models import Variant\nprint(Variant.objects.filter(product__seller_id=${JSON.stringify(f.companyB)}).first().pk)`,
	).trim();
	try {
		await clearCart(page);
		await addLine(page, f.variant);
		await addLine(page, variantB);
		await page.route(`**/orders/seller/checkout-terms/${f.companyB}/**`, (r) =>
			r.fulfill({
				status: 404,
				contentType: "application/json",
				body: JSON.stringify({ error: { code: "not_found" } }),
			}),
		);
		await page.goto("/en/account/buyer/checkout?currency=AFN");
		await expect(page.locator("form input[type=checkbox]")).toHaveCount(2, {
			timeout: 3500,
		});
	} finally {
		await session.close();
	}
});
test("R4 rejected product quantity can be corrected without remount", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	try {
		await clearCart(page);
		await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
		const form = page.getByTestId("product-cart-action");
		const quantity = form.getByRole("textbox");
		await quantity.fill("0.333");
		await form
			.getByRole("button", { name: "Add to cart", exact: true })
			.click();
		await expect(form.getByRole("alert").first()).toBeVisible();
		// Invalid input must become editable, either immediately or after deliberate server reconciliation.
		const recover = form.getByRole("button", {
			name: "Reconcile request and edit",
			exact: true,
		});
		if (await recover.count()) await recover.click();
		await expect(quantity).toBeEnabled();
		await quantity.fill("2.000");
		await form
			.getByRole("button", { name: "Add to cart", exact: true })
			.click();
		await expect(
			form.getByText("Saved to cart", { exact: true }),
		).toBeVisible();
	} finally {
		await session.close();
	}
});

function variantB(company: string) {
	return disposablePython(`from apps.catalogue.models import Variant
print(Variant.objects.filter(product__seller_id=${JSON.stringify(company)}).first().pk)`).trim();
}
function termsBox(page: Page, seller: string) {
	return page.locator(
		`fieldset[data-testid="checkout-seller"][data-seller="${seller}"]`,
	);
}
function selection(page: Page, seller: string) {
	return page.locator(
		`[data-testid="checkout-selection"][data-seller="${seller}"] input`,
	);
}
async function buyerCart(page: Page) {
	return (await page.request.get(`${apiOrigin}/api/v1/cart/buyer/`)).json();
}

for (const rotation of ["expired", "consumed"] as const)
	test(`R1 delayed ${rotation} read cannot replace a new acknowledged guest contribution`, async ({
		browser,
	}) => {
		const f = commerceFixture(),
			context = await browser.newContext(),
			page = await context.newPage();
		let release!: () => void;
		let blocked!: () => void;
		const barrier = new Promise<void>((r) => (release = r)),
			held = new Promise<void>((r) => (blocked = r));
		try {
			await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
			await page
				.getByRole("button", { name: "Add to cart", exact: true })
				.click();
			await expect(
				page.getByText("Saved to cart", { exact: true }),
			).toBeVisible();
			const old = (await context.cookies(apiOrigin + "/api/v1/cart/")).find(
				(c) => c.name === "rezayi_guest_cart",
			);
			expect(old).toBeTruthy();
			if (rotation === "expired")
				disposablePython(
					`import json,sys
from apps.cart.models import Cart
from django.db.models import F
from django.utils import timezone
from datetime import timedelta
Cart.objects.filter(guest_key=json.load(sys.stdin)['key']).update(expires_at=timezone.now()-timedelta(days=1),version=F('version')+1)`,
					JSON.stringify({ key: old?.value }),
				);
			else {
				await commerceLogin(browser, "buyer", page);
				await clearCart(page);
				await page.goto("/en/cart");
				await page
					.getByRole("button", { name: commerceCopy.en.merge, exact: true })
					.click();
				await expect(
					page.getByText(commerceCopy.en.merged, { exact: true }),
				).toBeVisible();
				await privatePost(page, "auth/buyer/logout/", {});
			}
			let firstRead = true;
			await context.route("**/api/v1/cart/guest/", async (route) => {
				if (route.request().method() !== "GET" || !firstRead)
					return route.continue();
				firstRead = false;
				const r = await fetch(route.request().url(), {
					headers: route.request().headers(),
				});
				const body = await r.text();
				blocked();
				await barrier;
				await route.fulfill({
					status: r.status,
					headers: Object.fromEntries(
						[...r.headers.entries()].filter(
							([k]) =>
								![
									"content-encoding",
									"content-length",
									"transfer-encoding",
								].includes(k),
						),
					),
					body,
				});
			});
			const tab = await context.newPage();
			await tab.goto("/en");
			const late = tab.evaluate(async (url) => {
				const r = await fetch(url, { credentials: "include" });
				return r.json();
			}, apiOrigin + "/api/v1/cart/guest/");
			await held;
			await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
			await page
				.getByRole("button", { name: "Add to cart", exact: true })
				.click();
			await expect(
				page.getByText("Saved to cart", { exact: true }),
			).toBeVisible();
			release();
			await late;
			await page.goto("/en/cart");
			await expect(page.getByTestId("cart-row")).toHaveCount(1);
			await expect(
				page.getByTestId("cart-row").getByRole("textbox"),
			).toHaveValue("1.000");
			const current = (await context.cookies(apiOrigin + "/api/v1/cart/")).find(
				(c) => c.name === "rezayi_guest_cart",
			);
			expect(current?.value).not.toBe(old?.value);
			if (rotation === "consumed") {
				const kept = disposablePython(
					`import json,sys
from apps.cart.models import MergeReceipt
print(MergeReceipt.objects.filter(guest__guest_key=json.load(sys.stdin)['key']).count())`,
					JSON.stringify({ key: old?.value }),
				).trim();
				expect(kept).toBe("1");
			}
		} finally {
			release?.();
			await context.close();
		}
	});
test("R1 simultaneous same-origin tabs coordinate a delayed initializer; late reads preserve buyer sign-in", async ({
	browser,
}) => {
	const f = commerceFixture(),
		context = await browser.newContext();
	let release!: () => void, blocked!: () => void;
	const barrier = new Promise<void>((r) => (release = r)),
		held = new Promise<void>((r) => (blocked = r));
	let count = 0;
	await context.route("**/cart/guest/initialize/", async (route) => {
		count++;
		if (count === 1) {
			const r = await fetch(route.request().url(), {
				method: "POST",
				headers: route.request().headers(),
				body: route.request().postData(),
			});
			const body = await r.text();
			blocked();
			await barrier;
			await route.fulfill({
				status: r.status,
				headers: Object.fromEntries(
					[...r.headers.entries()].filter(
						([k]) =>
							![
								"content-encoding",
								"content-length",
								"transfer-encoding",
							].includes(k),
					),
				),
				body,
			});
		} else await route.continue();
	});
	try {
		const a = await context.newPage(),
			b = await context.newPage();
		await Promise.all([a.goto("/en/cart"), b.goto("/en/cart")]);
		await held;
		// Both pages entered; the browser lock prevents the second initializer while the first cookie response is held.
		await expect.poll(() => context.pages().length).toBe(2);
		await expect
			.poll(() =>
				a.evaluate(
					async () =>
						((await navigator.locks.query()).pending ?? []).filter(
							(x) => x.name === "rezayi:guest-cart-initialize",
						).length,
				),
			)
			.toBe(1);
		expect(count).toBe(1);
		release();
		await expect(
			a.getByText(commerceCopy.en.empty, { exact: true }),
		).toBeVisible();
		await expect(
			b.getByText(commerceCopy.en.empty, { exact: true }),
		).toBeVisible();
		await a.goto(`/en/products/${f.product}?variant=${f.variant}`);
		await a.getByRole("button", { name: "Add to cart", exact: true }).click();
		await expect(
			a.getByText(commerceCopy.en.saved, { exact: true }),
		).toBeVisible();
		let ready!: () => void, finish!: () => void;
		const wait = new Promise<void>((r) => (ready = r)),
			done = new Promise<void>((r) => (finish = r));
		await b.route("**/cart/guest/", async (route) => {
			const r = await route.fetch();
			ready();
			await done;
			await route.fulfill({ response: r });
		});
		const late = b.evaluate(async (url) => {
			const r = await fetch(url, { credentials: "include" });
			return r.json();
		}, apiOrigin + "/api/v1/cart/guest/");
		await wait;
		await commerceLogin(browser, "buyer", a);
		finish();
		await late;
		const session = await a.request.get(
			apiOrigin + "/api/v1/auth/buyer/session/",
		);
		expect(session.status()).toBe(200);
	} finally {
		release?.();
		await context.close();
	}
});
test("R2 invalid increment, double activation, stale version and deliberate reload recover without changing other rows", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	try {
		await clearCart(page);
		await addLine(page, f.variant);
		const b = variantB(f.companyB);
		await addLine(page, b);
		await page.goto("/en/cart");
		const row = page.locator(
			`[data-testid="cart-row"][data-variant="${f.variant}"]`,
		);
		let writes = 0;
		page.on("request", (r) => {
			if (r.method() === "POST" && r.url().endsWith("/cart/buyer/")) writes++;
		});
		await row.getByRole("textbox").fill("0.333");
		await row.getByRole("button", { name: "Update", exact: true }).click();
		await expect(row.getByRole("alert")).toBeVisible();
		expect(writes).toBe(0);
		await expect(row.getByRole("textbox")).toBeEnabled();
		await row.getByRole("textbox").fill("2.000");
		const updated = page.waitForResponse(
			(r) =>
				r.request().method() === "POST" && r.url().endsWith("/cart/buyer/"),
		);
		await row.getByRole("button", { name: "Update", exact: true }).dblclick();
		expect((await updated).status()).toBe(200);
		await expect(
			row.getByRole("button", { name: "Update", exact: true }),
		).toBeEnabled();
		await expect.poll(() => writes).toBe(1);
		await expect(row.getByRole("textbox")).toHaveValue("2.000");
		const before = await buyerCart(page);
		const selected = before.lines.find(
			(l: { variant: string }) => l.variant === f.variant,
		);
		expect(
			(
				await privatePost(page, "cart/buyer/", {
					command_id: crypto.randomUUID(),
					version: before.version,
					action: "set",
					variant: f.variant,
					tier: "retail",
					quantity: "5.000",
				})
			).status(),
		).toBe(200);
		await row.getByRole("textbox").fill("3.000");
		await row.getByRole("button", { name: "Update", exact: true }).click();
		await expect(
			page.getByRole("button", { name: commerceCopy.en.retry, exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: commerceCopy.en.reload, exact: true })
			.click();
		await expect(row.getByRole("textbox")).toHaveValue("5.000");
		await row.getByRole("textbox").fill("3.000");
		const persisted = page.waitForResponse(
			(r) =>
				r.request().method() === "POST" && r.url().endsWith("/cart/buyer/"),
		);
		await row.getByRole("button", { name: "Update", exact: true }).click();
		expect((await persisted).status()).toBe(200);
		await expect(
			row.getByRole("button", { name: "Update", exact: true }),
		).toBeEnabled();
		await page.reload();
		await expect(row.getByRole("textbox")).toHaveValue("3.000");
		const after = await buyerCart(page);
		expect(
			after.lines.find((l: { variant: string }) => l.variant === b).quantity,
		).toBe("1.000");
		expect(
			after.lines.find((l: { id: string }) => l.id === selected.id).quantity,
		).toBe("3.000");
	} finally {
		await session.close();
	}
});
for (const failure of ["withdrawn", "outage"] as const)
	test(`R3 healthy seller can proceed independently of ${failure} seller, retaining excluded cart lines`, async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser);
		const b = variantB(f.companyB);
		try {
			await clearCart(page);
			await addLine(page, f.variant);
			await addLine(page, b);
			if (failure === "withdrawn")
				disposablePython(`from apps.verification.models import ReviewCase
ReviewCase.objects.filter(profile_id=${JSON.stringify(f.companyB)}).update(status='rejected')`);
			else
				await page.route(`**/checkout-terms/${f.companyB}/**`, (r) =>
					r.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "unavailable" } }),
					}),
				);
			await page.goto("/en/account/buyer/checkout?currency=AFN");
			await expect(page.getByTestId("checkout-selection")).toHaveCount(2);
			await expect(
				termsBox(page, f.companyB).getByTestId("seller-terms-state"),
			).toHaveAttribute(
				"data-state",
				failure === "withdrawn" ? "unavailable" : "failed",
			);
			await selection(page, f.companyB).uncheck();
			await fillCheckout(page);
			await page
				.getByRole("button", { name: commerceCopy.en.submit, exact: true })
				.click();
			await expect(page.getByTestId("submission-result")).toContainText(
				commerceCopy.en.accepted,
			);
			const remaining = await buyerCart(page);
			expect(
				remaining.lines.map((l: { variant: string }) => l.variant),
			).toEqual([b]);
		} finally {
			if (failure === "withdrawn")
				disposablePython(`from apps.verification.models import ReviewCase
ReviewCase.objects.filter(profile_id=${JSON.stringify(f.companyB)}).update(status='approved')`);
			await session.close();
		}
	});
test("R3 seller-specific retry preserves selections and entered choices while dependency recovers", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	let failing = true;
	try {
		await clearCart(page);
		await addLine(page, f.variant);
		await addLine(page, variantB(f.companyB));
		await page.route(`**/checkout-terms/${f.companyB}/**`, (r) =>
			failing
				? r.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "unavailable" } }),
					})
				: r.continue(),
		);
		await page.goto("/en/account/buyer/checkout?currency=AFN");
		const a = termsBox(page, f.companyA),
			b = termsBox(page, f.companyB);
		await a.getByLabel("Country (ISO code)").selectOption("AF");
		await a.getByLabel("City", { exact: true }).fill("Kabul");
		await a
			.getByRole("combobox", { name: "Payment method", exact: true })
			.selectOption("advance");
		await expect(b.getByTestId("seller-terms-state")).toHaveAttribute(
			"data-state",
			"failed",
		);
		failing = false;
		await b
			.getByRole("button", { name: commerceCopy.en.retry, exact: true })
			.click();
		await expect(b.getByLabel("Country (ISO code)")).toBeEnabled();
		await expect(a.getByLabel("City", { exact: true })).toHaveValue("Kabul");
		await expect(selection(page, f.companyA)).toBeChecked();
		await expect(selection(page, f.companyB)).toBeChecked();
	} finally {
		await session.close();
	}
});
for (const state of [
	"unavailable",
	"unconfigured",
	"revoked",
	"cart-outage",
] as const)
	test(`R3 ${state} remains distinct and cannot submit fabricated terms`, async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser);
		try {
			await clearCart(page);
			await addLine(page, f.variant);
			if (state === "cart-outage")
				await page.route("**/api/v1/cart/buyer/**", (r) =>
					r.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "unavailable" } }),
					}),
				);
			else
				await page.route(`**/checkout-terms/${f.companyA}/**`, async (r) => {
					if (state === "unconfigured") {
						const response = await r.fetch();
						const body = await response.json();
						await r.fulfill({ response, json: { ...body, enabled: false } });
					} else if (state === "revoked") {
						disposablePython(`from apps.accounts.models import ContextGrant
ContextGrant.objects.filter(authority__user__email='phase10-buyer@example.test',context='buyer').update(revoked=True)`);
						await r.continue();
					} else
						await r.fulfill({
							status: 404,
							contentType: "application/json",
							body: JSON.stringify({ error: { code: "not_found" } }),
						});
				});
			await page.goto("/en/account/buyer/checkout?currency=AFN");
			if (state === "revoked" || state === "cart-outage") {
				await expect(page.getByRole("alert")).toBeVisible();
				await expect(page.getByTestId("checkout-selection")).toHaveCount(0);
			} else {
				await expect(page.getByTestId("seller-terms-state")).toHaveAttribute(
					"data-state",
					state,
				);
				await expect(
					page.getByRole("button", {
						name: commerceCopy.en.submit,
						exact: true,
					}),
				).toBeDisabled();
			}
		} finally {
			await session.close();
		}
	});
test("R3 delayed terms from a previous locale cannot overwrite the current checkout", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	let release!: () => void, blocked!: () => void;
	const held = new Promise<void>((r) => (blocked = r)),
		barrier = new Promise<void>((r) => (release = r));
	let first = true;
	try {
		await clearCart(page);
		await addLine(page, f.variant);
		await page.route(`**/checkout-terms/${f.companyA}/**`, async (r) => {
			if (!first) return r.continue();
			first = false;
			const response = await r.fetch();
			blocked();
			await barrier;
			await r.fulfill({
				response,
				json: { ...(await response.json()), methods: ["cod"] },
			});
		});
		await page.goto("/en/account/buyer/checkout?currency=AFN");
		await held;
		await page.goto("/ar/account/buyer/checkout?currency=AFN");
		const method = page.getByRole("combobox", {
			name: commerceCopy.ar.method,
			exact: true,
		});
		await expect(method.locator('option[value="advance"]')).toHaveCount(1);
		release();
		await expect(method.locator('option[value="advance"]')).toHaveCount(1);
		await noOverflow(page);
	} finally {
		release?.();
		await session.close();
	}
});
for (const role of ["guest", "buyer"] as const)
	test(`R4 ${role} lost acknowledgement through 400/409/429/network reconciles one original contribution`, async ({
		browser,
	}) => {
		const f = commerceFixture(),
			context =
				role === "guest"
					? await browser.newContext()
					: (await commerceLogin(browser)).session,
			page = await context.newPage();
		let phase = 0;
		const keys: string[] = [];
		try {
			if (role === "buyer") await clearCart(page);
			await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
			await page.route(`**/api/v1/cart/${role}/`, async (r) => {
				if (r.request().method() !== "POST") return r.continue();
				keys.push(r.request().postDataJSON().command_id);
				if (phase === 0) await r.fetch();
				const status = [400, 409, 429][phase++];
				if (status)
					await r.fulfill({
						status,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "synthetic_lost_ack" } }),
					});
				else await r.abort("failed");
			});
			const form = page.getByTestId("product-cart-action");
			await form
				.getByRole("button", { name: commerceCopy.en.add, exact: true })
				.dblclick();
			await expect(
				form.getByRole("button", {
					name: commerceCopy.en.reconcile,
					exact: true,
				}),
			).toBeVisible();
			for (let i = 0; i < 3; i++) {
				await form
					.getByRole("button", { name: commerceCopy.en.retry, exact: true })
					.click();
				await expect(
					form.getByRole("button", {
						name: commerceCopy.en.retry,
						exact: true,
					}),
				).toBeEnabled();
			}
			expect(keys).toHaveLength(4);
			expect(new Set(keys).size).toBe(1);
			await expect(form.getByRole("textbox")).toBeDisabled();
			await form
				.getByRole("button", { name: commerceCopy.en.reconcile, exact: true })
				.click();
			await expect(
				form.getByText(commerceCopy.en.saved, { exact: true }),
			).toBeVisible();
			await page.goto("/en/cart");
			await expect(
				page.getByTestId("cart-row").getByRole("textbox"),
			).toHaveValue("1.000");
			const count = disposablePython(`from apps.cart.models import CartCommand
print(CartCommand.objects.filter(key=${JSON.stringify(keys[0])}).count())`).trim();
			expect(count).toBe("1");
		} finally {
			await context.close();
		}
	});
test("R4 stale cart version reconciles rejection, retains editable input and uses a new command only after fencing", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	let first = true;
	try {
		await clearCart(page);
		await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
		await page.route("**/api/v1/cart/buyer/", async (r) => {
			if (r.request().method() === "POST" && first) {
				first = false;
				await addLine(page, f.variant, "5.000");
			}
			await r.continue();
		});
		const form = page.getByTestId("product-cart-action");
		await form.getByRole("textbox").fill("2.000");
		await form
			.getByRole("button", { name: commerceCopy.en.add, exact: true })
			.click();
		await expect(
			form.getByRole("button", {
				name: commerceCopy.en.reconcile,
				exact: true,
			}),
		).toBeVisible();
		await form
			.getByRole("button", { name: commerceCopy.en.reconcile, exact: true })
			.click();
		await expect(form.getByRole("textbox")).toBeEnabled();
		await expect(form.getByRole("textbox")).toHaveValue("2.000");
		await form
			.getByRole("button", { name: commerceCopy.en.add, exact: true })
			.click();
		await expect(
			form.getByText(commerceCopy.en.saved, { exact: true }),
		).toBeVisible();
		expect((await buyerCart(page)).lines[0].quantity).toBe("7.000");
	} finally {
		await session.close();
	}
});

function stepTwoProduct() {
	return JSON.parse(
		disposablePython(`import json
from copy import deepcopy
from django.test import override_settings
from apps.accounts.models import User
from apps.organizations.models import BusinessProfile
from apps.verification.models import ReviewCase
from apps.catalogue.models import Product,Variant
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
with override_settings(OWNER_MFA_REQUIRED=False,CATALOGUE_TRANSLATION_ENABLED=False):
 owner=actor(User.objects.get(email='phase10-owner-a@example.test'),'seller')
 root=actor(User.objects.get(email='phase09-root@example.test'),'owner')
 profile,_=BusinessProfile.objects.get_or_create(account=owner.account,kind='individual',defaults={'display_name':'Synthetic two-unit seller'})
 ReviewCase.objects.get_or_create(profile=profile,status='approved',defaults={'snapshot':{'display_name':'Synthetic two-unit seller'}})
 original=Product.objects.filter(seller__kind='company',seller__account=owner.account,published__isnull=False).first()
 product=Product.objects.get(pk=catalogue.create(owner,{'seller':profile.pk,'currency':'AFN','pricing_mode':'fixed'})['id'])
 image=upload(owner,product.pk,product.version,image_file());product.refresh_from_db()
 body={k:deepcopy(original.published.body[k]) for k in ['locale','title','description','brand','category','attributes']}
 body['images']=[{'id':image['id'],'alt':'Synthetic pair specimen','variant':None}]
 body['variants']=[{'sku':'PAIR-STEP2','unit':'piece','increment':'2.000','minimum':'2.000','contents':'Two-unit synthetic specimen','attributes':{'pack_size':'2'},'active':True,'retail':'12.50','wholesale':'10.00'}]
 saved=catalogue.save(owner,product.pk,{'version':product.version,'body':body})
 for who,action in [(owner,'submit'),(root,'publish')]:
  product.refresh_from_db();catalogue.transition(who,product.pk,{'version':product.version,'revision':saved['revision'],'action':action,'reason':'Synthetic correction specimen'})
 print(json.dumps({'product':str(product.pk),'variant':str(Variant.objects.get(product=product).pk)}))`),
	) as { product: string; variant: string };
}
for (const role of ["guest", "buyer"] as const)
	test(`R4 ${role} enters with a valid two-unit increment and corrects invalid input before one successful add`, async ({
		browser,
	}) => {
		const f = stepTwoProduct(),
			context =
				role === "guest"
					? await browser.newContext()
					: (await commerceLogin(browser)).session,
			page = await context.newPage();
		try {
			if (role === "buyer") await clearCart(page);
			await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
			const form = page.getByTestId("product-cart-action");
			await expect(form.getByRole("textbox")).toHaveValue("2.000");
			await form.getByRole("textbox").fill("1.000");
			await form
				.getByRole("button", { name: commerceCopy.en.add, exact: true })
				.click();
			await expect(
				form.getByText(commerceCopy.en.quantityInvalid, { exact: true }),
			).toBeVisible();
			await expect(form.getByRole("textbox")).toBeEnabled();
			await form.getByRole("textbox").fill("2.000");
			await form
				.getByRole("button", { name: commerceCopy.en.add, exact: true })
				.click();
			await expect(
				form.getByText(commerceCopy.en.saved, { exact: true }),
			).toBeVisible();
			await page.goto("/en/cart");
			await expect(
				page.getByTestId("cart-row").getByRole("textbox"),
			).toHaveValue("2.000");
		} finally {
			await context.close();
		}
	});
test("R4 original uncertain command survives locale/variant remount and access loss clears the active form", async ({
	browser,
}) => {
	const f = commerceFixture(),
		{ session, page } = await commerceLogin(browser);
	let key = "";
	try {
		await clearCart(page);
		await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
		await page.route("**/api/v1/cart/buyer/", async (r) => {
			if (r.request().method() !== "POST") return r.continue();
			key = r.request().postDataJSON().command_id;
			await r.fetch();
			await r.fulfill({
				status: 429,
				contentType: "application/json",
				body: JSON.stringify({ error: { code: "synthetic_lost_ack" } }),
			});
		});
		const form = page.getByTestId("product-cart-action");
		await form
			.getByRole("button", { name: commerceCopy.en.add, exact: true })
			.click();
		await expect(
			form.getByRole("button", {
				name: commerceCopy.en.reconcile,
				exact: true,
			}),
		).toBeVisible();
		const nextVariant =
			disposablePython(`from apps.catalogue.models import Variant
print(Variant.objects.filter(product_id=${JSON.stringify(f.product)}).exclude(pk=${JSON.stringify(f.variant)}).first().pk)`).trim();
		const variants = page
			.getByTestId("product-detail")
			.getByRole("combobox")
			.first();
		await variants.selectOption(nextVariant);
		await expect(
			page.getByTestId("product-cart-action").getByRole("textbox"),
		).toBeDisabled();
		await variants.selectOption(f.variant);
		await expect(
			page.getByTestId("product-cart-action").getByRole("textbox"),
		).toBeDisabled();
		await choosePreference(page, messages.en.language, "ar");
		await expect(page).toHaveURL(/\/ar\/products\//);
		expect(new URL(page.url()).searchParams.get("cart_attempt")).toBe(key);
		const recovered = page.getByTestId("product-cart-action");
		await expect(recovered.getByRole("textbox")).toBeDisabled();
		await recovered
			.getByRole("button", { name: commerceCopy.ar.reconcile, exact: true })
			.click();
		await expect(
			recovered.getByText(commerceCopy.ar.saved, { exact: true }),
		).toBeVisible();
		expect(new URL(page.url()).searchParams.has("cart_attempt")).toBe(false);
		const cart = await buyerCart(page);
		expect(
			cart.lines.filter((l: { variant: string }) => l.variant === f.variant)[0]
				.quantity,
		).toBe("1.000");
		expect(
			disposablePython(`from apps.cart.models import CartCommand
print(CartCommand.objects.filter(key=${JSON.stringify(key)}).count())`).trim(),
		).toBe("1");
		disposablePython(`from apps.accounts.models import ContextGrant
ContextGrant.objects.filter(authority__user__email='phase10-buyer@example.test',context='buyer').update(revoked=True)`);
		await page.reload();
		await expect(
			page.getByTestId("product-cart-action").getByRole("textbox"),
		).toBeEnabled();
	} finally {
		await session.close();
	}
});
for (const locale of ["fa-AF", "ps", "ar", "en"] as Locale[])
	test(`R2–R4 ${locale}: correction controls inherit mobile/desktop, light/dark and keyboard`, async ({
		browser,
	}) => {
		const f = commerceFixture(),
			{ session, page } = await commerceLogin(browser),
			t = commerceCopy[locale];
		try {
			await clearCart(page);
			await addLine(page, f.variant);
			await addLine(page, variantB(f.companyB));
			await page.route(`**/checkout-terms/${f.companyB}/**`, (r) =>
				r.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ error: { code: "unavailable" } }),
				}),
			);
			await page.goto(`/${locale}/account/buyer/checkout?currency=AFN`);
			await expect(
				page.getByText(t.termsDependency, { exact: true }),
			).toBeVisible();
			for (const [width, theme] of [
				[390, "light"],
				[390, "dark"],
				[1440, "light"],
				[1440, "dark"],
			] as const) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(
					(theme) => (document.documentElement.dataset.theme = theme),
					theme,
				);
				await noOverflow(page);
				const retry = termsBox(page, f.companyB).getByRole("button", {
					name: t.retry,
					exact: true,
				});
				await retry.focus();
				await expect(retry).toBeFocused();
				const directory = process.env.PLAYWRIGHT_EVIDENCE_DIR;
				if (directory)
					await page.screenshot({
						path: `${directory}/correction-checkout-${locale}-${width}-${theme}.png`,
						fullPage: true,
					});
			}
			// Navigate deliberately without inventing a purchase; no destination choice has been entered.
			await page.goto(`/${locale}/cart`);
			for (const [width, theme] of [
				[390, "light"],
				[390, "dark"],
				[1440, "light"],
				[1440, "dark"],
			] as const) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(
					(t) => (document.documentElement.dataset.theme = t),
					theme,
				);
				const update = page
					.locator(`[data-testid="cart-row"][data-variant="${f.variant}"]`)
					.getByRole("button", { name: t.update, exact: true });
				await update.focus();
				await expect(update).toBeFocused();
				await noOverflow(page);
				const directory = process.env.PLAYWRIGHT_EVIDENCE_DIR;
				if (directory)
					await page.screenshot({
						path: `${directory}/correction-update-${locale}-${width}-${theme}.png`,
						fullPage: true,
					});
			}
			await page.goto(`/${locale}/products/${f.product}?variant=${f.variant}`);
			const form = page.getByTestId("product-cart-action");
			await form.getByRole("textbox").fill("0.333");
			await form.getByRole("button", { name: t.add, exact: true }).click();
			await expect(
				form.getByText(t.quantityInvalid, { exact: true }),
			).toBeVisible();
			await expect(form.getByRole("textbox")).toBeEnabled();
			await noOverflow(page);
			for (const [width, theme] of [
				[390, "light"],
				[390, "dark"],
				[1440, "light"],
				[1440, "dark"],
			] as const) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(
					(t) => (document.documentElement.dataset.theme = t),
					theme,
				);
				await noOverflow(page);
				const directory = process.env.PLAYWRIGHT_EVIDENCE_DIR;
				if (directory)
					await page.screenshot({
						path: `${directory}/correction-quantity-${locale}-${width}-${theme}.png`,
						fullPage: true,
					});
			}
		} finally {
			await session.close();
		}
	});

test("R1 missing cross-tab coordination fails closed for guests while buyer carts remain usable", async ({
	browser,
}) => {
	const context = await browser.newContext();
	await context.addInitScript(() =>
		Object.defineProperty(navigator, "locks", { value: undefined }),
	);
	const page = await context.newPage();
	let initializers = 0;
	page.on("request", (r) => {
		if (r.url().includes("/cart/guest/initialize/")) initializers++;
	});
	try {
		await page.goto("/en/cart");
		await expect(
			page.getByText(commerceCopy.en.guestUnavailable, { exact: true }),
		).toBeVisible();
		expect(initializers).toBe(0);
		await commerceLogin(browser, "buyer", page);
		await clearCart(page);
		await page.goto("/en/cart");
		await expect(
			page.getByText(commerceCopy.en.empty, { exact: true }),
		).toBeVisible();
	} finally {
		await context.close();
	}
});

test("R1/R4 a lost guest command cannot move to a fresh cookie after another tab merges it", async ({
	browser,
}) => {
	const f = commerceFixture(),
		context = await browser.newContext(),
		page = await context.newPage();
	let first = true;
	let key = "";
	try {
		await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
		await page.route("**/api/v1/cart/guest/", async (r) => {
			if (r.request().method() !== "POST") return r.continue();
			key ||= r.request().postDataJSON().command_id;
			if (first) {
				first = false;
				await r.fetch();
				await r.fulfill({
					status: 429,
					contentType: "application/json",
					body: JSON.stringify({ error: { code: "synthetic_lost_ack" } }),
				});
			} else await r.continue();
		});
		const form = page.getByTestId("product-cart-action");
		await form
			.getByRole("button", { name: commerceCopy.en.add, exact: true })
			.click();
		await expect(
			form.getByRole("button", { name: commerceCopy.en.retry, exact: true }),
		).toBeVisible();
		const other = await context.newPage();
		await commerceLogin(browser, "buyer", other);
		await clearCart(other);
		await other.goto("/en/cart");
		await other
			.getByRole("button", { name: commerceCopy.en.merge, exact: true })
			.click();
		await expect(
			other.getByText(commerceCopy.en.merged, { exact: true }),
		).toBeVisible();
		await privatePost(other, "auth/buyer/logout/", {});
		expect(
			(await privatePost(other, "cart/guest/initialize/", {})).status(),
		).toBe(200);
		const pending = page.waitForResponse(
			(r) =>
				r.request().method() === "POST" && r.url().endsWith("/cart/guest/"),
		);
		await form
			.getByRole("button", { name: commerceCopy.en.retry, exact: true })
			.click();
		expect((await pending).status()).toBe(409);
		const fresh = await (
			await page.request.get(`${apiOrigin}/api/v1/cart/guest/`)
		).json();
		expect(fresh.lines).toHaveLength(0);
		await form
			.getByRole("button", { name: commerceCopy.en.reconcile, exact: true })
			.click();
		await expect(
			form.getByText(commerceCopy.en.guestCartChanged, { exact: true }),
		).toBeVisible();
		await expect(form.getByRole("textbox")).toBeDisabled();
		expect(new URL(page.url()).searchParams.get("cart_attempt")).toBe(key);
		// A transient current-cart read must not discard the unresolved reference.
		await page.route(
			"**/api/v1/cart/guest/",
			async (route) => {
				if (route.request().method() === "GET")
					return route.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "synthetic_outage" } }),
					});
				return route.fallback();
			},
			{ times: 1 },
		);
		await form
			.getByRole("button", {
				name: commerceCopy.en.useCurrentCart,
				exact: true,
			})
			.click();
		await expect(form.getByRole("alert")).toBeVisible();
		await expect(form.getByRole("textbox")).toBeDisabled();
		expect(new URL(page.url()).searchParams.get("cart_attempt")).toBe(key);
		// Rotate again between discovery and confirmation. Confirmation rechecks
		// the actual current cookie, without treating any fingerprint as authority.
		await context.clearCookies({ name: "rezayi_guest_cart" });
		expect(
			(await privatePost(other, "cart/guest/initialize/", {})).status(),
		).toBe(200);
		await form
			.getByRole("button", {
				name: commerceCopy.en.useCurrentCart,
				exact: true,
			})
			.click();
		await expect(form.getByRole("textbox")).toBeEnabled();
		await expect(
			form.getByText(commerceCopy.en.guestCartReady, { exact: true }),
		).toBeVisible();
		expect(new URL(page.url()).searchParams.has("cart_attempt")).toBe(false);
		expect(
			(await (await page.request.get(`${apiOrigin}/api/v1/cart/guest/`)).json())
				.lines,
		).toHaveLength(0);
		// Recovery itself never adds. A separate click creates a new contribution.
		await form
			.getByRole("button", { name: commerceCopy.en.add, exact: true })
			.click();
		await expect(
			form.getByText(commerceCopy.en.saved, { exact: true }),
		).toBeVisible();
		const newGuest = await (
			await page.request.get(`${apiOrigin}/api/v1/cart/guest/`)
		).json();
		expect(newGuest.lines).toHaveLength(1);
		expect(newGuest.lines[0].quantity).toBe("1.000");

		await commerceLogin(browser, "buyer", other);
		const saved = await buyerCart(other);
		expect(saved.lines).toHaveLength(1);
		expect(saved.lines[0].quantity).toBe("1.000");
		expect(
			disposablePython(
				`from apps.cart.models import CartCommand\nprint(CartCommand.objects.filter(key=${JSON.stringify(key)}).count())`,
			).trim(),
		).toBe("1");
	} finally {
		await context.close();
	}
});

test("P10-F1 expired guest request transitions explicitly without replaying its old contribution", async ({
	browser,
}) => {
	const f = commerceFixture(),
		context = await browser.newContext(),
		page = await context.newPage();
	try {
		await page.goto(`/en/products/${f.product}?variant=${f.variant}`);
		let lost = false;
		await page.route("**/api/v1/cart/guest/", async (route) => {
			if (route.request().method() !== "POST" || lost) return route.continue();
			lost = true;
			await route.fetch();
			await route.fulfill({
				status: 429,
				contentType: "application/json",
				body: JSON.stringify({ error: { code: "synthetic_lost_ack" } }),
			});
		});
		const form = page.getByTestId("product-cart-action");
		await form
			.getByRole("button", { name: commerceCopy.en.add, exact: true })
			.click();
		await expect(
			form.getByRole("button", {
				name: commerceCopy.en.reconcile,
				exact: true,
			}),
		).toBeVisible();
		// The recovery button is rendered while a request is still in flight.
		// Wait for its lost acknowledgement before expiring the persisted row.
		await expect(
			form.getByRole("button", {
				name: commerceCopy.en.reconcile,
				exact: true,
			}),
		).toBeEnabled();
		const cookie = (await context.cookies(apiOrigin + "/api/v1/cart/")).find(
			(c) => c.name === "rezayi_guest_cart",
		);
		expect(cookie).toBeTruthy();
		const expiredRows = disposablePython(`from apps.cart.models import Cart
from django.db.models import F
from django.utils import timezone
from datetime import timedelta
print(Cart.objects.filter(guest_key=${JSON.stringify(cookie?.value)}).update(expires_at=timezone.now()-timedelta(seconds=1),version=F('version')+1))`).trim();
		expect(expiredRows).toBe("1");
		// A separate initialization rotates the expired cookie while the original
		// form still holds its uncertain command. The choice never claims failure.
		expect(
			(await privatePost(page, "cart/guest/initialize/", {})).status(),
		).toBe(200);
		const rotated = (await context.cookies(apiOrigin + "/api/v1/cart/")).find(
			(c) => c.name === "rezayi_guest_cart",
		);
		expect(rotated?.value).not.toBe(cookie?.value);
		await form
			.getByRole("button", { name: commerceCopy.en.reconcile, exact: true })
			.click();
		await expect(
			form.getByText(commerceCopy.en.guestCartChanged, { exact: true }),
		).toBeVisible();
		await expect(form.getByRole("textbox")).toBeDisabled();
		await form
			.getByRole("button", {
				name: commerceCopy.en.useCurrentCart,
				exact: true,
			})
			.click();
		await expect(form.getByRole("textbox")).toBeEnabled();
		await page.reload();
		await expect(
			page.getByTestId("product-cart-action").getByRole("textbox"),
		).toBeEnabled();
		expect(
			(await (await page.request.get(`${apiOrigin}/api/v1/cart/guest/`)).json())
				.lines,
		).toHaveLength(0);
	} finally {
		await context.close();
	}
});

for (const locale of ["fa-AF", "ps", "ar", "en"] as Locale[])
	test(`P10-F1 ${locale}: explicit guest transition is localized, keyboard accessible and responsive`, async ({
		browser,
	}) => {
		const f = commerceFixture(),
			context = await browser.newContext(),
			page = await context.newPage(),
			t = commerceCopy[locale];
		try {
			// A reference is only a recovery hint. The current HttpOnly guest cookie
			// remains the authority; it cannot authorize reading this synthetic old key.
			await page.goto(
				`/${locale}/products/${f.product}?variant=${f.variant}&cart_attempt=11111111-2222-4333-8444-555555555555&cart_context=guest&cart_scope=${"0".repeat(64)}`,
			);
			const form = page.getByTestId("product-cart-action");
			await form
				.getByRole("button", { name: t.reconcile, exact: true })
				.click();
			await expect(
				form.getByText(t.guestCartChanged, { exact: true }),
			).toBeVisible();
			for (const [width, theme] of [
				[390, "light"],
				[1440, "dark"],
			] as const) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(
					(theme) => (document.documentElement.dataset.theme = theme),
					theme,
				);
				const use = form.getByRole("button", {
					name: t.useCurrentCart,
					exact: true,
				});
				await use.focus();
				await expect(use).toBeFocused();
				await noOverflow(page);
				const directory = process.env.PLAYWRIGHT_EVIDENCE_DIR;
				if (directory)
					await form.screenshot({
						path: `${directory}/guest-transition-${locale}-${width}-${theme}.png`,
					});
			}
			const use = form.getByRole("button", {
				name: t.useCurrentCart,
				exact: true,
			});
			await use.focus();
			await page.keyboard.press("Enter");
			await expect(form.getByRole("textbox")).toBeEnabled();
			await expect(
				form.getByText(t.guestCartReady, { exact: true }),
			).toBeVisible();
			expect(new URL(page.url()).searchParams.has("cart_attempt")).toBe(false);
			expect(
				(
					await (
						await page.request.get(`${apiOrigin}/api/v1/cart/guest/`)
					).json()
				).lines,
			).toHaveLength(0);
			await form.getByRole("button", { name: t.add, exact: true }).click();
			await expect(form.getByText(t.saved, { exact: true })).toBeVisible();
			await expect(
				form.getByText(t.guestCartReady, { exact: true }),
			).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
