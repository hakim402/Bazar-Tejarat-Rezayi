import { test, expect, type Browser, type Page } from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
import { noOverflow } from "./support/commerce-runtime";
import { syntheticImage } from "./support/messaging-runtime";
import { adminLogin } from "./support/admin-runtime";
import { sellerSalesCopy } from "../lib/i18n/seller-sales";
import { selectControl } from "./support/seller-controls";
import { sellerShellCopy } from "../lib/i18n/seller-shell";
import { fulfilmentCopy } from "../features/fulfilment/copy";
import type { Locale } from "../lib/i18n/locales";
import { catalogueCopy } from "../lib/i18n/catalogue";
test.skip(
	process.env.FULFILMENT_BROWSER_TESTS !== "1",
	"Use the owned Phase 13 MariaDB harness.",
);
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });
test.beforeEach(() =>
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	),
);
function order(stage = "accepted", method = "cod", charge = "0.00") {
	return JSON.parse(
		disposablePython(`import json
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery
print(json.dumps(example_delivery('${method}',stage='${stage}',charge='${charge}')))`),
	) as { id: string; seller: string; number: string; preparation?: string };
}
async function login(browser: Browser, role = "buyer") {
	const session = await browser.newContext(),
		page = await session.newPage(),
		context = role === "buyer" ? "buyer" : "seller";
	page.on("pageerror", (error) =>
		console.error("P13 page error:", error.message),
	);
	await page.goto(`/en/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(`phase12-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(new RegExp(`/account/${context}$`), {
		timeout: 15000,
	});
	return { session, page, context };
}
async function choose(page: Page, locale: Locale, mode: string) {
	await page
		.getByLabel(fulfilmentCopy[locale].exact, { exact: true })
		.selectOption(mode);
}
async function confirm(page: Page, locale: Locale) {
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole("button", { name: fulfilmentCopy[locale].confirm, exact: true })
		.click();
	await expect(dialog).toHaveCount(0);
}
async function recipient(page: Page, locale: Locale) {
	const t = fulfilmentCopy[locale];
	await page
		.getByLabel(t.recipientName, { exact: true })
		.fill("Synthetic browser recipient");
	await page.getByLabel(t.phone, { exact: true }).fill("000-BROWSER-TEST");
	await page
		.getByLabel(t.address, { exact: true })
		.fill("Synthetic private browser address");
	await page
		.getByLabel(t.reason, { exact: true })
		.fill("Buyer provides current private recipient");
}
for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
	for (const [width, theme] of [
		[1440, "light"],
		[390, "dark"],
	] as const) {
		test(`P13 ${locale} ${width} ${theme}: private recipient review, keyboard and approved shell`, async ({
			browser,
		}, info) => {
			const item = order(),
				buyer = await login(browser),
				t = fulfilmentCopy[locale];
			try {
				await buyer.page.setViewportSize({ width, height: 1000 });
				await buyer.page.addInitScript(
					(theme) => localStorage.setItem("rezayi-theme", theme),
					theme,
				);
				await buyer.page.goto(`/${locale}/account/buyer/deliveries/${item.id}`);
				await expect(buyer.page.locator("html")).toHaveAttribute(
					"dir",
					locale === "en" ? "ltr" : "rtl",
				);
				await recipient(buyer.page, locale);
				const button = buyer.page.getByRole("button", {
					name: t.saveRecipient,
					exact: true,
				});
				await button.click();
				try {
					await expect(buyer.page.getByRole("alertdialog")).toBeVisible();
				} catch (error) {
					await buyer.page.screenshot({
						path: info.outputPath("failed-recipient.png"),
						fullPage: true,
					});
					throw error;
				}
				await expect(buyer.page.getByRole("alertdialog")).toContainText(
					"Synthetic private browser address",
				);
				await buyer.page.keyboard.press("Escape");
				await expect(button).toBeFocused();
				await expect(
					buyer.page.getByLabel(t.address, { exact: true }),
				).toHaveValue("Synthetic private browser address");
				await button.click();
				await confirm(buyer.page, locale);
				await expect(
					buyer.page.locator("[data-fulfilment-actions]"),
				).toBeFocused();
				const response = await buyer.page.request.get(
					`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
				);
				expect(response.status()).toBe(200);
				const data = await response.json();
				expect(data.recipient.revision).toBe(1);
				expect(data.stage).toBe("not_dispatched");
				expect(data.goods_confirmed).toBe("0.00");
				expect(data.charge).toBeNull();
				expect(buyer.page.url()).not.toContain("Synthetic");
				await noOverflow(buyer.page);
				await buyer.page.screenshot({
					path: info.outputPath(`recipient-${locale}-${width}.png`),
					fullPage: true,
				});
				const storage = await buyer.page.evaluate(() =>
					JSON.stringify({
						local: { ...localStorage },
						session: { ...sessionStorage },
					}),
				);
				expect(storage).not.toContain("Synthetic private browser address");
				expect(storage).not.toContain("000-BROWSER-TEST");
			} finally {
				await buyer.session.close();
			}
		});
	}
}
test("P13 seller exact COD dispatch retains original outcome after lost acknowledgement", async ({
	browser,
}) => {
	const item = order("prepared"),
		seller = await login(browser, "owner"),
		t = fulfilmentCopy.en;
	try {
		await seller.page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await choose(seller.page, "en", "dispatch");
		await seller.page
			.getByLabel(t.reason, { exact: true })
			.fill("Exact browser whole COD dispatch");
		await seller.page
			.getByRole("button", { name: t.reviewDispatch, exact: true })
			.click();
		const dialog = seller.page.getByRole("alertdialog");
		await expect(dialog).toContainText("Synthetic manual delivery provider");
		await expect(dialog).toContainText("1.000");
		let sent = false;
		await seller.page.route(
			`**/api/v1/fulfilment/seller/orders/${item.id}/dispatch/`,
			async (route) => {
				if (sent) {
					await route.continue();
					return;
				}
				sent = true;
				await route.fetch();
				await route.abort("failed");
			},
		);
		await confirm(seller.page, "en");
		await expect(
			seller.page.getByRole("button", { name: t.reconcile, exact: true }),
		).toBeVisible();
		await seller.page
			.getByRole("button", { name: t.reconcile, exact: true })
			.click();
		await expect(
			seller.page.getByRole("button", { name: t.reconcile, exact: true }),
		).toHaveCount(0);
		const state = JSON.parse(
			disposablePython(`import json
from apps.fulfilment.models import Shipment
from apps.inventory.models import Movement
s=Shipment.objects.get(order_id='${item.id}')
print(json.dumps({'shipments':Shipment.objects.filter(order_id='${item.id}').count(),'movements':Movement.objects.filter(operation_id=s.operation_id).count(),'quantity':str(s.operation.movements.get().physical_delta)}))`),
		);
		expect(state).toEqual({ shipments: 1, movements: 1, quantity: "-1.000" });
	} finally {
		await seller.session.close();
	}
});
test("P13 dirty recipient and target changes keep drafts when navigation is cancelled", async ({
	browser,
}) => {
	const item = order(),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await recipient(buyer.page, "en");
		await buyer.page
			.getByRole("link", { name: t.buyerTitle, exact: true })
			.first()
			.click();
		const warning = buyer.page
			.getByRole("alert")
			.filter({ has: buyer.page.getByRole("button") });
		await expect(warning).toBeVisible();
		await warning
			.getByRole("button", { name: catalogueCopy.en.cancel, exact: true })
			.click();
		await expect(buyer.page.getByLabel(t.address, { exact: true })).toHaveValue(
			"Synthetic private browser address",
		);
		expect(buyer.page.url()).toContain(item.id);
	} finally {
		await buyer.session.close();
	}
});
test("P13 logistics member can inspect recipient but gains no goods or delivery receipt authority", async ({
	browser,
}) => {
	const item = order("prepared", "cod", "5.00"),
		session = await browser.newContext(),
		page = await session.newPage(),
		t = fulfilmentCopy.en;
	try {
		await page.goto("/en/auth/seller-sign-in");
		await page.locator("[name=email]").fill("phase13-logistics@example.test");
		await page.locator("[name=password]").fill(fixturePassword);
		await page.locator(".account-card > form button[type=submit]").click();
		await expect(page).toHaveURL(/\/account\/seller$/, { timeout: 15000 });
		await page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await expect(
			page.getByText("Synthetic private address — never real contact data", {
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page
				.getByLabel(t.exact, { exact: true })
				.locator('option[value="claim"]'),
		).toHaveCount(0);
		await expect(
			page
				.getByLabel(t.exact, { exact: true })
				.locator('option[value="partial"]'),
		).toHaveCount(0);
		const response = await page.request.get(
			`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
		);
		expect(response.status()).toBe(404);
	} finally {
		await session.close();
	}
});
test("P13 finance member sees separate money but never recipient, handover or dispatch", async ({
	browser,
}) => {
	const item = order("prepared", "cod", "5.00"),
		finance = await login(browser, "finance"),
		t = fulfilmentCopy.en;
	try {
		await finance.page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await expect(
			finance.page.getByText(
				"Synthetic private address — never real contact data",
				{ exact: true },
			),
		).toHaveCount(0);
		await expect(
			finance.page
				.getByLabel(t.exact, { exact: true })
				.locator('option[value="claim"]'),
		).toHaveCount(1);
		await expect(
			finance.page
				.getByLabel(t.exact, { exact: true })
				.locator('option[value="dispatch"]'),
		).toHaveCount(0);
		expect(
			(
				await finance.page.request.get(
					`${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/handover/?locale=en&format=pdf`,
				)
			).status(),
		).toBe(404);
	} finally {
		await finance.session.close();
	}
});
test("P13 native root has guarded all-model coverage and independent charge review", async ({
	browser,
}) => {
	const item = order("prepared", "cod", "5.00"),
		session = await browser.newContext(),
		page = await session.newPage();
	try {
		await adminLogin(page, "phase09-root@example.test");
		await page.goto(`${apiOrigin}/admin/fulfilment/state/${item.id}/workflow/`);
		await expect(
			page
				.getByRole("heading", { name: "Delivery and fulfilment", exact: true })
				.last(),
		).toBeVisible();
		await expect(
			page.getByText("Synthetic private address — never real contact data", {
				exact: true,
			}),
		).toBeVisible();
		await page.goto(`${apiOrigin}/admin/fulfilment/reviewcase/`);
		await expect(page.locator("#result_list")).toBeVisible();
		await page.goto(`${apiOrigin}/admin/fulfilment/completion/`);
		expect(page.url()).toContain("/admin/fulfilment/completion/");
	} finally {
		await session.close();
	}
});

test("P13 stale and rate-limited recipient submissions retain the exact editable draft", async ({
	browser,
}) => {
	const item = order(),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await recipient(buyer.page, "en");
		for (const status of [409, 429]) {
			await buyer.page.route(
				`**/api/v1/fulfilment/buyer/orders/${item.id}/recipient/`,
				(route) =>
					route.fulfill({
						status,
						contentType: "application/json",
						body: JSON.stringify({
							error: {
								code: status === 409 ? "conflict" : "rate_limited",
								message: "Synthetic bounded transport rejection",
							},
						}),
					}),
				{ times: 1 },
			);
			await buyer.page
				.getByRole("button", { name: t.saveRecipient, exact: true })
				.click();
			await confirm(buyer.page, "en");
			await expect(
				buyer.page.getByRole("alert").filter({ hasText: t.error }),
			).toBeVisible();
			await expect(
				buyer.page.getByLabel(t.address, { exact: true }),
			).toHaveValue("Synthetic private browser address");
			await expect(
				buyer.page.getByRole("button", { name: t.reconcile, exact: true }),
			).toHaveCount(0);
		}
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await expect(buyer.page.locator("[data-fulfilment-actions]")).toBeFocused();
		const data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.recipient.revision).toBe(1);
	} finally {
		await buyer.session.close();
	}
});

test("P13 lost request before commit is fenced absent and preserves a draft for deliberate new review", async ({
	browser,
}) => {
	const item = order(),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await recipient(buyer.page, "en");
		await buyer.page.route(
			`**/api/v1/fulfilment/buyer/orders/${item.id}/recipient/`,
			(route) => route.abort("failed"),
			{ times: 1 },
		);
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await expect(
			buyer.page.getByRole("button", { name: t.reconcile, exact: true }),
		).toBeVisible();
		const reference = new URL(buyer.page.url()).searchParams.get(
			"fulfilment_attempt",
		);
		expect(reference).toMatch(/^[0-9a-f-]{36}$/);
		await buyer.page
			.getByRole("button", { name: t.reconcile, exact: true })
			.click();
		await expect(buyer.page.getByText(t.absent, { exact: true })).toBeVisible();
		await expect(buyer.page.getByLabel(t.address, { exact: true })).toHaveValue(
			"Synthetic private browser address",
		);
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await confirm(buyer.page, "en");
		const data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.recipient.revision).toBe(1);
		expect(buyer.page.url()).not.toContain(reference ?? "unexpected-reference");
	} finally {
		await buyer.session.close();
	}
});

test("P13 offline recipient draft remains editable and cannot submit until online", async ({
	browser,
}) => {
	const item = order(),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await recipient(buyer.page, "en");
		await buyer.session.setOffline(true);
		await expect(
			buyer.page.getByText(t.offline, { exact: true }),
		).toBeVisible();
		await expect(
			buyer.page.getByRole("button", { name: t.saveRecipient, exact: true }),
		).toBeDisabled();
		await expect(buyer.page.getByLabel(t.address, { exact: true })).toHaveValue(
			"Synthetic private browser address",
		);
		await buyer.session.setOffline(false);
		await expect(
			buyer.page.getByRole("button", { name: t.saveRecipient, exact: true }),
		).toBeEnabled();
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await expect(buyer.page.locator("[data-fulfilment-actions]")).toBeFocused();
	} finally {
		await buyer.session.close();
	}
});

test("P13 changing a dirty delivery-claim mode keeps staged private evidence on Cancel", async ({
	browser,
}) => {
	const item = order("prepared", "cod", "5.00"),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await choose(buyer.page, "en", "claim");
		const form = buyer.page
			.locator("form")
			.filter({ has: buyer.page.locator("input[type=file]") });
		await form.locator("input[inputmode=decimal]").fill("2.00");
		await form
			.getByLabel(t.description, { exact: true })
			.fill("Synthetic dirty provider claim");
		await form.locator("input[type=file]").setInputFiles(syntheticImage());
		await form.getByRole("button", { name: t.uploads, exact: true }).click();
		await expect(
			form.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		await choose(buyer.page, "en", "recipient");
		const warning = buyer.page
			.getByRole("alert")
			.filter({ has: buyer.page.getByRole("button") });
		await warning
			.getByRole("button", { name: catalogueCopy.en.cancel, exact: true })
			.click();
		await expect(buyer.page.getByLabel(t.exact, { exact: true })).toHaveValue(
			"claim",
		);
		await expect(form.locator("input[inputmode=decimal]")).toHaveValue("2.00");
		await expect(form.getByLabel(t.description, { exact: true })).toHaveValue(
			"Synthetic dirty provider claim",
		);
		await expect(
			form.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
	} finally {
		await buyer.session.close();
	}
});

test("P13 losing finance while keeping logistics clears a sensitive claim draft on fresh scope", async ({
	browser,
}) => {
	const item = order("prepared", "cod", "5.00"),
		session = await browser.newContext(),
		page = await session.newPage(),
		t = fulfilmentCopy.en;
	const membership = `from apps.organizations.models import Membership\nm=Membership.objects.get(company_id='${item.seller}',account__user__email='phase13-logistics@example.test')\n`;
	const original = JSON.parse(
		disposablePython(`import json\n${membership}print(json.dumps(m.bundles))`),
	) as string[];
	try {
		disposablePython(
			`${membership}m.bundles=['fulfilment','payments_refunds'];m.save(update_fields=['bundles'])`,
		);
		await page.goto("/en/auth/seller-sign-in");
		await page.locator("[name=email]").fill("phase13-logistics@example.test");
		await page.locator("[name=password]").fill(fixturePassword);
		await page.locator(".account-card > form button[type=submit]").click();
		await expect(page).toHaveURL(/\/account\/seller$/, { timeout: 15000 });
		await page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await choose(page, "en", "claim");
		await page
			.getByLabel(t.description, { exact: true })
			.fill("Synthetic sensitive provider draft");
		disposablePython(
			`${membership}m.bundles=['fulfilment'];m.save(update_fields=['bundles'])`,
		);
		await page.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		await expect(page.getByLabel(t.description, { exact: true })).toHaveCount(
			0,
			{ timeout: 20000 },
		);
		await expect(
			page.getByLabel(t.exact, { exact: true }).locator("option[value=claim]"),
		).toHaveCount(0);
		await expect(
			page.getByText("Synthetic private address — never real contact data", {
				exact: true,
			}),
		).toBeVisible();
	} finally {
		disposablePython(
			`${membership}m.bundles=${JSON.stringify(original)};m.save(update_fields=['bundles'])`,
		);
		await session.close();
	}
});

test("P13 a real concurrent recipient revision returns 409 and requires deliberate fresh review", async ({
	browser,
}) => {
	const item = order(),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await recipient(buyer.page, "en");
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await expect(buyer.page.getByRole("alertdialog")).toBeVisible();
		await buyer.page.route(
			`**/api/v1/fulfilment/buyer/orders/${item.id}/recipient/`,
			async (route) => {
				disposablePython(
					`from apps.accounts.models import User\nfrom apps.orders.models import SellerOrder\nfrom apps.messaging.management.commands.seed_messaging_examples import actor\nfrom apps.fulfilment.management.commands.seed_fulfilment_examples import command\no=SellerOrder.objects.get(pk='${item.id}')\nb=actor(User.objects.get(email='phase12-buyer@example.test'),'buyer')\ncommand(o,b,'recipient',recipient_revision=0,name='Concurrent synthetic recipient',phone='000-CONCURRENT',address='Concurrent synthetic address',reason='Actual concurrent recipient revision')`,
				);
				await route.continue();
			},
			{ times: 1 },
		);
		const rejected = buyer.page.waitForResponse(
			(response) =>
				response
					.url()
					.endsWith(`/fulfilment/buyer/orders/${item.id}/recipient/`) &&
				response.status() === 409,
		);
		await confirm(buyer.page, "en");
		await rejected;
		await expect(buyer.page.getByLabel(t.address, { exact: true })).toHaveValue(
			"Synthetic private browser address",
		);
		await buyer.page.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		await expect(buyer.page.getByText(t.stale, { exact: true })).toBeVisible();
		await buyer.page
			.getByRole("button", { name: t.reload, exact: true })
			.click();
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await expect(buyer.page.locator("[data-fulfilment-actions]")).toBeFocused();
		const data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.recipient.revision).toBe(2);
		expect(data.recipient.address).toBe("Synthetic private browser address");
	} finally {
		await buyer.session.close();
	}
});

test("P13 authorized handover uses protected MIME types and retained RTL fonts", async ({
	browser,
}, info) => {
	const item = order("dispatched"),
		seller = await login(browser, "owner");
	try {
		const path = `${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/handover/`;
		const pdf = await seller.page.request.get(
			`${path}?locale=fa-AF&format=pdf`,
			{ headers: { Accept: "application/pdf" } },
		);
		expect(pdf.status()).toBe(200);
		expect(pdf.headers()["content-type"]).toBe("application/pdf");
		expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
		expect(pdf.headers()["cache-control"]).toContain("no-store");
		const response = await seller.page.goto(`${path}?locale=fa-AF&format=html`);
		expect(response?.status()).toBe(200);
		await expect(seller.page.locator("html")).toHaveAttribute("dir", "rtl");
		await seller.page.evaluate(() => document.fonts.ready);
		expect(
			await seller.page.evaluate(
				() => getComputedStyle(document.body).fontFamily,
			),
		).toContain("HandoverArabic");
		expect(
			await seller.page.evaluate(() =>
				document.fonts.check("14px HandoverArabic"),
			),
		).toBe(true);
		await noOverflow(seller.page);
		await seller.page.screenshot({
			path: info.outputPath("protected-handover-fa-AF.png"),
			fullPage: true,
		});
		const denied = await browser.newContext();
		try {
			expect(
				(
					await denied.request.get(`${path}?locale=en&format=pdf`, {
						headers: { Accept: "application/pdf" },
					})
				).status(),
			).toBe(403);
		} finally {
			await denied.close();
		}
	} finally {
		await seller.session.close();
	}
});

test("P13 seller records actual tracking and whole delivery separately from goods money", async ({
	browser,
}) => {
	const item = order("dispatched"),
		seller = await login(browser, "owner"),
		t = fulfilmentCopy.en;
	try {
		await seller.page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		for (const mode of ["tracking", "deliver"]) {
			await choose(seller.page, "en", mode);
			const input = seller.page.getByLabel(t.occurredAt, { exact: true });
			await expect(input).toHaveAttribute("step", "1");
			const local = await seller.page.evaluate(() =>
				new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
					.toISOString()
					.slice(0, 19),
			);
			await input.fill(local);
			await seller.page
				.getByLabel(t.reason, { exact: true })
				.fill(
					mode === "tracking"
						? "Synthetic actual manual tracking"
						: "Seller records actual whole delivery",
				);
			if (mode === "tracking")
				await seller.page
					.getByLabel(t.tracking, { exact: true })
					.fill("SYNTHETIC-MANUAL-TRACK-01");
			await seller.page
				.getByRole("button", {
					name: mode === "tracking" ? t.recordTracking : t.deliver,
					exact: true,
				})
				.click();
			await expect(seller.page.getByRole("alertdialog")).toContainText(
				t.occurredAt,
			);
			await confirm(seller.page, "en");
			await expect(
				seller.page.locator("[data-fulfilment-actions]"),
			).toBeFocused();
		}
		const response = await seller.page.request.get(
			`${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/`,
		);
		expect(response.status()).toBe(200);
		const data = await response.json();
		expect(data.stage).toBe("delivered");
		expect(data.delivery.source).toBe("seller");
		expect(data.tracking).toHaveLength(1);
		expect(data.tracking[0].reference).toBe("SYNTHETIC-MANUAL-TRACK-01");
		expect(data.goods_confirmed).toBe("0.00");
		expect(data.completion).toBe("incomplete");
		expect(data.receipts).toHaveLength(0);
	} finally {
		await seller.session.close();
	}
});

test("P13 buyer and seller prepare whole COD with independent native charge approval", async ({
	browser,
}) => {
	const item = order(),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await recipient(buyer.page, "en");
		await buyer.page
			.getByRole("button", { name: t.saveRecipient, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await expect(buyer.page.locator("[data-fulfilment-actions]")).toBeFocused();
	} finally {
		await buyer.session.close();
	}
	const seller = await login(browser, "owner"),
		adminSession = await browser.newContext(),
		admin = await adminSession.newPage();
	try {
		await seller.page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await choose(seller.page, "en", "arrange");
		await seller.page
			.getByLabel(t.provider, { exact: true })
			.fill("Synthetic browser delivery provider");
		await seller.page
			.getByLabel(t.instructions, { exact: true })
			.fill("Whole manual browser dispatch");
		await seller.page
			.getByRole("button", { name: t.saveArrangement, exact: true })
			.click();
		await confirm(seller.page, "en");
		await expect(
			seller.page.locator("[data-fulfilment-actions]"),
		).toBeFocused();
		await choose(seller.page, "en", "prepare");
		await seller.page
			.getByRole("button", { name: t.addBucket, exact: true })
			.click();
		const bucket = seller.page.getByLabel(t.batch, { exact: true });
		await expect(bucket.locator("option")).toHaveCount(2);
		await bucket.focus();
		await bucket.selectOption({ index: 1 });
		await expect(bucket).toBeFocused();
		await seller.page.getByLabel(t.quantity, { exact: true }).fill("1.000");
		await seller.page
			.getByLabel(t.reason, { exact: true })
			.fill("Deliberate complete accepted stock selection");
		await seller.page
			.getByRole("button", { name: t.prepare, exact: true })
			.click();
		await confirm(seller.page, "en");
		await expect(
			seller.page.locator("[data-fulfilment-actions]"),
		).toBeFocused();
		await choose(seller.page, "en", "charge");
		await seller.page.locator("form input[inputmode=decimal]").fill("0.00");
		await seller.page
			.getByLabel(t.reason, { exact: true })
			.fill("Explicit zero separate provider charge");
		await seller.page
			.getByRole("button", { name: t.proposeCharge, exact: true })
			.click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(
			"Synthetic browser delivery provider",
		);
		await confirm(seller.page, "en");
		await expect(
			seller.page.locator("[data-fulfilment-actions]"),
		).toBeFocused();
		const review = JSON.parse(
			disposablePython(
				`import json\nfrom django.urls import reverse\nfrom apps.accounts.models import User\nfrom apps.fulfilment.models import ReviewCase\nc=ReviewCase.objects.get(order_id='${item.id}',kind='charge',state='open')\nprint(json.dumps({'path':reverse('admin:fulfilment_reviewcase_review',args=[c.pk]),'root':str(User.objects.get(email='phase09-root@example.test').pk)}))`,
			),
		) as { path: string; root: string };
		await adminLogin(admin, "phase09-root@example.test");
		await admin.goto(apiOrigin + review.path);
		const submit = () =>
			Promise.all([
				admin.waitForResponse(
					(response) =>
						response.request().method() === "POST" &&
						new URL(response.url()).pathname === review.path,
				),
				admin
					.getByRole("button", {
						name: "Review / record guarded action",
						exact: true,
					})
					.click(),
			]);
		await admin.locator("[name=action]").selectOption("case_assign");
		await admin.locator("[name=assigned_to]").selectOption(review.root);
		await admin
			.locator("[name=reason]")
			.fill("Independent browser reviewer assignment");
		await submit();
		await expect(
			admin.locator("[name=action] option[value=case_approve]"),
		).toHaveCount(1);
		await admin.locator("[name=action]").selectOption("case_approve");
		await admin
			.locator("[name=reason]")
			.fill("Independent explicit zero provider charge approved");
		await submit();
		await expect(
			admin.locator("[name=action] option[value=case_approve]"),
		).toHaveCount(0);
		await seller.page.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		await expect(seller.page.getByText(t.stale, { exact: true })).toBeVisible();
		await seller.page
			.getByRole("button", { name: t.reload, exact: true })
			.click();
		await choose(seller.page, "en", "dispatch");
		await seller.page
			.getByLabel(t.reason, { exact: true })
			.fill("Exact reviewed whole COD shipment");
		await seller.page
			.getByRole("button", { name: t.reviewDispatch, exact: true })
			.click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(
			"Synthetic browser delivery provider",
		);
		await confirm(seller.page, "en");
		await expect(
			seller.page.locator("[data-fulfilment-actions]"),
		).toBeFocused();
		const data = await (
			await seller.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/`,
			)
		).json();
		expect(data.stage).toBe("dispatched");
		expect(data.charge).toBe("0.00");
		expect(data.goods_confirmed).toBe("0.00");
	} finally {
		await seller.session.close();
		await adminSession.close();
	}
});

test("P13 buyer submits and withdraws a named-provider claim without recording funds", async ({
	browser,
}) => {
	const item = order("dispatched", "cod", "5.00"),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await choose(buyer.page, "en", "claim");
		await buyer.page.locator("form input[inputmode=decimal]").fill("2.00");
		const local = await buyer.page.evaluate(() =>
			new Date(Date.now() - 60000 - new Date().getTimezoneOffset() * 60000)
				.toISOString()
				.slice(0, 19),
		);
		await buyer.page.getByLabel(t.paidAt, { exact: true }).fill(local);
		await buyer.page
			.getByLabel(t.description, { exact: true })
			.fill("Synthetic actual provider claim through buyer");
		await buyer.page
			.locator("input[type=file]")
			.setInputFiles(syntheticImage());
		await buyer.page
			.getByRole("button", { name: t.uploads, exact: true })
			.click();
		await expect(
			buyer.page.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		await buyer.page
			.getByRole("button", { name: t.claimDelivery, exact: true })
			.click();
		await expect(buyer.page.getByRole("alertdialog")).toContainText(
			"Synthetic manual delivery provider",
		);
		await confirm(buyer.page, "en");
		await expect(buyer.page.locator("[data-fulfilment-actions]")).toBeFocused();
		let data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.claims[0].amount).toBe("2.00");
		expect(data.claims[0].state).toBe("pending");
		expect(data.delivery_confirmed).toBe("0.00");
		await choose(buyer.page, "en", "withdraw");
		await buyer.page
			.getByLabel(t.claims, { exact: true })
			.selectOption(data.claims[0].id);
		await buyer.page
			.getByLabel(t.reason, { exact: true })
			.fill("Withdraw the unconfirmed provider submission");
		await buyer.page
			.getByRole("button", { name: t.withdrawClaim, exact: true })
			.click();
		await confirm(buyer.page, "en");
		data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.claims[0].state).toBe("withdrawn");
		expect(data.delivery_confirmed).toBe("0.00");
		expect(data.delivery_remaining).toBe("5.00");
		expect(data.receipts).toHaveLength(0);
	} finally {
		await buyer.session.close();
	}
});

test("P13 buyer actual delivery keeps goods unpaid and restores focus when no action remains", async ({
	browser,
}) => {
	const item = order("dispatched"),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await choose(buyer.page, "en", "deliver");
		const local = await buyer.page.evaluate(() =>
			new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
				.toISOString()
				.slice(0, 19),
		);
		await buyer.page.getByLabel(t.occurredAt, { exact: true }).fill(local);
		await buyer.page
			.getByLabel(t.reason, { exact: true })
			.fill("Buyer records actual whole delivery");
		await buyer.page
			.getByRole("button", { name: t.deliver, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await expect(buyer.page.locator("[data-fulfilment-summary]")).toBeFocused();
		const data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.stage).toBe("delivered");
		expect(data.delivery.source).toBe("buyer");
		expect(data.goods_confirmed).toBe("0.00");
		expect(data.completion).toBe("incomplete");
	} finally {
		await buyer.session.close();
	}
});

test("P13 seller explicitly authorizes positive partial advance and consumes the original hold", async ({
	browser,
}) => {
	const item = JSON.parse(
		disposablePython(`import json,uuid
from django.test import override_settings
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery
from apps.accounts.models import User
from apps.orders.models import SellerOrder
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.payments import services as p,models as m
value=example_delivery('advance',stage='prepared');o=SellerOrder.objects.get(pk=value['id'])
s=actor(User.objects.get(email='phase12-owner@example.test'),'seller');r=actor(User.objects.get(email='phase09-root@example.test'),'owner');receipt=m.Receipt.objects.get(order=o)
with override_settings(OWNER_MFA_REQUIRED=False):
 p.mutate(s,o.pk,'correction',{'command_id':uuid.uuid4(),'version':m.Finance.objects.get(order=o).version,'receipt':receipt.pk,'receipt_version':1,'amount':'1.00','paid_at':receipt.paid_at,'description':'Corrected synthetic actual goods funds','reason':'Independent actual positive partial amount'})
 c=m.ReviewCase.objects.get(order=o,kind='correction')
 for action in ['assign','approve']:
  c.refresh_from_db();p.decide(r,c.pk,{'command_id':uuid.uuid4(),'version':m.Finance.objects.get(order=o).version,'case_version':c.version,'action':action,'assigned_to':r.user.pk,'reason':'Independent actual positive partial correction'})
print(json.dumps(value))`),
	) as { id: string; seller: string };
	const seller = await login(browser, "owner"),
		t = fulfilmentCopy.en;
	try {
		await seller.page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await choose(seller.page, "en", "partial");
		await seller.page
			.getByLabel(t.reason, { exact: true })
			.fill(
				"Seller deliberately permits dispatch with this positive partial balance",
			);
		await seller.page
			.getByRole("button", { name: t.partial, exact: true })
			.click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(
			"1.00 AFN",
		);
		await expect(seller.page.getByRole("alertdialog")).toContainText(
			"11.50 AFN",
		);
		await confirm(seller.page, "en");
		await expect(
			seller.page.locator("[data-fulfilment-actions]"),
		).toBeFocused();
		await choose(seller.page, "en", "dispatch");
		await seller.page
			.getByLabel(t.reason, { exact: true })
			.fill("Consume the exact original whole advance hold");
		await seller.page
			.getByRole("button", { name: t.reviewDispatch, exact: true })
			.click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(
			t.consume_hold,
		);
		await confirm(seller.page, "en");
		await expect(
			seller.page.locator("[data-fulfilment-actions]"),
		).toBeFocused();
		const data = await (
			await seller.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/`,
			)
		).json();
		expect(data.stage).toBe("dispatched");
		expect(data.goods_confirmed).toBe("1.00");
		expect(data.goods_remaining).toBe("11.50");
		expect(data.allocation).toBe("consumed");
		expect(data.completion).toBe("incomplete");
	} finally {
		await seller.session.close();
	}
});

test("P13 a delayed committed tracking response cannot cross a deliberate business switch", async ({
	browser,
}) => {
	const item = order("dispatched"),
		t = fulfilmentCopy.en;
	const other = disposablePython(
		"from apps.accounts.models import Account\nfrom apps.organizations.models import BusinessProfile,Membership\na=Account.objects.get(user__email='phase13-logistics@example.test',context='seller')\nb=BusinessProfile.objects.get(account__user__email='phase09-company2@example.test',kind='company')\nMembership.objects.update_or_create(company=b,account=a,defaults={'active':True,'bundles':['fulfilment']})\nprint(b.pk)",
	).trim();
	const session = await browser.newContext(),
		page = await session.newPage();
	let release = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	let committed = false;
	try {
		await page.goto("/en/auth/seller-sign-in");
		await page.locator("[name=email]").fill("phase13-logistics@example.test");
		await page.locator("[name=password]").fill(fixturePassword);
		await page.locator(".account-card > form button[type=submit]").click();
		await expect(page).toHaveURL(/\/account\/seller$/, { timeout: 15000 });
		await page.goto(
			`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
		);
		await choose(page, "en", "tracking");
		await page
			.getByLabel(t.occurredAt, { exact: true })
			.fill(
				await page.evaluate(() =>
					new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
						.toISOString()
						.slice(0, 19),
				),
			);
		await page
			.getByLabel(t.reason, { exact: true })
			.fill("Private business A tracking fact");
		await page
			.getByLabel(t.tracking, { exact: true })
			.fill("SYNTHETIC-SCOPE-A-TRACK");
		await page.route(
			`**/fulfilment/seller/orders/${item.id}/tracking/`,
			async (route) => {
				const response = await route.fetch();
				expect(response.status()).toBe(201);
				committed = true;
				await pending;
				await route.fulfill({ response }).catch(() => {});
			},
		);
		await page
			.getByRole("button", { name: t.recordTracking, exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: t.confirm, exact: true })
			.click();
		await expect.poll(() => committed).toBe(true);
		await expect(
			page.getByRole("button", { name: t.reconcile, exact: true }),
		).toBeEnabled({ timeout: 20000 });
		const back = page
			.locator("main")
			.getByRole("link", { name: sellerSalesCopy.en.fulfilment, exact: true })
			.last();
		await back.click();
		const warning = page
			.getByRole("alert")
			.filter({ hasText: catalogueCopy.en.dirty });
		await expect(warning).toBeVisible();
		await warning
			.getByRole("button", { name: catalogueCopy.en.cancel, exact: true })
			.click();
		await expect(page.getByRole("textbox", { name: t.reason, exact: true })).toHaveValue(
			"Private business A tracking fact",
		);
		await back.click();
		await warning
			.getByRole("button", { name: catalogueCopy.en.confirm, exact: true })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/fulfilment\\?seller=${item.seller}$`),
		);
		const profiles = await (
			await page.request.get(`${apiOrigin}/api/v1/fulfilment/seller/profiles/`)
		).json();
		expect(
			profiles.results.some((value: { id: string }) => value.id === other),
		).toBe(true);
		await selectControl(page, sellerSalesCopy.en.business, other);
		await expect(page).toHaveURL(new RegExp(`/fulfilment\\?seller=${other}$`));
		release();
		await expect(
			page.getByRole("heading", { name: sellerSalesCopy.en.fulfilment, exact: true }),
		).toBeVisible();
		await expect(page.locator("body")).not.toContainText(item.number);
		await expect(page.locator("body")).not.toContainText(
			"Private business A tracking fact",
		);
		await expect(page.locator("body")).not.toContainText(
			"Synthetic private address — never real contact data",
		);
		const saved = await (
			await page.request.get(
				`${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/`,
			)
		).json();
		expect(saved.tracking).toHaveLength(1);
		expect(saved.tracking[0].reference).toBe("SYNTHETIC-SCOPE-A-TRACK");
		expect(
			await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])),
		).not.toContain("Private business A tracking fact");
	} finally {
		release();
		await session.close();
	}
});

for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
	for (const [width, theme] of [
		[1440, "light"],
		[390, "dark"],
	] as const) {
		test(`P13 seller ${locale} ${width} ${theme}: one inherited shell and scoped dispatch navigation`, async ({
			browser,
		}, info) => {
			const item = order("prepared"),
				seller = await login(browser, "owner"),
				t = fulfilmentCopy[locale];
			try {
				await seller.page.setViewportSize({ width, height: 1000 });
				await seller.page.addInitScript(
					(value) => localStorage.setItem("rezayi-theme", value),
					theme,
				);
				await seller.page.goto(
					`/${locale}/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
				);
				await expect(seller.page.locator("html")).toHaveAttribute(
					"dir",
					locale === "en" ? "ltr" : "rtl",
				);
				await expect(seller.page.getByRole("main")).toHaveCount(1);
				await expect(seller.page.getByRole("banner")).toHaveCount(1);
				await expect(seller.page.locator(".account-shell")).toHaveCount(0);
				await expect(seller.page.getByRole("contentinfo")).toHaveCount(0);
				if (width < 640) await seller.page.getByRole("button", { name: sellerShellCopy[locale].more, exact: true }).click();
				const navigation = seller.page
					.locator('nav a[aria-current="page"]:visible')
					.filter({ hasText: sellerSalesCopy[locale].fulfilment });
				await expect(navigation).toHaveCount(1);
				await expect(navigation).toHaveAttribute(
					"href",
					`/${locale}/account/seller/fulfilment?seller=${item.seller}`,
				);
				if (width < 640) await seller.page.getByRole("button", { name: sellerShellCopy[locale].close, exact: true }).click();
				await choose(seller.page, locale, "dispatch");
				await seller.page
					.getByLabel(t.reason, { exact: true })
					.fill("Synthetic exact whole dispatch review");
				const review = seller.page.getByRole("button", {
					name: t.reviewDispatch,
					exact: true,
				});
				await review.click();
				await expect(seller.page.getByRole("alertdialog")).toContainText(
					"1.000",
				);
				await seller.page.keyboard.press("Escape");
				await expect(review).toBeFocused();
				await expect(
					seller.page.getByLabel(t.reason, { exact: true }),
				).toHaveValue("Synthetic exact whole dispatch review");
				const data = await (
					await seller.page.request.get(
						`${apiOrigin}/api/v1/fulfilment/seller/orders/${item.id}/`,
					)
				).json();
				expect(data.stage).toBe("prepared");
				await expect(seller.page.locator(".skip-link")).not.toBeInViewport();
				await seller.page.evaluate(() => window.scrollTo(0, 0));
				await seller.page.evaluate(() => document.fonts.ready);
				await noOverflow(seller.page);
				await seller.page.screenshot({
					path: info.outputPath(`seller-${locale}-${width}.png`),
					fullPage: true,
				});
			} finally {
				await seller.session.close();
			}
		});
	}
}

function reviewCorrectionFixture(id: string, body: string) {
	return disposablePython(`from apps.orders.models import SellerOrder
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.fulfilment.management.commands.seed_fulfilment_examples import command,review
from apps.fulfilment import models as m,queries
from django.utils import timezone
from datetime import timedelta
o=SellerOrder.objects.get(pk='${id}')
b=actor(User.objects.get(email='phase12-buyer@example.test'),'buyer')
s=actor(User.objects.get(email='phase12-owner@example.test'),'seller')
r=actor(User.objects.get(email='phase09-root@example.test'),'owner')
${body}`).trim();
}
async function reviewLocalTime(page: Page) {
	return page.evaluate(() =>
		new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
			.toISOString()
			.slice(0, 19),
	);
}
async function discardChangedAction(
	page: Page,
	locale: Locale,
	mode: string,
	cancel: boolean,
) {
	await choose(page, locale, mode);
	const warning = page
		.getByRole("alert")
		.filter({ hasText: catalogueCopy[locale].dirty });
	await warning
		.getByRole("button", {
			name: cancel
				? catalogueCopy[locale].cancel
				: catalogueCopy[locale].confirm,
			exact: true,
		})
		.click();
}
for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
	test(`P13 review R1: external dispatch preserves draft and reachable actions in ${locale}`, async ({
		browser,
	}) => {
		const item = order("prepared"),
			buyer = await login(browser),
			seller = await login(browser, "owner"),
			t = fulfilmentCopy[locale];
		try {
			await buyer.page.goto(`/${locale}/account/buyer/deliveries/${item.id}`);
			await buyer.page
				.getByLabel(t.address, { exact: true })
				.fill("Synthetic retained draft after external dispatch");
			await seller.page.goto(
				`/en/account/seller/fulfilment/${item.id}?seller=${item.seller}`,
			);
			await choose(seller.page, "en", "dispatch");
			await seller.page
				.getByLabel(fulfilmentCopy.en.reason, { exact: true })
				.fill("Actual seller dispatch while buyer draft stays open");
			await seller.page
				.getByRole("button", {
					name: fulfilmentCopy.en.reviewDispatch,
					exact: true,
				})
				.click();
			await confirm(seller.page, "en");
			await buyer.page.bringToFront();
			await buyer.page.evaluate(() =>
				window.dispatchEvent(new Event("online")),
			);
			await expect(
				buyer.page.getByText(t.actionChanged, { exact: true }),
			).toBeVisible();
			await expect(
				buyer.page.getByLabel(t.address, { exact: true }),
			).toBeDisabled();
			await discardChangedAction(buyer.page, locale, "deliver", true);
			await expect(
				buyer.page.getByLabel(t.address, { exact: true }),
			).toHaveValue("Synthetic retained draft after external dispatch");
			await discardChangedAction(buyer.page, locale, "deliver", false);
			await buyer.page
				.getByLabel(t.occurredAt, { exact: true })
				.fill(await reviewLocalTime(buyer.page));
			await buyer.page
				.getByLabel(t.reason, { exact: true })
				.fill("Buyer confirms actual whole delivery after switching action");
			await buyer.page
				.getByRole("button", { name: t.deliver, exact: true })
				.click();
			await confirm(buyer.page, locale);
			const data = await (
				await buyer.page.request.get(
					`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
				)
			).json();
			expect(data.delivery.source).toBe("buyer");
			expect(data.stage).toBe("delivered");
			expect(data.completion).toBe("incomplete");
			await noOverflow(buyer.page);
		} finally {
			await buyer.session.close();
			await seller.session.close();
		}
	});
}

test("P13 review R1: external zero charge preserves dirty claim fields and staged proof until discard", async ({
	browser,
}) => {
	const item = order("prepared", "cod", "5.00"),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await choose(buyer.page, "en", "claim");
		await buyer.page.locator("form input[inputmode=decimal]").fill("2.00");
		await buyer.page
			.getByLabel(t.description, { exact: true })
			.fill("Synthetic retained provider claim");
		await buyer.page
			.getByLabel(t.paidAt, { exact: true })
			.fill(await reviewLocalTime(buyer.page));
		await buyer.page
			.locator("input[type=file]")
			.setInputFiles(syntheticImage());
		await buyer.page
			.getByRole("button", { name: t.uploads, exact: true })
			.click();
		await expect(
			buyer.page.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		reviewCorrectionFixture(
			item.id,
			`a=m.Arrangement.objects.filter(order=o).order_by('-event__version').first()
p=command(o,s,'charge',provider=a.provider_id,amount='0.00',currency=o.currency,reason='Explicit zero replaces prior charge before dispatch')
review(m.ReviewCase.objects.get(proposal_id=p['proposal']),r)`,
		);
		await buyer.page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect(
			buyer.page.getByText(t.actionChanged, { exact: true }),
		).toBeVisible();
		await discardChangedAction(buyer.page, "en", "recipient", true);
		await expect(
			buyer.page.locator("form input[inputmode=decimal]"),
		).toHaveValue("2.00");
		await expect(
			buyer.page.getByLabel(t.description, { exact: true }),
		).toHaveValue("Synthetic retained provider claim");
		await expect(
			buyer.page.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		await discardChangedAction(buyer.page, "en", "recipient", false);
		await expect(
			buyer.page.getByRole("img", { name: t.openImage, exact: true }),
		).toHaveCount(0);
		const data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.claims).toHaveLength(0);
		expect(data.delivery_confirmed).toBe("0.00");
	} finally {
		await buyer.session.close();
	}
});

test("P13 review R1: external claim confirmation retains withdrawal reason and valid alternatives", async ({
	browser,
}) => {
	const item = order("dispatched", "cod", "5.00"),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	const claim = reviewCorrectionFixture(
		item.id,
		`c=command(o,b,'claim',charge=queries.current_charge(o).pk,amount='5.00',currency=o.currency,paid_at=timezone.now()-timedelta(minutes=1),description='Synthetic provider receipt')
print(c['claim'])`,
	);
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await choose(buyer.page, "en", "withdraw");
		await buyer.page.getByLabel(t.claims, { exact: true }).selectOption(claim);
		await buyer.page
			.getByLabel(t.reason, { exact: true })
			.fill("Synthetic retained withdrawal reason");
		reviewCorrectionFixture(
			item.id,
			`review(m.ReviewCase.objects.get(claim_id='${claim}'),r)`,
		);
		await buyer.page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect(
			buyer.page.getByText(t.actionChanged, { exact: true }),
		).toBeVisible();
		await discardChangedAction(buyer.page, "en", "deliver", true);
		await expect(buyer.page.getByRole("textbox", { name: t.reason, exact: true })).toHaveValue(
			"Synthetic retained withdrawal reason",
		);
		await discardChangedAction(buyer.page, "en", "deliver", false);
		await expect(
			buyer.page.getByLabel(t.occurredAt, { exact: true }),
		).toBeEnabled();
	} finally {
		await buyer.session.close();
	}
});

test("P13 review R3: correction proof survives reload and independent approval", async ({
	browser,
}) => {
	const item = order("dispatched", "cod", "5.00"),
		buyer = await login(browser),
		t = fulfilmentCopy.en;
	const receipt = reviewCorrectionFixture(
		item.id,
		`c=command(o,b,'claim',charge=queries.current_charge(o).pk,amount='5.00',currency=o.currency,paid_at=timezone.now()-timedelta(minutes=1),description='Synthetic original provider receipt')
review(m.ReviewCase.objects.get(claim_id=c['claim']),r)
print(m.Receipt.objects.get(order=o).pk)`,
	);
	try {
		await buyer.page.goto(`/en/account/buyer/deliveries/${item.id}`);
		await choose(buyer.page, "en", "correction");
		await buyer.page
			.getByLabel(t.receipts, { exact: true })
			.selectOption(receipt);
		await buyer.page.locator("form input[inputmode=decimal]").fill("4.00");
		await buyer.page
			.getByLabel(t.reason, { exact: true })
			.fill("Synthetic retained correction image");
		await buyer.page
			.locator("input[type=file]")
			.setInputFiles(syntheticImage());
		await buyer.page
			.getByRole("button", { name: t.uploads, exact: true })
			.click();
		await expect(
			buyer.page.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		await buyer.page
			.getByRole("button", { name: t.correctionDelivery, exact: true })
			.click();
		await confirm(buyer.page, "en");
		await buyer.page.reload();
		const history = buyer.page
			.getByRole("heading", { name: t.corrections, exact: true })
			.locator("..");
		await expect(
			history.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		reviewCorrectionFixture(
			item.id,
			`review(m.ReviewCase.objects.get(correction__receipt_id='${receipt}'),r)`,
		);
		await buyer.page.reload();
		await expect(
			history.getByRole("img", { name: t.openImage, exact: true }),
		).toBeVisible();
		const data = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/fulfilment/buyer/orders/${item.id}/`,
			)
		).json();
		expect(data.corrections[0].state).toBe("approved");
		expect(data.corrections[0].evidence).toHaveLength(1);
		expect(data.delivery_confirmed).toBe("4.00");
		expect(data.goods_confirmed).toBe("0.00");
	} finally {
		await buyer.session.close();
	}
});

test("P13 review R4: native handover loads retained fonts and print styles in both Dari and English", async ({
	browser,
}) => {
	const item = order("dispatched"),
		session = await browser.newContext(),
		page = await session.newPage();
	try {
		// One native authentication serves both directions; the shared login
		// helper decides the MFA step from the live form, not from a repeat.
		await adminLogin(page, "phase09-root@example.test");
		for (const locale of ["fa-AF", "en"] as const) {
			const response = await page.goto(
				`${apiOrigin}/admin/fulfilment/state/${item.id}/handover/?locale=${locale}&format=html`,
			);
			expect(response?.status()).toBe(200);
			expect(response?.headers()["content-security-policy"]).toContain(
				"font-src data:",
			);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				locale === "en" ? "ltr" : "rtl",
			);
			await page.evaluate(() => document.fonts.ready);
			const fonts = await page.evaluate(() => {
				const image = document.querySelector("img");
				return {
					family: getComputedStyle(document.body).fontFamily,
					loaded: Array.from(document.fonts).map((face) => ({
						family: face.family,
						status: face.status,
					})),
					imageWidth: image ? getComputedStyle(image).width : null,
				};
			});
			expect(fonts.family).toContain(
				locale === "en" ? "HandoverLatin" : "HandoverArabic",
			);
			expect(
				fonts.loaded.some(
					(face) =>
						face.family ===
							(locale === "en" ? "HandoverLatin" : "HandoverArabic") &&
						face.status === "loaded",
				),
			).toBe(true);
			expect(fonts.imageWidth).toBe("180px");
			await page.emulateMedia({ media: "print" });
			expect(
				await page.evaluate(() => getComputedStyle(document.body).marginTop),
			).toBe("0px");
			await noOverflow(page);
			await page.emulateMedia({ media: "screen" });
		}
	} finally {
		await session.close();
	}
});
