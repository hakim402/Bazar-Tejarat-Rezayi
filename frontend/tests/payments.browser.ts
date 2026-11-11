import { test, expect, type Browser, type Page } from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
import { syntheticImage } from "./support/messaging-runtime";
import { noOverflow } from "./support/commerce-runtime";
import { adminLogin, adminAppearance } from "./support/admin-runtime";
import { selectControl } from "./support/seller-controls";
import { sellerSalesCopy } from "../lib/i18n/seller-sales";
import { paymentCopy } from "../features/payments/copy";
import type { Locale } from "../lib/i18n/locales";
import { catalogueCopy } from "../lib/i18n/catalogue";
test.skip(
	process.env.COMMERCE_BROWSER_TESTS !== "1",
	"Use the owned Phase12 MariaDB harness.",
);
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });
test.beforeEach(() =>
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	),
);
function order(method = "advance", negotiated = false) {
	return JSON.parse(
		disposablePython(`import json
from apps.payments.management.commands.seed_payment_examples import example_order
print(json.dumps(example_order('${method}',negotiated=${negotiated ? "True" : "False"})))`),
	) as {
		id: string;
		seller: string;
		invoice: string;
		variant: string;
		number: string;
	};
}
async function login(browser: Browser, role = "buyer") {
	const session = await browser.newContext({ offline: true });
	await session.setOffline(false);
	const page = await session.newPage(),
		context = role === "buyer" ? "buyer" : "seller";
	await page.goto(`/en/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(`phase12-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(new RegExp(`/account/${context}$`));
	return { session, page, context };
}
async function facts(
	page: Page,
	locale: Locale,
	amount = "5.00",
	claim = false,
) {
	const t = paymentCopy[locale],
		form = page.locator("form").filter({
			has: page.getByRole("heading", {
				name: claim ? t.claim : t.receipt,
				exact: true,
			}),
		});
	await form.getByLabel(new RegExp(`^${t.amount}`)).fill(amount);
	await form
		.getByLabel(t.paidAt, { exact: true })
		.fill(new Date(Date.now() - 3600000).toISOString().slice(0, 16));
	await form
		.getByLabel(t.description, { exact: true })
		.fill("Synthetic private actual cash receipt");
	return form;
}
async function reviewAndSend(
	page: Page,
	form: ReturnType<Page["locator"]>,
	locale: Locale,
) {
	const t = paymentCopy[locale];
	await form.getByRole("button", { name: t.exact, exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: t.confirm, exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: t.reconcile, exact: true }),
	).toHaveCount(0);
}
for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
	for (const [width, theme] of [
		[1440, "light"],
		[390, "dark"],
	] as const) {
		test(`P12 ${locale} ${width} ${theme}: exact buyer claim and approved shell`, async ({
			browser,
		}) => {
			const item = order("cod"),
				buyer = await login(browser);
			try {
				await buyer.page.setViewportSize({ width, height: 1000 });
				await buyer.page.addInitScript((theme) => {
					localStorage.setItem("rezayi-theme", theme);
				}, theme);
				await buyer.page.goto(`/${locale}/account/buyer/payments/${item.id}`);
				const t = paymentCopy[locale];
				await expect(
					buyer.page.getByRole("heading", { name: t.title, exact: true }),
				).toBeVisible();
				await expect(buyer.page.locator("html")).toHaveAttribute(
					"dir",
					locale === "en" ? "ltr" : "rtl",
				);
				const form = await facts(buyer.page, locale, "1.25", true),
					opener = form.getByRole("button", { name: t.exact, exact: true });
				await opener.click();
				await expect(buyer.page.getByRole("alertdialog")).toContainText(
					"1.25 AFN",
				);
				await buyer.page.keyboard.press("Escape");
				await expect(opener).toBeFocused();
				await reviewAndSend(buyer.page, form, locale);
				await expect(
					buyer.page.locator("[data-payment-facts-review]"),
				).toBeFocused();
				const result = await buyer.page.request.get(
					`${apiOrigin}/api/v1/payments/buyer/orders/${item.id}/`,
				);
				expect(result.status()).toBe(200);
				const body = await result.json();
				expect(body.confirmed_total).toBe("0.00");
				expect(body.allocation).toBe("unreserved");
				expect(body.claims).toHaveLength(1);
				expect(body.claims[0].state).toBe("pending");
				await noOverflow(buyer.page);
				await buyer.page.screenshot({
					path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/payments-${locale}-${width}-${theme}.png`,
					fullPage: true,
				});
			} finally {
				await buyer.session.close();
			}
		});
	}
}
test("P12 lost acknowledgement: refresh reconciles original receipt without duplication", async ({
	browser,
}) => {
	const item = order("cod"),
		seller = await login(browser, "finance");
	try {
		await seller.page.goto(
			`/en/account/seller/payments/${item.id}?seller=${item.seller}`,
		);
		const form = await facts(seller.page, "en", "5.00");
		let key = "",
			calls = 0,
			ackLost = false;
		await seller.page.route(
			`**/payments/seller/orders/${item.id}/receipts/`,
			async (route) => {
				calls++;
				key = route.request().postDataJSON().command_id;
				const response = await route.fetch();
				expect(response.status()).toBe(201);
				await route.abort("failed");
				ackLost = true;
			},
		);
		await form
			.getByRole("button", { name: paymentCopy.en.exact, exact: true })
			.click();
		await seller.page
			.getByRole("alertdialog")
			.getByRole("button", { name: paymentCopy.en.confirm, exact: true })
			.click();
		await expect(
			seller.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toBeVisible();
		await expect.poll(() => ackLost).toBe(true);
		await expect(
			seller.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toBeEnabled();
		expect(calls).toBe(1);
		await expect(seller.page).toHaveURL(new RegExp(`payment_attempt=${key}`));
		expect(seller.page.url()).not.toContain("5.00");
		expect(
			await seller.page.evaluate(() =>
				JSON.stringify([localStorage, sessionStorage]),
			),
		).not.toContain("Synthetic private actual cash receipt");
		await seller.page.unroute(`**/payments/seller/orders/${item.id}/receipts/`);
		seller.page.once("dialog", (dialog) => dialog.accept());
		await seller.page.reload();
		await seller.page
			.getByRole("button", { name: paymentCopy.en.reconcile, exact: true })
			.click();
		await expect(
			seller.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toHaveCount(0);
		const data = await (
			await seller.page.request.get(
				`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
			)
		).json();
		expect(data.confirmed_total).toBe("5.00");
		expect(data.receipts).toHaveLength(1);
	} finally {
		await seller.session.close();
	}
});
test("P12 finance-only member records advance receipt then complete stock selection reserves once", async ({
	browser,
}) => {
	const item = order(),
		seller = await login(browser, "finance");
	try {
		await seller.page.goto(
			`/en/account/seller/payments/${item.id}?seller=${item.seller}`,
		);
		const form = await facts(seller.page, "en", "2.00");
		await reviewAndSend(seller.page, form, "en");
		await expect(
			seller.page.getByText(/Awaiting selection/).first(),
		).toBeVisible();
		const selection = seller.page.locator("form").filter({
			has: seller.page.getByRole("heading", {
				name: paymentCopy.en.selection,
				exact: true,
			}),
		});
		await selection.getByRole("textbox").first().fill("1.000");
		await selection
			.getByLabel(paymentCopy.en.reason, { exact: true })
			.fill("Complete accepted whole-order selection");
		await reviewAndSend(seller.page, selection, "en");
		await expect(seller.page.getByText(/Reserved/).first()).toBeVisible();
		const state = await (
			await seller.page.request.get(
				`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
			)
		).json();
		expect(state.confirmed_total).toBe("2.00");
		expect(state.allocation).toBe("reserved");
		expect(state.selection.allocation).toBeTruthy();
		expect(
			(
				await seller.page.request.get(
					`${apiOrigin}/api/v1/orders/seller/orders/${item.id}/`,
				)
			).status(),
		).toBe(404);
	} finally {
		await seller.session.close();
	}
});
test("P12 negotiated order retains caps, exact claim confirmation and independent native correction", async ({
	browser,
}) => {
	const item = order("advance", true),
		buyer = await login(browser),
		seller = await login(browser, "owner");
	const admin = await browser.newContext({ offline: false }),
		page = await admin.newPage();
	try {
		await buyer.page.goto(`/en/account/buyer/payments/${item.id}`);
		await reviewAndSend(
			buyer.page,
			await facts(buyer.page, "en", "4.00", true),
			"en",
		);
		await seller.page.goto(
			`/en/account/seller/payments/${item.id}?seller=${item.seller}`,
		);
		const claims = seller.page
			.getByRole("heading", { name: paymentCopy.en.claims, exact: true })
			.locator("..");
		await claims
			.getByLabel(paymentCopy.en.reason, { exact: true })
			.fill("Confirm the exact submitted buyer facts");
		await claims
			.getByRole("button", { name: paymentCopy.en.confirmClaim, exact: true })
			.click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(
			"4.00 AFN",
		);
		await seller.page
			.getByRole("alertdialog")
			.getByRole("button", { name: paymentCopy.en.confirm, exact: true })
			.click();
		await expect(
			seller.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toHaveCount(0);
		await seller.page
			.getByRole("button", { name: paymentCopy.en.correction, exact: true })
			.click();
		const correction = seller.page.locator("form").filter({
			has: seller.page.getByRole("heading", {
				name: paymentCopy.en.correction,
				exact: true,
			}),
		});
		await correction
			.getByLabel(new RegExp(`^${paymentCopy.en.amount}`))
			.fill("3.00");
		await correction
			.getByLabel(paymentCopy.en.reason, { exact: true })
			.fill("Correct actual cash amount with retained original");
		await seller.page
			.getByRole("button", { name: paymentCopy.en.cancel, exact: true })
			.click();
		const warning = seller.page.getByRole("alert").filter({
			hasText: catalogueCopy.en.dirty,
		});
		await expect(warning).toBeVisible();
		await warning
			.getByRole("button", { name: catalogueCopy.en.cancel, exact: true })
			.click();
		await expect(
			correction.getByLabel(new RegExp(`^${paymentCopy.en.amount}`)),
		).toHaveValue("3.00");
		await reviewAndSend(seller.page, correction, "en");
		const fixture = JSON.parse(
			disposablePython(
				"import json,sys,uuid\nfrom apps.accounts.models import User\nfrom apps.payments.models import ReviewCase\nd=json.load(sys.stdin)\nu=User.objects.create_user('payment-root-'+uuid.uuid4().hex+'@example.test',d['password'],display_name='Synthetic independent payment root',email_verified=True,is_staff=True,is_superuser=True)\nc=ReviewCase.objects.get(order_id=d['order'],kind='correction')\nprint(json.dumps({'id':str(u.pk),'email':u.email,'case':str(c.pk),'receipt_case':str(ReviewCase.objects.get(order_id=d['order'],kind='receipt').pk)}))",
				JSON.stringify({ password: fixturePassword, order: item.id }),
			),
		) as { id: string; email: string; case: string; receipt_case: string };
		await adminLogin(page, fixture.email);
		await page.goto(
			`${apiOrigin}/admin/payments/reviewcase/${fixture.case}/review/`,
		);
		await expect(
			page.getByRole("region", { name: "Exact correction proposal" }),
		).toContainText("3.00 AFN");
		await page.locator("[name=action]").selectOption("assign");
		await page.locator("[name=assigned_to]").selectOption(fixture.id);
		await page
			.locator("[name=reason]")
			.fill("Assign independent synthetic root");
		const assigned = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/reviewcase/${fixture.case}/review/`) &&
				response.request().method() === "POST",
		);
		await page.getByRole("button", { name: "Record guarded decision" }).click();
		expect((await assigned).status()).toBe(302);
		await page.locator("[name=action]").selectOption("approve");
		await page
			.locator("[name=reason]")
			.fill("Independent exact correction reviewed");
		const approved = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/reviewcase/${fixture.case}/review/`) &&
				response.request().method() === "POST",
		);
		await page.getByRole("button", { name: "Record guarded decision" }).click();
		expect((await approved).status()).toBe(302);
		await expect(page.locator("#content")).toContainText("approved");
		for (const [width, theme] of [
			[1440, "light"],
			[390, "dark"],
		] as const) {
			await adminAppearance(page, width, theme);
			await page.screenshot({
				path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/payments-native-review-${width}-${theme}.png`,
				fullPage: true,
			});
		}
		await page.goto(
			`${apiOrigin}/admin/payments/reviewcase/${fixture.receipt_case}/review/`,
		);
		await expect(
			page.getByRole("region", { name: "Exact recorded receipt" }),
		).toContainText("4.00 AFN");
		await adminAppearance(page, 1440, "light");
		await page.screenshot({
			path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/payments-native-original-receipt.png`,
			fullPage: true,
		});
		await buyer.page.reload();
		await expect(
			buyer.page.getByText("3.00 AFN", { exact: true }).first(),
		).toBeVisible();
		const state = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/payments/buyer/orders/${item.id}/`,
			)
		).json();
		expect(state.confirmed_total).toBe("3.00");
		expect(state.receipts[0].original_amount).toBe("4.00");
	} finally {
		await buyer.session.close();
		await seller.session.close();
		await admin.close();
	}
});
test("P12 orders-only member gets summary and invoice entry without private financial controls", async ({
	browser,
}) => {
	const item = order("cod"),
		member = await login(browser, "operations");
	try {
		await member.page.goto(
			`/en/account/seller/payments/${item.id}?seller=${item.seller}`,
		);
		await expect(
			member.page.getByRole("heading", {
				name: paymentCopy.en.title,
				exact: true,
			}),
		).toBeVisible();
		await expect(
			member.page.getByRole("heading", {
				name: paymentCopy.en.receipt,
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			member.page.getByRole("heading", {
				name: paymentCopy.en.claims,
				exact: true,
			}),
		).toHaveCount(0);
		const row = await (
			await member.page.request.get(
				`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
			)
		).json();
		expect(row.capabilities.details).toBe(false);
		expect(row.capabilities.receipt).toBe(false);
		expect(row.receipts).toEqual([]);
	} finally {
		await member.session.close();
	}
});

test("P12 optional image stays private through staging, claim history and scope loss", async ({
	browser,
}) => {
	const item = order("cod"),
		buyer = await login(browser),
		other = await login(browser, "operations");
	try {
		await buyer.page.goto(`/en/account/buyer/payments/${item.id}`);
		const form = await facts(buyer.page, "en", "1.00", true);
		await form.locator("input[type=file]").setInputFiles(syntheticImage());
		await expect(form).toContainText("(1/3)");
		await form
			.getByRole("button", { name: paymentCopy.en.exact, exact: true })
			.click();
		const dialog = buyer.page.getByRole("alertdialog");
		await expect(dialog.locator('img[src^="blob:"]')).toBeVisible();
		await dialog
			.getByRole("button", { name: paymentCopy.en.confirm, exact: true })
			.click();
		await expect(
			buyer.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toHaveCount(0);
		const state = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/payments/buyer/orders/${item.id}/`,
			)
		).json();
		const id = state.claims[0].evidence[0];
		expect(id).toBeTruthy();
		const bytes = await buyer.page.request.get(
			`${apiOrigin}/api/v1/payments/buyer/evidence/${id}/`,
		);
		expect(bytes.status()).toBe(200);
		expect(bytes.headers()["cache-control"]).toContain("no-store");
		expect(
			(
				await other.page.request.get(
					`${apiOrigin}/api/v1/payments/seller/evidence/${id}/`,
				)
			).status(),
		).toBe(404);
	} finally {
		await buyer.session.close();
		await other.session.close();
	}
});

test("P12 rejected uncommitted action is fenced before editing and preserves entered facts", async ({
	browser,
}) => {
	const item = order("cod"),
		seller = await login(browser, "finance");
	try {
		await seller.page.goto(
			`/en/account/seller/payments/${item.id}?seller=${item.seller}`,
		);
		const form = await facts(seller.page, "en", "5.00");
		const path = `**/payments/seller/orders/${item.id}/receipts/`;
		let rejected = false;
		await seller.page.route(path, async (route) => {
			await route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					error: {
						code: "validation_error",
						fields: { paid_at: ["synthetic_rejection"] },
					},
				}),
			});
			rejected = true;
		});
		await form
			.getByRole("button", { name: paymentCopy.en.exact, exact: true })
			.click();
		await seller.page
			.getByRole("alertdialog")
			.getByRole("button", { name: paymentCopy.en.confirm, exact: true })
			.click();
		await expect(
			seller.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toBeVisible();
		await expect.poll(() => rejected).toBe(true);
		await expect(
			seller.page.getByRole("button", {
				name: paymentCopy.en.reconcile,
				exact: true,
			}),
		).toBeEnabled();
		await seller.page.unroute(path);
		await seller.page
			.getByRole("button", { name: paymentCopy.en.reconcile, exact: true })
			.click();
		await expect(form.getByLabel(/^Amount/)).toHaveValue("5.00");
		await expect(
			form.getByLabel(paymentCopy.en.description, { exact: true }),
		).toHaveValue("Synthetic private actual cash receipt");
		const current = await (
			await seller.page.request.get(
				`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
			)
		).json();
		expect(current.receipts).toHaveLength(0);
		await reviewAndSend(seller.page, form, "en");
	} finally {
		await seller.session.close();
	}
});

test("P12 uncertain A receipt cannot overwrite business B; deliberate switch and revocation clear private content", async ({
	browser,
}) => {
	const item = order("cod");
	const other = disposablePython(
		"from apps.accounts.models import Account\nfrom apps.organizations.models import BusinessProfile,Membership\na=Account.objects.get(user__email='phase12-finance@example.test',context='seller')\nb=BusinessProfile.objects.get(account__user__email='phase09-company2@example.test',kind='company')\nMembership.objects.update_or_create(company=b,account=a,defaults={'active':True,'bundles':['payments_refunds']})\nprint(b.pk)",
	).trim();
	const seller = await login(browser, "finance");
	let release = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	let committed = false;
	try {
		await seller.page.goto(
			`/en/account/seller/payments/${item.id}?seller=${item.seller}`,
		);
		const form = await facts(seller.page, "en", "5.25");
		await form
			.getByLabel(paymentCopy.en.description, { exact: true })
			.fill("Scope A private actual cash fact");
		const path = `**/payments/seller/orders/${item.id}/receipts/`;
		await seller.page.route(path, async (route) => {
			const response = await route.fetch();
			expect(response.status()).toBe(201);
			committed = true;
			await pending;
			await route.fulfill({ response }).catch(() => {});
		});
		await form
			.getByRole("button", { name: paymentCopy.en.exact, exact: true })
			.click();
		await seller.page
			.getByRole("alertdialog")
			.getByRole("button", { name: paymentCopy.en.confirm, exact: true })
			.click();
		await expect.poll(() => committed).toBe(true);
		const reconcile = seller.page.getByRole("button", {
			name: paymentCopy.en.reconcile,
			exact: true,
		});
		await expect(reconcile).toBeEnabled({ timeout: 20000 });
		await selectControl(seller.page, sellerSalesCopy.en.business, other);
		const warning = seller.page
			.getByRole("alert")
			.filter({ hasText: catalogueCopy.en.dirty });
		await expect(warning).toBeVisible();
		await warning
			.getByRole("button", { name: catalogueCopy.en.confirm, exact: true })
			.click();
		await expect(seller.page).toHaveURL(
			new RegExp(`/payments\\?seller=${other}$`),
		);
		release();
		await expect(
			seller.page.getByRole("heading", {
				name: paymentCopy.en.title,
				exact: true,
			}),
		).toBeVisible();
		await expect(seller.page.locator("main")).not.toContainText(item.number);
		await expect(seller.page.locator("main")).not.toContainText(
			"Scope A private actual cash fact",
		);
		const saved = await (
			await seller.page.request.get(
				`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
			)
		).json();
		expect(saved.confirmed_total).toBe("5.25");
		expect(saved.receipts).toHaveLength(1);
		disposablePython(
			`from apps.organizations.models import Membership\nMembership.objects.filter(company_id='${other}',account__user__email='phase12-finance@example.test').update(active=False)`,
		);
		await seller.page
			.getByRole("button", { name: paymentCopy.en.refresh, exact: true })
			.click();
		await expect(seller.page.locator("main").getByRole("alert")).toContainText(
			paymentCopy.en.noAccess,
		);
		await expect(seller.page.locator("main")).not.toContainText(item.number);
		expect(
			await seller.page.evaluate(() =>
				JSON.stringify([localStorage, sessionStorage]),
			),
		).not.toContain("Scope A private actual cash fact");
	} finally {
		release();
		await seller.session.close();
	}
});

for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
	test(`P12 correction target guards preserve dirty facts and evidence: ${locale}`, async ({
		browser,
	}) => {
		const item = order("cod");
		const receipts = JSON.parse(
			disposablePython(
				`import json,sys,uuid
from datetime import timedelta
from django.utils import timezone
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.payments import services
from apps.payments.models import Finance
item=json.load(sys.stdin)
owner=actor(User.objects.get(email='phase12-owner@example.test'),'seller')
ids=[]
for amount in ['2.00','3.00']:
 result=services.mutate(owner,item['id'],'receipt',{'command_id':uuid.uuid4(),'version':Finance.objects.filter(order_id=item['id']).values_list('version',flat=True).first() or 0,'amount':amount,'currency':'AFN','paid_at':timezone.now()-timedelta(hours=1),'description':'Synthetic original receipt '+amount})
 ids.append(result['outcome']['receipt'])
print(json.dumps(ids))`,
				JSON.stringify(item),
			),
		) as string[];
		const seller = await login(browser, "finance");
		try {
			await seller.page.goto(
				`/${locale}/account/seller/payments/${item.id}?seller=${item.seller}`,
			);
			const t = paymentCopy[locale];
			await expect(seller.page.locator("html")).toHaveAttribute(
				"dir",
				locale === "en" ? "ltr" : "rtl",
			);
			const direct = await facts(seller.page, locale, "7.00");
			const directTime = await direct
				.getByLabel(t.paidAt, { exact: true })
				.inputValue();
			const upload = async (form: ReturnType<Page["locator"]>) => {
				const completed = seller.page.waitForResponse(
					(response) =>
						response
							.url()
							.endsWith(`/payments/seller/orders/${item.id}/uploads/`) &&
						response.request().method() === "POST",
				);
				await form.locator("input[type=file]").setInputFiles(syntheticImage());
				const response = await completed;
				expect(response.status()).toBe(201);
				const image = (await response.json()) as { id: string };
				await expect(form).toContainText("(1/3)");
				await expect(form.locator('img[src^="blob:"]')).toBeVisible();
				return {
					id: image.id,
					src: await form.locator('img[src^="blob:"]').getAttribute("src"),
				};
			};
			const firstImage = await upload(direct);
			const receiptPanel = seller.page
				.getByRole("heading", { name: t.receipts, exact: true })
				.locator("..");
			const choose = (amount: string) =>
				receiptPanel
					.locator("article")
					.filter({ hasText: `${amount} AFN` })
					.getByRole("button", { name: t.correction, exact: true });
			const warning = seller.page
				.getByRole("alert")
				.filter({ hasText: catalogueCopy[locale].dirty });
			const cancelDiscard = async () => {
				await expect(warning).toBeVisible();
				await warning
					.getByRole("button", {
						name: catalogueCopy[locale].cancel,
						exact: true,
					})
					.click();
				await expect(warning).toHaveCount(0);
			};
			const confirmDiscard = async () => {
				await expect(warning).toBeVisible();
				await warning
					.getByRole("button", {
						name: catalogueCopy[locale].confirm,
						exact: true,
					})
					.click();
				await expect(warning).toHaveCount(0);
			};
			await choose("2.00").click();
			await cancelDiscard();
			await expect(direct.getByLabel(new RegExp(`^${t.amount}`))).toHaveValue(
				"7.00",
			);
			await expect(direct.getByLabel(t.paidAt, { exact: true })).toHaveValue(
				directTime,
			);
			await expect(
				direct.getByLabel(t.description, { exact: true }),
			).toHaveValue("Synthetic private actual cash receipt");
			await expect(direct.locator('img[src^="blob:"]')).toHaveAttribute(
				"src",
				firstImage.src ?? "",
			);
			await choose("2.00").click();
			await confirmDiscard();
			const correction = seller.page
				.locator("form")
				.filter({
					has: seller.page.getByRole("heading", {
						name: t.correction,
						exact: true,
					}),
				});
			await expect(
				correction.getByLabel(new RegExp(`^${t.amount}`)),
			).toHaveValue("2.00");
			await expect(correction.locator('img[src^="blob:"]')).toHaveCount(0);
			await correction.getByLabel(new RegExp(`^${t.amount}`)).fill("1.00");
			await correction
				.getByLabel(t.description, { exact: true })
				.fill("Synthetic retained correction draft");
			await correction
				.getByLabel(t.reason, { exact: true })
				.fill("Synthetic reason retained after cancelled target switch");
			const correctionTime = await correction
				.getByLabel(t.paidAt, { exact: true })
				.inputValue();
			const secondImage = await upload(correction);
			expect(secondImage.id).not.toBe(firstImage.id);
			await choose("3.00").click();
			await cancelDiscard();
			await expect(
				correction.getByLabel(new RegExp(`^${t.amount}`)),
			).toHaveValue("1.00");
			await expect(
				correction.getByLabel(t.paidAt, { exact: true }),
			).toHaveValue(correctionTime);
			await expect(
				correction.getByLabel(t.description, { exact: true }),
			).toHaveValue("Synthetic retained correction draft");
			await expect(
				correction.getByLabel(t.reason, { exact: true }),
			).toHaveValue("Synthetic reason retained after cancelled target switch");
			await expect(correction.locator('img[src^="blob:"]')).toHaveAttribute(
				"src",
				secondImage.src ?? "",
			);
			await correction
				.getByRole("button", { name: t.exact, exact: true })
				.click();
			await expect(seller.page.getByRole("alertdialog")).toContainText(
				"1.00 AFN",
			);
			await expect(
				seller.page.getByRole("alertdialog").locator('img[src^="blob:"]'),
			).toBeVisible();
			await seller.page.keyboard.press("Escape");
			await expect(
				correction.getByRole("button", { name: t.exact, exact: true }),
			).toBeFocused();
			await seller.page.screenshot({
				path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/payments-draft-guard-${locale}.png`,
				fullPage: true,
			});
			await choose("3.00").click();
			await confirmDiscard();
			await expect(
				correction.getByLabel(new RegExp(`^${t.amount}`)),
			).toHaveValue("3.00");
			await expect(
				correction.getByLabel(t.description, { exact: true }),
			).toHaveValue("Synthetic original receipt 3.00");
			await expect(correction.locator('img[src^="blob:"]')).toHaveCount(0);
			await correction.getByLabel(new RegExp(`^${t.amount}`)).fill("1.50");
			await correction
				.getByLabel(t.reason, { exact: true })
				.fill("Synthetic deliberate second target correction");
			await reviewAndSend(seller.page, correction, locale);
			const current = await (
				await seller.page.request.get(
					`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`,
				)
			).json();
			expect(current.confirmed_total).toBe("5.00");
			expect(current.receipts).toHaveLength(2);
			expect(current.corrections).toHaveLength(1);
			expect(current.corrections[0].receipt).toBe(receipts[1]);
			expect(current.corrections[0].evidence).toEqual([]);
		} finally {
			await seller.session.close();
		}
	});
}
