import { test, expect, type Browser, type Page } from "@playwright/test";
import { apiOrigin, disposablePython, fixturePassword } from "./support/identity-runtime";
import { selectControl } from "./support/seller-controls";
import { sellerSalesCopy } from "../lib/i18n/seller-sales";
import { noOverflow } from "./support/commerce-runtime";
import { privatePost } from "./support/messaging-runtime";
import { aftercareCopy } from "../features/aftercare/copy";
import { aftercareHref } from "../features/aftercare/api";
import { catalogueCopy } from "../lib/i18n/catalogue";
import { communicationCopy } from "../features/messaging/copy";
import type { Locale } from "../lib/i18n/locales";
import type { Context, Detail, Money } from "../features/aftercare/types";

// Transport-loss cases still send to the real API. No financial/stock response is fabricated.
test.skip(process.env.AFTERCARE_BROWSER_TESTS !== "1", "Use the owned Phase 14 MariaDB harness.");
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });
test.beforeEach(() => disposablePython("from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()"));

type Item = { id: string; seller: string; invoice: string; variant: string; number: string };
type Snapshot = {
	counts: Record<string, number>; invoice: unknown; lines: unknown; receipts: unknown;
	stock: { physical: string; held: string; allocation: string | null; movements: number };
	money: Money; cancelled: boolean;
};
const locales = ["fa-AF", "ps", "ar", "en"] as const;
function order(options: { held?: boolean; quantity?: "1.000" | "2.000"; stage?: "accepted" | "dispatched" } = {}): Item {
	const quantity = options.quantity ?? "1.000";
	return JSON.parse(disposablePython(`import json, uuid
from datetime import timedelta
from django.test import override_settings
from django.utils import timezone
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.accounts.models import User
from apps.orders.models import SellerOrder
from apps.payments import services as payments, allocation
from apps.payments.models import Finance
from apps.cart import services as cart
from apps.orders import services as orders
with override_settings(OWNER_MFA_REQUIRED=False):
    value=example_delivery('${options.held ? "advance" : "cod"}',stage='${options.stage ?? "accepted"}')
    buyer=actor(User.objects.get(email='phase12-buyer@example.test'),'buyer')
    seller=actor(User.objects.get(email='phase12-owner@example.test'),'seller')
    if '${quantity}' != '1.000':
        current=cart.buyer(buyer)
        cart.mutate(buyer.request,buyer,{'command_id':uuid.uuid4(),'version':current.version,'action':'set','variant':value['variant'],'tier':'retail','quantity':'${quantity}'})
        current=cart.buyer(buyer)
        result=orders.submit(buyer,{'command_id':uuid.uuid4(),'version':current.version,'currency':'AFN','lines':list(current.lines.filter(variant_id=value['variant']).values_list('pk',flat=True)),'choices':[{'seller':value['seller'],'country':'AF','city':'Kabul','method':'${options.held ? "advance" : "cod"}'}],'shown_prices':[],'locale':'en'})
        o=SellerOrder.objects.get(pk=result['outcomes'][0]['order'])
        value.update(id=str(o.pk),invoice=str(o.invoice.pk),number=o.invoice.number)
    o=SellerOrder.objects.get(pk=value['id'])
    if ${options.held ? "True" : "False"}:
        version=lambda: Finance.objects.filter(order=o).values_list('version',flat=True).first() or 0
        payments.mutate(seller,o.pk,'plan',{'command_id':uuid.uuid4(),'version':version(),'intent_version':0,'reason':'Synthetic aftercare whole hold','lines':[{'variant':value['variant'],'batch':None,'quantity':'${quantity}'}]})
        payments.mutate(seller,o.pk,'receipt',{'command_id':uuid.uuid4(),'version':version(),'amount':format(o.goods_total,'.2f'),'currency':'AFN','paid_at':timezone.now()-timedelta(minutes=2),'description':'Synthetic aftercare actual goods receipt'})
        allocation.execute(o.pk)
print(json.dumps(value))`)) as Item;
}
function snapshot(item: Item): Snapshot {
	return JSON.parse(disposablePython(`import json
from django.db.models import Sum
from apps.orders import models as o, aftercare
from apps.payments import models as p, queries
from apps.fulfilment import models as f
from apps.inventory.models import Bucket,Movement
from apps.notifications.models import Notice
from apps.runtime.models import Job
from apps.notifications.aftercare_events import sweep
sweep()
order=o.SellerOrder.objects.get(pk='${item.id}')
counts={model.__name__:model.objects.filter(order=order).count() for model in [o.Aftercare,o.AftercareCommand,o.AftercareEvent,o.CancellationRequest,o.Amendment,o.InvoiceAdjustment,p.RefundDue,f.Shipment,f.Event,f.Blocker]}
counts['RefundReport']=p.RefundReport.objects.filter(due__order=order).count()
counts['Notice']=Notice.objects.filter(aftercare_order=order).count()
counts['Job']=Job.objects.count()
buckets=Bucket.objects.filter(position__variant_id='${item.variant}')
balances=buckets.aggregate(physical=Sum('physical'),held=Sum('held'))
intent=p.AllocationIntent.objects.filter(order=order).select_related('allocation').first()
print(json.dumps({'counts':counts,'invoice':list(o.Invoice.objects.filter(order=order).values()),'lines':list(order.lines.order_by('pk').values()),'receipts':list(p.Receipt.objects.filter(order=order).order_by('pk').values()),'stock':{'physical':str(balances['physical']),'held':str(balances['held']),'allocation':intent.allocation.state if intent and intent.allocation_id else None,'movements':Movement.objects.filter(bucket__in=buckets).count()},'money':queries.projection(order),'cancelled':aftercare.cancelled(order)},default=str))`)) as Snapshot;
}
function seedCancellation(item: Item, context: Context = "buyer") {
	return JSON.parse(disposablePython(`import json,uuid
from django.test import override_settings
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.orders import cancellations
from apps.orders.models import Aftercare
with override_settings(OWNER_MFA_REQUIRED=False):
    principal=actor(User.objects.get(email='phase12-${context === "buyer" ? "buyer" : "owner"}@example.test'),'${context}')
    result=cancellations.mutate(principal,'${item.id}','request',{'command_id':uuid.uuid4(),'version':Aftercare.objects.filter(order_id='${item.id}').values_list('version',flat=True).first() or 0,'reason':'Synthetic aftercare request ${item.id}'})
print(json.dumps(result))`)) as { request: string; version: number };
}
function decide(item: Item, kind: "cancellation" | "amendment", action: "approve" | "reject") {
	disposablePython(`import uuid
from django.test import override_settings
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.orders import cancellations,amendments
from apps.orders.models import Aftercare,CancellationRequest,Amendment
with override_settings(OWNER_MFA_REQUIRED=False):
    root=actor(User.objects.get(email='phase09-root@example.test'),'owner')
    row=${kind === "cancellation" ? "CancellationRequest" : "Amendment"}.objects.get(order_id='${item.id}',state='pending')
    for action in ['assign','${action}']:
        row.refresh_from_db()
        ${kind === "cancellation" ? "cancellations" : "amendments"}.decide(root,row.pk,{'command_id':uuid.uuid4(),'version':Aftercare.objects.get(order_id='${item.id}').version,'${kind === "cancellation" ? "request" : "amendment"}_version':row.version,'action':action,'assigned_to':root.user.pk,'reason':'Independent synthetic browser review'})`);
}
async function login(browser: Browser, role: "buyer" | "owner" | "finance" | "operations" | "other" = "buyer") {
	const context: Context = role === "buyer" || role === "other" ? "buyer" : "seller";
	const session = await browser.newContext({ offline: false });
	const page = await session.newPage();
	await page.goto(`/en/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(role === "other" ? "phase10-other@example.test" : `phase12-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(new RegExp(`/account/${context}$`));
	return { session, page, context };
}
async function detail(page: Page, item: Item, context: Context = "buyer") {
	const response = await page.request.get(`${apiOrigin}/api/v1/orders/${context}/aftercare/${item.id}/`);
	expect(response.status()).toBe(200);
	return await response.json() as Detail;
}
async function open(page: Page, item: Item, context: Context = "buyer", locale: Locale = "en") {
	const response = await page.goto(aftercareHref(locale, context, item.id, item.seller));
	expect(response?.status()).toBe(200);
	await expect(page.getByText(item.number, { exact: true }).first()).toBeVisible();
}
async function cancellationReview(page: Page, locale: Locale, reason: string) {
	const t = aftercareCopy[locale];
	await selectControl(page, page.url().includes("/account/seller/") ? sellerSalesCopy[locale].actions : t.exact, "cancel");
	await page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill(reason);
	await page.getByRole("button", { name: t.exact, exact: true }).click();
	await expect(page.getByRole("alertdialog")).toBeVisible();
}
async function confirm(page: Page, locale: Locale = "en") {
	const dialog = page.getByRole("alertdialog");
	await dialog.getByRole("button", { name: aftercareCopy[locale].confirm, exact: true }).click();
	await expect(dialog).toHaveCount(0);
}
async function submitCancellation(page: Page, item: Item, context: Context = "buyer") {
	await open(page, item, context);
	await cancellationReview(page, "en", `Browser cancellation ${item.id}`);
	const applied = page.waitForResponse((r) => r.url().endsWith(`/orders/${context}/orders/${item.id}/cancellations/`) && r.request().method() === "POST");
	await confirm(page);
	expect((await applied).status()).toBe(201);
	const data = await detail(page, item, context);
	expect(data.cancellations).toHaveLength(1);
	return data;
}
const cents = (value: string) => BigInt(value.replace(".", ""));

test("P14 actual dispatch removes cancellation eligibility and rejects a forged request", async ({ browser }) => {
	const item = order({ stage: "dispatched" }), buyer = await login(browser);
	try {
		await open(buyer.page, item);
		const data = await detail(buyer.page, item), before = snapshot(item);
		expect(before.counts.Shipment).toBe(1);
		expect(data.capabilities).not.toContain("cancel");
		await expect(buyer.page.locator("option[value=cancel]")).toHaveCount(0);
		const response = await privatePost(buyer.page, `orders/buyer/orders/${item.id}/cancellations/`, { command_id: crypto.randomUUID(), version: data.version, reason: "Forged post-dispatch cancellation" });
		expect(response.status()).toBe(400);
		expect(snapshot(item)).toEqual(before);
	} finally { await buyer.session.close(); }
});
test("P14 operations-only seller cannot use goods refund commands", async ({ browser }) => {
	const item = order(), seller = await login(browser, "operations"), t = aftercareCopy.en;
	try {
		await open(seller.page, item, "seller");
		const data = await detail(seller.page, item, "seller");
		expect(data.capabilities).toContain("amend");
		await seller.page.getByRole("button", { name: t.loadGoods, exact: true }).click();
		const response = await seller.page.request.get(`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`);
		expect(response.status()).toBe(200);
		const payment = await response.json() as { version: number; capabilities: { refund: boolean } };
		expect(payment.capabilities.refund).toBe(false);
		await expect(seller.page.locator("option[value=report], option[value=excess]")).toHaveCount(0);
		const before = snapshot(item);
		const denied = await privatePost(seller.page, `payments/seller/orders/${item.id}/refund-dues/`, { command_id: crypto.randomUUID(), version: payment.version, amount: "1.00", reason: "Out of bundle refund" });
		expect(denied.status()).toBe(404);
		expect(snapshot(item)).toEqual(before);
	} finally { await seller.session.close(); }
});
test("P14 concurrent real request makes the displayed review stale without replacing its fields", async ({ browser }) => {
	const item = order(), seller = await login(browser, "owner"), buyer = await login(browser), t = aftercareCopy.en;
	try {
		await open(seller.page, item, "seller");
		await seller.page.bringToFront();
		const reason = `Seller exact reviewed packet ${item.id}`;
		await cancellationReview(seller.page, "en", reason);
		const data = await detail(buyer.page, item);
		const response = await privatePost(buyer.page, `orders/buyer/orders/${item.id}/cancellations/`, { command_id: crypto.randomUUID(), version: data.version, reason: "Concurrent buyer request" });
		expect(response.status()).toBe(201);
		const dialog = seller.page.getByRole("alertdialog");
		await expect(dialog.getByRole("button", { name: t.confirm, exact: true })).toBeDisabled({ timeout: 30000 });
		await expect(dialog).toContainText(reason);
		await dialog.getByRole("button", { name: t.cancel, exact: true }).click();
		await expect(seller.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true })).toHaveValue(reason);
		const current = await detail(buyer.page, item);
		expect(current.cancellations).toHaveLength(1);
		expect(current.cancellations[0].reason).toBe("Concurrent buyer request");
	} finally { await seller.session.close(); await buyer.session.close(); }
});

for (const locale of locales) {
	for (const context of ["buyer", "seller"] as const) {
		test(`P14 ${locale} ${context}: list and ORDER detail reads are private and side-effect free`, async ({ browser }) => {
			const item = order();
			seedCancellation(item);
			const actor = await login(browser, context === "buyer" ? "buyer" : "owner");
			try {
				const before = snapshot(item), writes: string[] = [];
				actor.page.on("request", (r) => { if (/\/api\/v1\/(orders|payments|fulfilment)\//.test(r.url()) && r.method() !== "GET") writes.push(r.url()); });
				const response = await actor.page.goto(aftercareHref(locale, context, undefined, item.seller));
				expect(response?.status()).toBe(200);
				expect(response?.headers()["cache-control"]).toContain("no-store");
				expect(response?.headers()["x-robots-tag"]).toContain("noindex");
				await expect(actor.page.locator("html")).toHaveAttribute("dir", locale === "en" ? "ltr" : "rtl");
				const link = actor.page.locator(`a[href*="/${context === "buyer" ? "cancellations" : "aftercare"}/${item.id}"]`).first();
				await expect(link).toContainText(item.number);
				await link.click();
				await expect(actor.page.getByText(item.number, { exact: true }).first()).toBeVisible();
				const data = await detail(actor.page, item, context);
				expect(data.id).toBe(item.id);
				expect(data.cancellations[0].id).not.toBe(item.id);
				expect(data.cancellations[0].order).toBe(item.id);
				await actor.page.reload();
				await expect(actor.page.getByText(data.cancellations[0].reason, { exact: true }).first()).toBeVisible();
				expect(snapshot(item)).toEqual(before);
				expect(writes).toEqual([]);
			} finally { await actor.session.close(); }
		});
	}
	for (const [width, theme] of [[1440, "light"], [390, "dark"]] as const) {
		test(`P14 ${locale} ${width} ${theme}: exact review, Escape, focus and real pending request`, async ({ browser }, info) => {
			const item = order(), buyer = await login(browser), t = aftercareCopy[locale];
			try {
				await buyer.page.setViewportSize({ width, height: 1000 });
				await buyer.page.addInitScript((value) => localStorage.setItem("rezayi-theme", value), theme);
				await open(buyer.page, item, "buyer", locale);
				const before = snapshot(item), reason = `Private review ${item.id}`;
				await cancellationReview(buyer.page, locale, reason);
				const dialog = buyer.page.getByRole("alertdialog");
				await expect(dialog).toContainText(reason);
				await expect(dialog).toContainText(item.number);
				expect(snapshot(item)).toEqual(before);
				await buyer.page.keyboard.press("Escape");
				await expect(buyer.page.getByRole("button", { name: t.exact, exact: true })).toBeFocused();
				await expect(buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true })).toHaveValue(reason);
				await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
				const applied = buyer.page.waitForResponse((r) => r.url().endsWith(`/orders/buyer/orders/${item.id}/cancellations/`) && r.request().method() === "POST");
				await confirm(buyer.page, locale);
				expect((await applied).status()).toBe(201);
				const data = await detail(buyer.page, item);
				expect(data.cancellations.map((r) => ({ reason: r.reason, state: r.state }))).toEqual([{ reason, state: "pending" }]);
				const after = snapshot(item);
				expect(after.counts.CancellationRequest).toBe(before.counts.CancellationRequest + 1);
				expect(after.counts.Blocker).toBe(before.counts.Blocker + 1);
				expect(after.stock).toEqual(before.stock);
				expect(after.receipts).toEqual(before.receipts);
				expect(after.money.received).toBe(before.money.received);
				await expect(buyer.page.locator("html")).toHaveAttribute("dir", locale === "en" ? "ltr" : "rtl");
				await noOverflow(buyer.page);
				const storage = await buyer.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
				expect(storage).not.toContain(reason);
				expect(buyer.page.url()).not.toContain(encodeURIComponent(reason));
				await buyer.page.screenshot({ path: info.outputPath(`aftercare-${locale}-${width}.png`), fullPage: true });
			} finally { await buyer.session.close(); }
		});
	}
}

for (const context of ["buyer", "seller"] as const) {
	for (const screen of ["orders", "invoices", "payments", "delivery"] as const) {
		test(`P14 ${context} ${screen}: embedded aftercare uses the order id with one shell`, async ({ browser }) => {
			const item = order(), actor = await login(browser, context === "buyer" ? "buyer" : "owner");
			try {
				const route = screen === "delivery" ? context === "buyer" ? "deliveries" : "fulfilment" : screen;
				await actor.page.goto(`/en/account/${context}/${route}/${screen === "invoices" ? item.invoice : item.id}${context === "seller" ? `?seller=${item.seller}` : ""}`);
				const link = actor.page.locator(`main a[href="${aftercareHref("en", context, item.id, item.seller)}"]`);
				await expect(link).toHaveAttribute("href", aftercareHref("en", context, item.id, item.seller));
				await expect(actor.page.locator("main")).toHaveCount(1);
				const before = snapshot(item);
				await link.click();
				await expect(actor.page).toHaveURL(new RegExp(`/${context === "buyer" ? "cancellations" : "aftercare"}/${item.id}`));
				await expect(actor.page.getByText(item.number, { exact: true }).first()).toBeVisible();
				expect(snapshot(item)).toEqual(before);
			} finally { await actor.session.close(); }
		});
	}
}
for (const path of [
	"buyer/cancellations/not-a-uuid", "seller/aftercare/new", "buyer/aftercare", "seller/cancellations",
	"buyer/cancellations/00000000-0000-4000-8000-000000000014/approve", "staff/aftercare",
]) {
	test(`P14 unknown or wrong-context route is 404: ${path}`, async ({ page }) => {
		const response = await page.goto(`/en/account/${path}`);
		expect(response?.status()).toBe(404);
		expect(response?.headers()["x-robots-tag"]).toContain("noindex");
		await expect(page.getByRole("combobox", { name: aftercareCopy.en.exact, exact: true })).toHaveCount(0);
	});
}
test("P14 buyer session cannot acquire seller amendment or refund authority", async ({ browser }) => {
	const item = order(), buyer = await login(browser);
	try {
		const before = snapshot(item);
		for (const path of [`orders/seller/aftercare/${item.id}/`, `payments/seller/orders/${item.id}/`])
			expect([401, 403, 404]).toContain((await buyer.page.request.get(`${apiOrigin}/api/v1/${path}`)).status());
		const response = await privatePost(buyer.page, `orders/seller/orders/${item.id}/amendments/`, { command_id: crypto.randomUUID(), version: 0, reason: "Forged seller action", lines: [] });
		expect([401, 403, 404]).toContain(response.status());
		await open(buyer.page, item);
		const data = await detail(buyer.page, item);
		expect(data.capabilities).not.toContain("amend");
		await expect(buyer.page.locator("option[value=amend]")).toHaveCount(0);
		expect(snapshot(item)).toEqual(before);
	} finally { await buyer.session.close(); }
});
test("P14 finance-only seller may read aftercare but cannot request cancellation or amendment", async ({ browser }) => {
	const item = order(), finance = await login(browser, "finance");
	try {
		await open(finance.page, item, "seller");
		const data = await detail(finance.page, item, "seller");
		expect(data.capabilities).not.toContain("cancel");
		expect(data.capabilities).not.toContain("amend");
		await expect(finance.page.locator("option[value=cancel], option[value=amend]")).toHaveCount(0);
		const before = snapshot(item);
		const result = await privatePost(finance.page, `orders/seller/orders/${item.id}/cancellations/`, { command_id: crypto.randomUUID(), version: data.version, reason: "Out of bundle request" });
		expect([403, 404]).toContain(result.status());
		expect(snapshot(item)).toEqual(before);
	} finally { await finance.session.close(); }
});
test("P14 unrelated buyer cannot enumerate order, cancellation or financial detail", async ({ browser }) => {
	const item = order(), request = seedCancellation(item), other = await login(browser, "other");
	try {
		const before = snapshot(item);
		for (const path of [`orders/buyer/aftercare/${item.id}/`, `orders/buyer/cancellations/${request.request}/`, `payments/buyer/orders/${item.id}/`])
			expect((await other.page.request.get(`${apiOrigin}/api/v1/${path}`)).status()).toBe(404);
		await other.page.goto(aftercareHref("en", "buyer", item.id));
		await expect(other.page.getByRole("alert")).toBeVisible();
		await expect(other.page.getByText(item.number, { exact: true })).toHaveCount(0);
		expect(snapshot(item)).toEqual(before);
	} finally { await other.session.close(); }
});
test("P14 dirty navigation keeps fields and does not create a cancellation when cancelled", async ({ browser }) => {
	const item = order(), buyer = await login(browser), t = aftercareCopy.en;
	try {
		await open(buyer.page, item);
		const before = snapshot(item), reason = `Unsaved private reason ${item.id}`;
		await buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill(reason);
		await buyer.page.locator('main a[href="/en/account/buyer/cancellations"]').click();
		const warning = buyer.page.getByRole("alert").filter({ has: buyer.page.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }) });
		await expect(warning).toBeVisible();
		await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
		await expect(buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true })).toHaveValue(reason);
		expect(buyer.page.url()).toContain(item.id);
		expect(snapshot(item)).toEqual(before);
	} finally { await buyer.session.close(); }
});
for (const applied of [true, false]) {
	test(`P14 lost acknowledgement reconciles ${applied ? "applied once" : "absence and retained fields"}`, async ({ browser }) => {
		const item = order(), buyer = await login(browser), t = aftercareCopy.en;
		try {
			await open(buyer.page, item);
			const before = snapshot(item), reason = `Uncertain packet ${item.id}`;
			let sent = 0;
			const path = `**/api/v1/orders/buyer/orders/${item.id}/cancellations/`;
			await buyer.page.route(path, async (route) => {
				sent++;
				if (applied) await route.fetch();
				await route.abort("failed");
			});
			await cancellationReview(buyer.page, "en", reason);
			await confirm(buyer.page);
			const reconcile = buyer.page.getByRole("button", { name: t.reconcile, exact: true });
			await expect(reconcile).toBeVisible();
			const reference = new URL(buyer.page.url()).searchParams.get("aftercare_attempt");
			expect(reference).toMatch(/^[0-9a-f-]{36}$/i);
			await reconcile.click();
			await expect(reconcile).toHaveCount(0);
			expect(sent).toBe(1);
			const after = snapshot(item);
			expect(after.counts.CancellationRequest).toBe(before.counts.CancellationRequest + (applied ? 1 : 0));
			expect(after.stock).toEqual(before.stock);
			if (applied) {
				const data = await detail(buyer.page, item);
				expect(data.cancellations[0].reason).toBe(reason);
			} else {
				await expect(buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true })).toHaveValue(reason);
				await buyer.page.unroute(path);
				await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
				const response = buyer.page.waitForResponse((r) => r.url().endsWith(`/orders/${item.id}/cancellations/`) && r.request().method() === "POST");
				await confirm(buyer.page);
				expect((await response).status()).toBe(201);
				expect((await detail(buyer.page, item)).cancellations).toHaveLength(1);
			}
		} finally { await buyer.session.close(); }
	});
}
test("P14 withdrawal retains request history without inventing a staff approval or refund", async ({ browser }) => {
	const item = order(), buyer = await login(browser), t = aftercareCopy.en;
	try {
		const data = await submitCancellation(buyer.page, item), before = snapshot(item);
		await buyer.page.reload();
		await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("cancel_withdraw");
		await buyer.page.getByRole("combobox", { name: t.target, exact: true }).selectOption(data.cancellations[0].id);
		await buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill("Buyer withdraws own synthetic request");
		await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
		const response = buyer.page.waitForResponse((r) => r.url().endsWith(`/cancellations/${data.cancellations[0].id}/withdraw/`) && r.request().method() === "POST");
		await confirm(buyer.page);
		expect((await response).status()).toBe(200);
		const current = await detail(buyer.page, item);
		expect(current.cancellations[0].id).toBe(data.cancellations[0].id);
		expect(current.cancellations[0].state).toBe("withdrawn");
		const after = snapshot(item);
		expect(after.counts.CancellationRequest).toBe(before.counts.CancellationRequest);
		expect(after.counts.InvoiceAdjustment).toBe(0);
		expect(after.money.refund_due).toBe(before.money.refund_due);
		expect(after.stock).toEqual(before.stock);
	} finally { await buyer.session.close(); }
});
for (const action of ["approve", "reject"] as const) {
	test(`P14 staff ${action}: actual held stock, refund due and immutable original invoice`, async ({ browser }) => {
		const item = order({ held: true }), buyer = await login(browser);
		try {
			const before = snapshot(item);
			expect(before.stock.allocation).toBe("held");
			const printUrl = `${apiOrigin}/api/v1/orders/buyer/invoices/${item.invoice}/print/?locale=en`;
			const printBefore = await buyer.page.request.get(printUrl);
			expect(printBefore.status()).toBe(200);
			const bytes = await printBefore.body();
			await submitCancellation(buyer.page, item);
			decide(item, "cancellation", action);
			await buyer.page.reload();
			const data = await detail(buyer.page, item), after = snapshot(item);
			expect(data.cancellations[0].state).toBe(action === "approve" ? "approved" : "rejected");
			expect(after.invoice).toEqual(before.invoice);
			expect(after.lines).toEqual(before.lines);
			expect(after.receipts).toEqual(before.receipts);
			expect(after.money.received).toBe(before.money.received);
			expect(after.money.refunded).toBe(before.money.refunded);
			expect(after.stock.physical).toBe(before.stock.physical);
			if (action === "approve") {
				expect(after.stock.allocation).toBe("released");
				expect(cents(before.stock.held) - cents(after.stock.held)).toBe(BigInt(1000));
				expect(after.counts.InvoiceAdjustment).toBe(1);
				expect(after.money.refund_due).toBe(before.money.received);
				expect(after.cancelled).toBe(true);
				await expect(buyer.page.locator("option[value=cancel]")).toHaveCount(0);
			} else {
				expect(after.stock).toEqual(before.stock);
				expect(after.money.refund_due).toBe(before.money.refund_due);
				expect(after.counts.InvoiceAdjustment).toBe(0);
			}
			const printAfter = await buyer.page.request.get(printUrl);
			expect(printAfter.status()).toBe(200);
			expect(await printAfter.body()).toEqual(bytes);
			// PDF creation metadata is regenerated; byte stability is asserted on
			// the retained print document, not falsely on volatile PDF metadata.
			const pdf = await buyer.page.request.get(`${apiOrigin}/api/v1/orders/buyer/invoices/${item.invoice}/pdf/?locale=en`);
			expect(pdf.status()).toBe(200);
			expect(pdf.headers()["content-type"]).toContain("application/pdf");
			expect((await pdf.body()).byteLength).toBeGreaterThan(1000);
		} finally { await buyer.session.close(); }
	});
}
test("P14 accepted decrease releases only reduced held stock and preserves original accepted lines", async ({ browser }) => {
	const item = order({ held: true, quantity: "2.000" }), seller = await login(browser, "owner"), t = aftercareCopy.en;
	try {
		await open(seller.page, item, "seller");
		const before = snapshot(item), data = await detail(seller.page, item, "seller");
		await selectControl(seller.page, sellerSalesCopy.en.actions, "amend");
		await seller.page.getByLabel(t.selected, { exact: true }).first().check();
		await seller.page.getByRole("form", { name: t.exact, exact: true }).getByLabel(new RegExp(`^${t.quantity}(?: [(]|$)`)).fill("1.000");
		await seller.page.getByLabel(`${t.unitPrice} (${data.currency})`, { exact: true }).fill(data.effective_lines[0].unit_price);
		await seller.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill("Reduce one whole accepted unit");
		await seller.page.getByRole("button", { name: t.exact, exact: true }).click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(data.effective_lines[0].quantity);
		const proposed = seller.page.waitForResponse((r) => r.url().endsWith(`/orders/${item.id}/amendments/`) && r.request().method() === "POST");
		await confirm(seller.page);
		expect((await proposed).status()).toBe(201);
		expect(snapshot(item).stock).toEqual(before.stock);
		decide(item, "amendment", "approve");
		const current = await detail(seller.page, item, "seller"), after = snapshot(item);
		expect(current.effective_lines[0].quantity).toBe("1.000");
		expect(current.accepted_total).toBe(data.effective_lines[0].unit_price);
		expect(after.lines).toEqual(before.lines);
		expect(after.invoice).toEqual(before.invoice);
		expect(after.receipts).toEqual(before.receipts);
		expect(after.stock.physical).toBe(before.stock.physical);
		expect(cents(before.stock.held) - cents(after.stock.held)).toBe(BigInt(1000));
		expect(after.stock.allocation).toBe("held");
		expect(cents(after.money.refund_due)).toBe(cents(before.money.received) - cents(current.accepted_total));
		await seller.page.reload();
		await expect(seller.page.getByRole("heading", { name: t.adjustments, exact: true })).toBeVisible();
	} finally { await seller.session.close(); }
});
test("P14 seller refund report records an actual refund claim without confirming or changing receipts", async ({ browser }) => {
	const item = order({ held: true });
	seedCancellation(item);
	decide(item, "cancellation", "approve");
	const seller = await login(browser, "owner"), t = aftercareCopy.en;
	try {
		await open(seller.page, item, "seller");
		await seller.page.getByRole("button", { name: t.loadGoods, exact: true }).click();
		const response = await seller.page.request.get(`${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`);
		expect(response.status()).toBe(200);
		const data = await response.json() as { refund_dues: { id: string; amount: string }[] };
		const due = data.refund_dues[0], before = snapshot(item), reference = `REFUND-${item.id}`;
		expect(due.amount).toBe(before.money.refund_due);
		await selectControl(seller.page, sellerSalesCopy.en.actions, "report");
		await selectControl(seller.page, t.target, due.id);
		await seller.page.locator('input[type="datetime-local"]').fill("2020-01-01T10:00");
		await seller.page.getByLabel(t.reference, { exact: true }).fill(reference);
		await seller.page.getByRole("textbox", { name: t.description, exact: true }).fill("Synthetic actual sent refund; independent review required");
		await seller.page.getByRole("button", { name: t.exact, exact: true }).click();
		await expect(seller.page.getByRole("alertdialog")).toContainText(due.amount);
		await expect(seller.page.getByRole("alertdialog")).toContainText(reference);
		const sent = seller.page.waitForResponse((r) => r.url().endsWith(`/orders/${item.id}/refund-reports/`) && r.request().method() === "POST");
		await confirm(seller.page);
		expect((await sent).status()).toBe(201);
		const after = snapshot(item);
		expect(after.counts.RefundReport).toBe(before.counts.RefundReport + 1);
		expect(after.money.refunded).toBe(before.money.refunded);
		expect(after.money.refund_due).toBe(before.money.refund_due);
		expect(after.receipts).toEqual(before.receipts);
		expect(after.stock).toEqual(before.stock);
	} finally { await seller.session.close(); }
});
test("P14 four-locale generic notices link to ORDER aftercare, not request identity or private facts", async ({ browser }) => {
	const item = order(), request = seedCancellation(item, "seller");
	disposablePython(`from apps.notifications.aftercare_events import fanout
from apps.notifications.models import AftercareNoticeCursor
for pk in AftercareNoticeCursor.objects.filter(event__aftercare_event__order_id='${item.id}',complete=False).values_list('pk',flat=True):
    fanout(pk)`);
	const buyer = await login(browser);
	try {
		for (const locale of locales) {
			await buyer.page.goto(`/${locale}/account/buyer/notifications`);
			const link = buyer.page.locator(`a[href="${aftercareHref(locale, "buyer", item.id)}"]`).first();
			await expect(link).toBeVisible();
			await expect(link).toContainText(aftercareCopy[locale].title);
			await expect(link).not.toContainText(`Synthetic aftercare request ${item.id}`);
			await expect(link).not.toHaveAttribute("href", new RegExp(request.request));
			await link.click();
			await expect(buyer.page.getByText(item.number, { exact: true }).first()).toBeVisible();
		}
	} finally { await buyer.session.close(); }
});
for (const context of ["buyer", "seller"] as const) {
	test(`P14 ${context}: aftercare email preference saves independently and survives reload`, async ({ browser }) => {
		const actor = await login(browser, context === "buyer" ? "buyer" : "owner");
		try {
			const path = `notifications/${context}/preferences/`;
			const get = () => actor.page.request.get(`${apiOrigin}/api/v1/${path}`);
			const originalResponse = await get();
			expect(originalResponse.status()).toBe(200);
			const original = await originalResponse.json() as { aftercare_email: boolean; message_email: boolean; payment_email: boolean; version: number; locale: string };
			try {
				await actor.page.goto(`/en/account/${context}/settings`);
				const input = actor.page.getByLabel(aftercareCopy.en.email, { exact: true });
				await input.setChecked(!original.aftercare_email);
				const saved = actor.page.waitForResponse((r) => r.url().endsWith(`/${path}`) && r.request().method() === "PATCH");
				await actor.page.getByRole("button", { name: communicationCopy.en.savePreference, exact: true }).click();
				expect((await saved).status()).toBe(200);
				const current = await (await get()).json();
				expect(current.aftercare_email).toBe(!original.aftercare_email);
				expect(current.message_email).toBe(original.message_email);
				expect(current.payment_email).toBe(original.payment_email);
				expect(current.version).toBe(original.version + 1);
				await actor.page.reload();
				await expect(input).toBeChecked({ checked: !original.aftercare_email });
			} finally {
				const current = await (await get()).json();
				const restored = await privatePost(actor.page, path, { message_email: original.message_email, payment_email: original.payment_email, aftercare_email: original.aftercare_email, locale: original.locale, version: current.version }, "PATCH");
				expect(restored.status()).toBe(200);
			}
		} finally { await actor.session.close(); }
	});
}
