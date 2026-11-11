import { test, expect, type Browser, type Page } from "@playwright/test";
import { apiOrigin, disposablePython, fixturePassword } from "./support/identity-runtime";
import { privatePost, syntheticImage } from "./support/messaging-runtime";
import { noOverflow } from "./support/commerce-runtime";
import { aftercareHref, disputeHref } from "../features/aftercare/api";
import { aftercareCopy } from "../features/aftercare/copy";
import { communicationCopy } from "../features/messaging/copy";
import { catalogueCopy } from "../lib/i18n/catalogue";
import { messages } from "../lib/i18n/messages";
import { storefrontCopy } from "../features/storefront/copy";
import { sellerSalesCopy } from "../lib/i18n/seller-sales";
import type { Locale } from "../lib/i18n/locales";
import type { Context, Detail, DisputeDetail } from "../features/aftercare/types";

// Only the maintained disposable native v5 harness is permitted. Lost-response
// interception forwards to the real API; it never fabricates a domain response.
test.skip(process.env.DISPUTES_BROWSER_TESTS !== "1", "Use the owned Phase 15 MariaDB harness and sealed dispute examples.");
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });
test.beforeEach(() => disposablePython("from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()"));
const locales = ["fa-AF", "ps", "ar", "en"] as const;
type Item = { id: string; seller: string; invoice: string; number: string };
type Case = Item & { dispute: string; evidence: string; state: string; refund_due: string | null };
type Fixtures = {
	run_id: string; native_schema_version: number; product: string; store: string;
	orders: Record<string, Item>; disputes: Record<string, Case>;
	reviews: Record<string, Item & { review: string; state: string }>;
	reports: Record<string, { id: string; target: string; state: string }>;
	public_summary: { count: number; average: string | null };
};
function fixtures(): Fixtures {
	const value = JSON.parse(disposablePython(`import json
from apps.orders.management.commands.seed_dispute_examples import owned_storage, MANIFEST_FILENAME
from config.testing import run_id
value=json.loads((owned_storage()/MANIFEST_FILENAME).read_text())
assert value['run_id']==run_id() and value['native_schema_version']==5
print(json.dumps(value))`)) as Fixtures;
	expect(value.run_id).toBe(process.env.REZAYI_TEST_RUN_ID);
	return value;
}
function fresh(completed = false): Item {
	return JSON.parse(disposablePython(`import json
from django.test import override_settings
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.orders.management.commands.seed_dispute_examples import owned_storage, delivered_order, order_record
owned_storage()
with override_settings(OWNER_MFA_REQUIRED=False):
    seller=actor(User.objects.get(email='phase12-owner@example.test'),'seller')
    order=delivered_order(seller,paid=${completed ? "True" : "False"})
    value=order_record(order)
print(json.dumps(value))`)) as Item;
}
function snapshot(item: Item) {
	return JSON.parse(disposablePython(`import json
from apps.orders import models as o
from apps.payments import models as p, queries
from apps.fulfilment import models as f
order=o.SellerOrder.objects.get(pk='${item.id}')
value={'invoice':list(o.Invoice.objects.filter(order=order).values()),'lines':list(order.lines.order_by('pk').values()),'completion':list(f.Completion.objects.filter(order=order).values()),'receipts':list(p.Receipt.objects.filter(order=order).order_by('pk').values()),'money':queries.projection(order),'disputes':list(order.disputes.order_by('pk').values('id','state','reason')),'reviews':list(o.Review.objects.filter(order=order).values('order_id','state','rating','text','language')),'commands':o.AftercareCommand.objects.filter(order=order).count(),'blockers':f.Blocker.objects.filter(order=order,kind='dispute').count()}
print(json.dumps(value,default=str))`)) as { invoice: unknown; lines: unknown; completion: unknown[]; receipts: unknown; money: { received: string; refunded: string; refund_due: string }; disputes: { id: string; state: string; reason: string }[]; reviews: { order_id: string; state: string; rating: number; text: string; language: string }[]; commands: number; blockers: number };
}
async function login(browser: Browser, role: "buyer" | "seller" | "other" | "operations" = "buyer") {
	const context: Context = role === "seller" || role === "operations" ? "seller" : "buyer";
	const session = await browser.newContext({ offline: false });
	const page = await session.newPage();
	await page.goto(`/en/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(role === "other" ? "phase10-other@example.test" : `phase12-${role === "seller" ? "owner" : role === "operations" ? "operations" : "buyer"}@example.test`);
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
	await page.goto(aftercareHref(locale, context, item.id, item.seller));
	await expect(page.getByText(item.number, { exact: true }).first()).toBeVisible();
}
async function reviewDispute(page: Page, reason: string, locale: Locale = "en") {
	const t = aftercareCopy[locale];
	await page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("dispute_open");
	await page.getByRole("textbox", { name: t.disputeReason, exact: true }).fill(reason);
	await page.getByRole("button", { name: t.exact, exact: true }).click();
	await expect(page.getByRole("alertdialog")).toContainText(reason);
}
async function confirm(page: Page, locale: Locale = "en") {
	await page.getByRole("alertdialog").getByRole("button", { name: aftercareCopy[locale].confirm, exact: true }).click();
}
async function submitDispute(page: Page, item: Item) {
	await open(page, item);
	await reviewDispute(page, `Synthetic browser dispute ${item.id}`);
	const response = page.waitForResponse((value) => value.request().method() === "POST" && value.url().endsWith(`/orders/buyer/orders/${item.id}/disputes/`));
	await confirm(page);
	expect((await response).status()).toBe(201);
	const data = await detail(page, item);
	expect(data.disputes).toHaveLength(1);
	return data.disputes?.[0].id as string;
}

for (const locale of locales) {
	for (const context of ["buyer", "seller"] as const) {
		test(`P15 ${locale} ${context}: real list and DISPUTE detail are private, read-only and correctly linked`, async ({ browser }) => {
			const item = fixtures().disputes.pending, actor = await login(browser, context);
			try {
				const before = snapshot(item), writes: string[] = [];
				actor.page.on("request", (request) => { if (/\/api\/v1\/(orders|payments|fulfilment|messaging)\//.test(request.url()) && request.method() !== "GET") writes.push(request.url()); });
				const response = await actor.page.goto(disputeHref(locale, context, undefined, item.seller));
				expect(response?.status()).toBe(200);
				expect(response?.headers()["cache-control"]).toContain("no-store");
				expect(response?.headers()["x-robots-tag"]).toContain("noindex");
				const link = actor.page.locator(`a[href="${disputeHref(locale, context, item.dispute, item.seller)}"]`).first();
				await expect(link).toBeVisible();
				await link.click();
				await expect(actor.page.getByText(item.number, { exact: true }).first()).toBeVisible();
				const read = await actor.page.request.get(`${apiOrigin}/api/v1/orders/${context}/disputes/${item.dispute}/`);
				expect(read.status()).toBe(200);
				const data = await read.json() as DisputeDetail;
				expect(data.id).toBe(item.dispute);
				expect(data.order_detail.id).toBe(item.id);
				expect(data.id).not.toBe(item.id);
				await expect(actor.page.getByText(data.reason, { exact: true }).first()).toBeVisible();
				await expect(actor.page.locator("html")).toHaveAttribute("dir", locale === "en" ? "ltr" : "rtl");
				expect(snapshot(item)).toEqual(before);
				expect(writes).toEqual([]);
			} finally { await actor.session.close(); }
		});
	}
	test(`P15 ${locale}: exact open, Escape/focus, withdrawal and unchanged completion/money`, async ({ browser }) => {
		const item = fresh(true), buyer = await login(browser), t = aftercareCopy[locale];
		try {
			await buyer.page.setViewportSize({ width: locale === "en" ? 1440 : 390, height: 1000 });
			if (locale !== "en") await buyer.page.addInitScript(() => localStorage.setItem("rezayi-theme", "dark"));
			await open(buyer.page, item, "buyer", locale);
			const before = snapshot(item), reason = `Exact private dispute ${item.id}`;
			expect(before.completion).toHaveLength(1);
			await reviewDispute(buyer.page, reason, locale);
			expect(snapshot(item)).toEqual(before);
			await buyer.page.keyboard.press("Escape");
			await expect(buyer.page.getByRole("button", { name: t.exact, exact: true })).toBeFocused();
			await expect(buyer.page.getByRole("textbox", { name: t.disputeReason, exact: true })).toHaveValue(reason);
			await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
			const sent = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/orders/${item.id}/disputes/`));
			await confirm(buyer.page, locale);
			expect((await sent).status()).toBe(201);
			const current = await detail(buyer.page, item), dispute = current.disputes?.[0];
			expect(dispute?.state).toBe("pending");
			expect(dispute?.reason).toBe(reason);
			await buyer.page.goto(disputeHref(locale, "buyer", dispute?.id));
			await expect(buyer.page.locator("option[value=dispute_withdraw]")).toHaveCount(1);
			await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("dispute_withdraw");
			await buyer.page.getByRole("combobox", { name: t.target, exact: true }).selectOption(dispute?.id as string);
			await buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill("Withdraw own exact synthetic dispute");
			await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
			const withdrawn = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/disputes/${dispute?.id}/withdraw/`));
			await confirm(buyer.page, locale);
			expect((await withdrawn).status()).toBe(200);
			expect((await detail(buyer.page, item)).disputes?.[0].state).toBe("withdrawn");
			const after = snapshot(item);
			expect(after.completion).toEqual(before.completion);
			expect(after.invoice).toEqual(before.invoice);
			expect(after.lines).toEqual(before.lines);
			expect(after.receipts).toEqual(before.receipts);
			expect(after.money).toEqual(before.money);
			expect(after.blockers).toBe(before.blockers + 1);
			await noOverflow(buyer.page);
			const stored = await buyer.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
			expect(stored).not.toContain(reason);
			expect(buyer.page.url()).not.toContain(encodeURIComponent(reason));
		} finally { await buyer.session.close(); }
	});
	test(`P15 ${locale}: integer review/current language remains private, then exact own withdrawal`, async ({ browser }) => {
		const item = fresh(true), buyer = await login(browser), t = aftercareCopy[locale];
		try {
			await open(buyer.page, item, "buyer", locale);
			const before = snapshot(item), text = `Seller experience • ${locale} • ${item.id}`;
			await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("review_submit");
			await expect(buyer.page.getByRole("combobox", { name: t.exact, exact: true })).toHaveValue("review_submit");
			await buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("combobox", { name: t.reviewRating, exact: true }).selectOption("4");
			await buyer.page.getByRole("textbox", { name: t.reviewText, exact: true }).fill(text);
			await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
			await expect(buyer.page.getByRole("alertdialog")).toContainText(text);
			const sent = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/orders/${item.id}/reviews/`));
			await confirm(buyer.page, locale);
			expect((await sent).status()).toBe(201);
			const review = (await detail(buyer.page, item)).review;
			expect(review).toMatchObject({ rating: 4, text, language: locale, state: "pending", can_withdraw: true });
			await buyer.page.reload();
			await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("review_withdraw");
			await buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill("Withdraw pending seller experience review");
			await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
			await expect(buyer.page.getByRole("alertdialog")).toContainText(text);
			const withdrawn = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/reviews/${review?.id}/withdraw/`));
			await confirm(buyer.page, locale);
			expect((await withdrawn).status()).toBe(200);
			expect((await detail(buyer.page, item)).review?.state).toBe("withdrawn");
			const after = snapshot(item);
			expect(after.completion).toEqual(before.completion);
			expect(after.money).toEqual(before.money);
			expect(after.invoice).toEqual(before.invoice);
		} finally { await buyer.session.close(); }
	});
}

test("P15 accepted-only and delivered-unpaid deny ineligible actions without side effects", async ({ browser }) => {
	const values = fixtures(), buyer = await login(browser);
	try {
		for (const [item, action] of [[values.orders.accepted, "disputes"], [values.orders.delivered, "reviews"]] as const) {
			const before = snapshot(item), data = await detail(buyer.page, item);
			expect(data.capabilities).not.toContain(action === "disputes" ? "dispute_open" : "review_submit");
			const response = await privatePost(buyer.page, `orders/buyer/orders/${item.id}/${action}/`, { command_id: crypto.randomUUID(), version: data.version, ...(action === "disputes" ? { reason: "Forged early dispute", evidence: [] } : { rating: 4, text: "Forged early review", language: "en" }) });
			expect(response.status()).toBe(400);
			expect(snapshot(item)).toEqual(before);
		}
	} finally { await buyer.session.close(); }
});
test("P15 unrelated buyer cannot enumerate dispute detail or private evidence", async ({ browser }) => {
	const item = fixtures().disputes.pending, other = await login(browser, "other");
	try {
		const before = snapshot(item);
		for (const path of [`orders/buyer/disputes/${item.dispute}/`, `orders/buyer/aftercare/${item.id}/`, `payments/buyer/evidence/${item.evidence}/`]) expect((await other.page.request.get(`${apiOrigin}/api/v1/${path}`)).status()).toBe(404);
		await other.page.goto(disputeHref("en", "buyer", item.dispute));
		await expect(other.page.getByRole("alert")).toBeVisible();
		await expect(other.page.getByText(item.number, { exact: true })).toHaveCount(0);
		expect(snapshot(item)).toEqual(before);
	} finally { await other.session.close(); }
});
test("P15 seller response uses the selected dispute id and removes only response eligibility", async ({ browser }) => {
	const item = fresh(), buyer = await login(browser), seller = await login(browser, "seller"), t = aftercareCopy.en;
	try {
		const dispute = await submitDispute(buyer.page, item), before = snapshot(item), text = `Exact seller response ${dispute}`;
		await seller.page.goto(disputeHref("en", "seller", dispute, item.seller));
		await seller.page.getByRole("combobox", { name: sellerSalesCopy.en.actions, exact: true }).click();
		await seller.page.locator('[role="option"][value="dispute_respond"]').click();
		await seller.page.getByRole("combobox", { name: t.target, exact: true }).click();
		await seller.page.locator(`[role="option"][value="${dispute}"]`).click();
		await seller.page.getByRole("textbox", { name: t.disputeResponse, exact: true }).fill(text);
		await seller.page.getByRole("button", { name: t.exact, exact: true }).click();
		const response = seller.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/disputes/${dispute}/respond/`));
		await confirm(seller.page);
		expect((await response).status()).toBe(200);
		const data = await detail(seller.page, item, "seller");
		expect(data.disputes?.[0].response?.text).toBe(text);
		expect(data.disputes?.[0].can_respond).toBe(false);
		expect(snapshot(item).money).toEqual(before.money);
		expect(snapshot(item).completion).toEqual(before.completion);
	} finally { await buyer.session.close(); await seller.session.close(); }
});
test("P15 old dispute detail retains the complete collection after opening a new pending case", async ({ browser }) => {
	const item = fresh(true), buyer = await login(browser), t = aftercareCopy.en;
	try {
		const oldReason = `Historical withdrawn case ${item.id}`, reason = `New pending case ${item.id}`;
		const opened = await privatePost(buyer.page, `orders/buyer/orders/${item.id}/disputes/`, { command_id: crypto.randomUUID(), version: (await detail(buyer.page, item)).version, reason: oldReason, evidence: [] });
		expect(opened.status()).toBe(201);
		const old = (await opened.json()).outcome.dispute as string;
		const withdrawn = await privatePost(buyer.page, `orders/buyer/disputes/${old}/withdraw/`, { command_id: crypto.randomUUID(), version: (await detail(buyer.page, item)).version, dispute: old, reason: "Close the owned historical case" });
		expect(withdrawn.status()).toBe(200);
		expect((await detail(buyer.page, item)).disputes).toEqual([expect.objectContaining({ id: old, state: "withdrawn", can_withdraw: false })]);
		const before = snapshot(item), href = disputeHref("en", "buyer", old, item.seller);
		await buyer.page.goto(href);
		await expect(buyer.page.getByText(oldReason, { exact: true })).toBeVisible();
		await reviewDispute(buyer.page, reason);
		const sent = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/orders/buyer/orders/${item.id}/disputes/`));
		await confirm(buyer.page);
		const response = await sent;
		expect(response.status()).toBe(201);
		const pending = (await response.json()).outcome.dispute as string;
		expect(pending).not.toBe(old);
		const read = await buyer.page.request.get(`${apiOrigin}/api/v1/orders/buyer/disputes/${old}/`);
		expect(read.status()).toBe(200);
		const data = await read.json() as DisputeDetail;
		expect(data).toMatchObject({ id: old, state: "withdrawn", order_detail: { id: item.id, aftercare: { pending_dispute: true } } });
		expect(data.order_detail.disputes).toHaveLength(2);
		expect(data.order_detail.disputes).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: old, state: "withdrawn", reason: oldReason, can_withdraw: false }),
			expect.objectContaining({ id: pending, state: "pending", reason, can_withdraw: true }),
		]));
		await expect(buyer.page).toHaveURL(new URL(href, buyer.page.url()).href);
		for (const id of [old, pending]) await expect(buyer.page.locator(`article a[href="${disputeHref("en", "buyer", id, item.seller)}"]`)).toHaveCount(1);
		await expect(buyer.page.getByText(reason, { exact: true })).toBeVisible();
		await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("dispute_withdraw");
		const target = buyer.page.getByRole("combobox", { name: t.target, exact: true });
		await expect(target.locator(`option[value="${pending}"]`)).toHaveCount(1);
		await expect(target.locator(`option[value="${old}"]`)).toHaveCount(0);
		await target.selectOption(pending);
		await buyer.page.getByRole("form", { name: t.exact, exact: true }).getByRole("textbox", { name: t.reason, exact: true }).fill("Review only the current pending case");
		await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
		await expect(buyer.page.getByRole("alertdialog")).toContainText(pending);
		await expect(buyer.page.getByRole("alertdialog")).not.toContainText(oldReason);
		await buyer.page.keyboard.press("Escape");
		const after = snapshot(item);
		expect(after.disputes).toHaveLength(2);
		expect(after.commands).toBe(before.commands + 1);
		expect(after.completion).toEqual(before.completion);
		expect(after.invoice).toEqual(before.invoice);
		expect(after.lines).toEqual(before.lines);
		expect(after.receipts).toEqual(before.receipts);
		expect(after.money).toEqual(before.money);
	} finally { await buyer.session.close(); }
});

test("P15 concurrent real opening leaves the original review visible and stale, retaining draft on Cancel", async ({ browser }) => {
	const item = fresh(), buyer = await login(browser), t = aftercareCopy.en;
	try {
		await open(buyer.page, item);
		const text = `Keep exact private draft ${item.id}`;
		await reviewDispute(buyer.page, text);
		const data = await detail(buyer.page, item);
		expect((await privatePost(buyer.page, `orders/buyer/orders/${item.id}/disputes/`, { command_id: crypto.randomUUID(), version: data.version, reason: "Concurrent actual dispute", evidence: [] })).status()).toBe(201);
		const dialog = buyer.page.getByRole("alertdialog");
		await expect(dialog.getByRole("button", { name: t.confirm, exact: true })).toBeDisabled({ timeout: 30000 });
		await expect(dialog).toContainText(text);
		await dialog.getByRole("button", { name: t.cancel, exact: true }).click();
		await expect(buyer.page.getByRole("textbox", { name: t.disputeReason, exact: true })).toHaveValue(text);
		expect((await detail(buyer.page, item)).disputes).toHaveLength(1);
	} finally { await buyer.session.close(); }
});
for (const applied of [true, false]) {
	test(`P15 lost dispute acknowledgement reconciles ${applied ? "exactly one real effect" : "fenced absence and retained fields"}`, async ({ browser }) => {
		const item = fresh(), buyer = await login(browser), t = aftercareCopy.en;
		try {
			await open(buyer.page, item);
			const reason = `Uncertain exact dispute ${item.id}`, path = `**/api/v1/orders/buyer/orders/${item.id}/disputes/`;
			let sends = 0;
			await buyer.page.route(path, async (route) => { sends++; if (applied) await route.fetch(); await route.abort("failed"); });
			await reviewDispute(buyer.page, reason);
			await confirm(buyer.page);
			const reconcile = buyer.page.getByRole("button", { name: t.reconcile, exact: true });
			await expect(reconcile).toBeVisible();
			expect(new URL(buyer.page.url()).searchParams.get("aftercare_domain")).toBe("orders");
			await reconcile.click();
			await expect(reconcile).toHaveCount(0);
			expect(sends).toBe(1);
			expect((await detail(buyer.page, item)).disputes).toHaveLength(applied ? 1 : 0);
			if (!applied) await expect(buyer.page.getByRole("textbox", { name: t.disputeReason, exact: true })).toHaveValue(reason);
		} finally { await buyer.session.close(); }
	});
}
test("P15 evidence reuses private payments upload and binds the exact reviewed orders dispute", async ({ browser }) => {
	const item = fresh(), buyer = await login(browser), t = aftercareCopy.en;
	try {
		await open(buyer.page, item);
		await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("dispute_open");
		await buyer.page.getByRole("textbox", { name: t.disputeReason, exact: true }).fill("Exact dispute with private synthetic evidence");
		const version = (await detail(buyer.page, item)).version;
		await buyer.page.getByRole("button", { name: t.loadGoods, exact: true }).click();
		await buyer.page.locator('input[type="file"]').setInputFiles(syntheticImage());
		const upload = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/payments/buyer/orders/${item.id}/uploads/`));
		await buyer.page.getByRole("button", { name: t.uploads, exact: true }).click();
		const uploaded = await upload;
		expect(uploaded.status()).toBe(201);
		const evidence = await uploaded.json() as { id: string };
		await expect(buyer.page.locator('input[type="file"]')).toHaveValue("");
		await buyer.page.getByRole("button", { name: t.exact, exact: true }).click();
		const command = buyer.page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/orders/${item.id}/disputes/`));
		const sent = buyer.page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/orders/${item.id}/disputes/`));
		await confirm(buyer.page);
		const packet = (await command).postDataJSON();
		expect(packet.version).toBe(version);
		expect(packet.evidence).toEqual([evidence.id]);
		const response = await sent;
		expect(response.status()).toBe(201);
		const dispute = (await response.json()).outcome.dispute as string;
		await expect.poll(() => snapshot(item).disputes.length).toBe(1);
		const current = (await detail(buyer.page, item)).disputes?.[0];
		expect(current).toMatchObject({ id: dispute, state: "pending" });
		expect(current?.evidence).toEqual([evidence.id]);
	} finally { await buyer.session.close(); }
});
test("P15 order report and aftercare drafts share a discard guard without replacing either draft", async ({ browser }) => {
	const item = fresh(), buyer = await login(browser), t = aftercareCopy.en, copy = communicationCopy.en;
	try {
		await open(buyer.page, item);
		await buyer.page.getByRole("combobox", { name: t.exact, exact: true }).selectOption("dispute_open");
		await buyer.page.getByRole("textbox", { name: t.disputeReason, exact: true }).fill("Keep aftercare draft");
		const report = buyer.page.locator("details").filter({ has: buyer.page.locator("summary", { hasText: copy.reportOrder }) });
		await report.locator("summary").click();
		await report.getByLabel(copy.reason, { exact: true }).fill("Keep generalized report draft");
		await buyer.page.locator('main a[href="/en/account/buyer/disputes"]').first().click();
		const warning = buyer.page.getByRole("alert").filter({ has: buyer.page.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }) });
		await expect(warning).toBeVisible();
		await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
		await expect(buyer.page.getByRole("textbox", { name: t.disputeReason, exact: true })).toHaveValue("Keep aftercare draft");
		await expect(report.locator("textarea")).toHaveValue("Keep generalized report draft");
		expect(snapshot(item).disputes).toHaveLength(0);
	} finally { await buyer.session.close(); }
});
for (const target of ["product", "store"] as const) {
	test(`P15 collapsed dirty ${target} report keeps visible Cancel/discard navigation without a domain write`, async ({ browser }) => {
		const values = fixtures(), buyer = await login(browser, "other"), copy = communicationCopy.en;
		try {
			await buyer.page.setViewportSize({ width: 1440, height: 1000 });
			const href = `/en/${target === "product" ? "products" : "stores"}/${values[target]}`, path = `${apiOrigin}/api/v1/messaging/buyer/reports/${target}/${values[target]}/`;
			const initial = await buyer.page.request.get(path);
			expect(initial.status()).toBe(200);
			const status = await initial.json() as { results: unknown[] };
			expect(status.results).toEqual([]);
			const before = snapshot(values.orders.completed), writes: string[] = [];
			buyer.page.on("request", (request) => { if (/\/api\/v1\/(messaging|orders|payments|fulfilment)\//.test(request.url()) && request.method() !== "GET") writes.push(request.url()); });
			await buyer.page.goto(href);
			const label = target === "product" ? copy.reportProduct : copy.reportStore;
			const report = buyer.page.locator("details").filter({ has: buyer.page.locator("summary", { hasText: label }) });
			const loaded = buyer.page.waitForResponse((r) => r.request().method() === "GET" && r.url() === path);
			await report.locator("summary").click();
			expect((await loaded).status()).toBe(200);
			await expect(report.getByLabel(copy.reason, { exact: true })).toBeEnabled();
			const reason = `Keep collapsed private ${target} report ${values[target]}`;
			await report.getByLabel(copy.reason, { exact: true }).fill(reason);
			await report.locator("summary").click();
			await expect(report).not.toHaveAttribute("open", "");
			const warning = buyer.page.getByRole("alert").filter({ has: buyer.page.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }) });
			if (target === "store") {
				const preferences = buyer.page.locator("details").filter({ has: buyer.page.locator(`summary[aria-label="${storefrontCopy.en.preferences}"]`) });
				await preferences.locator("summary").click();
				const appearance = preferences.getByRole("radiogroup", { name: messages.en.theme, exact: true });
				const language = preferences.getByRole("radiogroup", { name: messages.en.language, exact: true });
				const themeName = await appearance.locator("input").first().getAttribute("name"), languageName = await language.locator("input").first().getAttribute("name");
				expect(themeName).toBeTruthy();
				expect(languageName).toBeTruthy();
				expect(themeName).not.toBe(languageName);
				await appearance.getByRole("radio", { name: messages.en.system, exact: true }).check();
				await appearance.getByRole("radio", { name: messages.en.system, exact: true }).focus();
				await buyer.page.keyboard.press("ArrowRight");
				await expect(appearance.getByRole("radio", { name: messages.en.light, exact: true })).toBeChecked();
				await buyer.page.keyboard.press("ArrowRight");
				await expect(appearance.getByRole("radio", { name: messages.en.dark, exact: true })).toBeChecked();
				await expect(buyer.page.locator("html")).toHaveAttribute("data-theme", "dark");
				expect(await buyer.page.evaluate(() => localStorage.getItem("rezayi-theme"))).toBe("dark");
				const cookies = await buyer.session.cookies();
				await language.locator('input[value="en"]').focus();
				await buyer.page.keyboard.press("ArrowLeft");
				await expect(warning).toBeVisible();
				await expect(buyer.page).toHaveURL(new URL(href, buyer.page.url()).href);
				await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
				await expect(language.locator('input[value="en"]')).toBeChecked();
				// Retained locale order is Dari, English, Pashto, Arabic: ArrowLeft from English reaches Dari.
				await expect(language.locator('input[value="fa-AF"]')).not.toBeChecked();
				await expect(language.locator('input[value="fa-AF"]')).toBeFocused();
				expect((await buyer.session.cookies()).filter((cookie) => cookie.name === "rezayi-locale")).toEqual(cookies.filter((cookie) => cookie.name === "rezayi-locale"));
				await expect(report.locator("textarea")).toHaveValue(reason);
				await buyer.page.keyboard.press("Escape");
				await expect(preferences.locator("summary")).toBeFocused();
			}
			const home = buyer.page.locator('header a[href="/en"]').first();
			await home.click();
			await expect(warning).toBeVisible();
			await expect(warning).toContainText(catalogueCopy.en.dirty);
			await expect(buyer.page).toHaveURL(new URL(href, buyer.page.url()).href);
			await expect(report).not.toHaveAttribute("open", "");
			await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
			await expect(home).toBeFocused();
			await report.locator("summary").click();
			await expect(report.locator("textarea")).toHaveValue(reason);
			await report.locator("summary").click();
			await home.click();
			await expect(warning).toBeVisible();
			await warning.getByRole("button", { name: catalogueCopy.en.confirm, exact: true }).click();
			await expect(buyer.page).toHaveURL(/\/en$/);
			const final = await buyer.page.request.get(path);
			expect(final.status()).toBe(200);
			expect(await final.json()).toEqual(status);
			expect(snapshot(values.orders.completed)).toEqual(before);
			expect(writes).toEqual([]);
		} finally { await buyer.session.close(); }
	});
}

test("P15 financial-only seller downgrade redacts finance but preserves the independently dirty order report guard", async ({ browser }) => {
	const item = fixtures().disputes.refund_ordered, t = aftercareCopy.en, copy = communicationCopy.en;
	const membership = `from apps.orders.management.commands.seed_dispute_examples import owned_storage\nfrom apps.organizations.models import Membership\nowned_storage()\nm=Membership.objects.get(company_id='${item.seller}',account__user__email='phase12-operations@example.test')\nassert m.active and not m.is_owner\n`;
	const original = JSON.parse(disposablePython(`import json\n${membership}print(json.dumps(m.bundles))`)) as string[];
	let seller: Awaited<ReturnType<typeof login>> | null = null;
	try {
		disposablePython(`${membership}m.bundles=['orders_negotiation','payments_refunds'];m.save(update_fields=['bundles'])`);
		seller = await login(browser, "operations");
		const page = seller.page, before = snapshot(item), writes: string[] = [];
		page.on("request", (request) => { if (/\/api\/v1\/(messaging|orders|payments|fulfilment)\//.test(request.url()) && request.method() !== "GET") writes.push(request.url()); });
		await open(page, item, "seller");
		const paymentPath = `${apiOrigin}/api/v1/payments/seller/orders/${item.id}/`;
		const expanded = page.waitForResponse((r) => r.request().method() === "GET" && r.url() === paymentPath);
		await page.getByRole("button", { name: t.loadGoods, exact: true }).click();
		const payment = await expanded;
		expect(payment.status()).toBe(200);
		expect(await payment.json()).toMatchObject({ capabilities: { details: true, evidence: true, refund: true }, refund_dues: expect.arrayContaining([expect.objectContaining({ id: item.refund_due, can_report: true })]) });
		await page.getByRole("combobox", { name: sellerSalesCopy.en.actions, exact: true }).click();
		await page.locator('[role="option"][value="report"]').click();
		await page.getByRole("textbox", { name: t.description, exact: true }).fill("Sensitive financial draft must be redacted");
		const report = page.locator("details").filter({ has: page.locator("summary", { hasText: copy.reportOrder }) });
		const reportPath = `${apiOrigin}/api/v1/messaging/seller/reports/order/${item.id}/`;
		const loaded = page.waitForResponse((r) => r.request().method() === "GET" && r.url() === reportPath);
		await report.locator("summary").click();
		expect((await loaded).status()).toBe(200);
		await expect(report.getByLabel(copy.reason, { exact: true })).toBeEnabled();
		const reason = "Independent order report survives finance-only downgrade";
		await report.getByLabel(copy.reason, { exact: true }).fill(reason);
		await report.locator("summary").click();
		disposablePython(`${membership}m.bundles=['orders_negotiation'];m.save(update_fields=['bundles'])`);
		const refreshed = page.waitForResponse((r) => r.request().method() === "GET" && r.url() === paymentPath);
		await page.getByRole("button", { name: t.refresh, exact: true }).first().click();
		const downgraded = await refreshed;
		expect(downgraded.status()).toBe(200);
		expect(await downgraded.json()).toMatchObject({ capabilities: { details: false, evidence: false, refund: false }, refund_dues: [], refund_reports: [] });
		await expect(page.getByRole("textbox", { name: t.description, exact: true })).toHaveCount(0);
		await expect(page.getByText("Sensitive financial draft must be redacted", { exact: true })).toHaveCount(0);
		expect((await detail(page, item, "seller")).id).toBe(item.id);
		const status = await page.request.get(reportPath);
		expect(status.status()).toBe(200);
		expect((await status.json()).results).toEqual([]);
		await expect(report.locator("textarea")).toHaveValue(reason);
		const href = disputeHref("en", "seller", undefined, item.seller), link = page.locator(`main a[href="${href}"]:visible`).last();
		const warning = page.getByRole("alert").filter({ has: page.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }) });
		const retainedUrl = page.url();
		await link.click();
		await expect(warning).toBeVisible();
		await expect(page).toHaveURL(retainedUrl);
		await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
		await expect(link).toBeFocused();
		await report.locator("summary").click();
		await expect(report.locator("textarea")).toHaveValue(reason);
		await report.locator("summary").click();
		await link.click();
		await expect(warning).toBeVisible();
		await warning.getByRole("button", { name: catalogueCopy.en.confirm, exact: true }).click();
		await expect(page).toHaveURL(new URL(href, retainedUrl).href);
		const final = await page.request.get(reportPath);
		expect(final.status()).toBe(200);
		expect((await final.json()).results).toEqual([]);
		expect(snapshot(item)).toEqual(before);
		expect(writes).toEqual([]);
	} finally {
		disposablePython(`${membership}m.bundles=${JSON.stringify(original)};m.save(update_fields=['bundles'])`);
		await seller?.session.close();
	}
});

for (const target of ["product", "store", "order"] as const) {
	test(`P15 ${target} report entry shows real own status and never changes aggregate or money`, async ({ browser }) => {
		const values = fixtures(), buyer = await login(browser), copy = communicationCopy.en;
		try {
			const url = target === "order" ? aftercareHref("en", "buyer", values.orders.completed.id) : `/en/${target === "product" ? "products" : "stores"}/${values[target]}`;
			const before = snapshot(values.orders.completed);
			await buyer.page.goto(url);
			const label = target === "product" ? copy.reportProduct : target === "store" ? copy.reportStore : copy.reportOrder;
			const report = buyer.page.locator("details").filter({ has: buyer.page.locator("summary", { hasText: label }) });
			await report.locator("summary").click();
			await expect(report).toContainText(values.reports[target].id);
			await expect(report).toContainText(copy.open);
			await expect(report).toContainText(copy.reportNeutral);
			await expect(report.getByRole("button", { name: copy.submitReport, exact: true })).toHaveCount(0);
			const summary = await buyer.page.request.get(`${apiOrigin}/api/v1/marketplace/public/en/stores/${values.store}/reviews/summary/`);
			expect(summary.status()).toBe(200);
			expect(await summary.json()).toEqual(values.public_summary);
			expect(snapshot(values.orders.completed)).toEqual(before);
		} finally { await buyer.session.close(); }
	});
}
test("P15 generalized report lost acknowledgement retries the identical real packet/key only", async ({ browser }) => {
	const item = fresh(), buyer = await login(browser), copy = communicationCopy.en;
	try {
		await open(buyer.page, item);
		const report = buyer.page.locator("details").filter({ has: buyer.page.locator("summary", { hasText: copy.reportOrder }) });
		await report.locator("summary").click();
		await report.getByLabel(copy.reason, { exact: true }).fill("Exact uncertain synthetic report");
		let sends = 0;
		const packets: unknown[] = [], path = `**/api/v1/messaging/buyer/reports/order/${item.id}/`;
		await buyer.page.route(path, async (route) => {
			if (route.request().method() !== "POST") { await route.continue(); return; }
			sends++; packets.push(route.request().postDataJSON());
			if (sends === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue();
		});
		await report.getByRole("button", { name: copy.submitReport, exact: true }).click();
		await expect(report).toContainText(copy.reportUncertain);
		await expect(report.locator("textarea")).toBeDisabled();
		await report.locator("form").getByRole("button", { name: copy.retry, exact: true }).click();
		await expect(report).toContainText(copy.reportSaved);
		expect(sends).toBe(2);
		expect(packets[1]).toEqual(packets[0]);
		const status = await buyer.page.request.get(`${apiOrigin}/api/v1/messaging/buyer/reports/order/${item.id}/`);
		expect((await status.json()).results).toHaveLength(1);
		expect(snapshot(item).disputes).toHaveLength(0);
	} finally { await buyer.session.close(); }
});
test("P15 public review projection is approved-only, real aggregate, paginated and noindex", async ({ page }) => {
	const values = fixtures();
	const response = await page.goto(`/en/stores/${values.store}/reviews`);
	expect(response?.status()).toBe(200);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
	await expect(page.getByText("نظر آزمایشی • Synthetic retained review approved", { exact: true })).toBeVisible();
	for (const name of ["pending", "rejected", "withdrawn", "moderator_withdrawn"]) await expect(page.getByText(`نظر آزمایشی • Synthetic retained review ${name}`, { exact: true })).toHaveCount(0);
	const reviews = await page.request.get(`${apiOrigin}/api/v1/marketplace/public/en/stores/${values.store}/reviews/?page=1`);
	const data = await reviews.json() as { results: Record<string, unknown>[]; count: number; page: number; page_size: number };
	expect(data.count).toBe(values.public_summary.count);
	expect(data.page_size).toBeGreaterThan(0);
	for (const row of data.results) { expect(row).not.toHaveProperty("order"); expect(row).not.toHaveProperty("id"); expect(row).not.toHaveProperty("state"); }
	await page.goto(`/en/stores/${values.store}/reviews?page=2`);
	await expect(page.getByText("نظر آزمایشی • Synthetic retained review approved", { exact: true })).toHaveCount(0);
	await page.goto(`/en/stores/${values.store}/reviews?page=invalid`);
	await expect(page.locator("main").getByRole("alert")).toBeVisible();
});
test("P15 a real empty public aggregate displays no placeholder rating", async ({ page }) => {
	const values = fixtures();
	const store = disposablePython(`from apps.marketplace.queries import PublicGate
from apps.orders import reviews
profile=PublicGate('en').profiles.exclude(pk='${values.store}').first()
assert profile is not None and reviews.aggregate(profile)=={'count':0,'average':None}
print(profile.pk)`).trim();
	const response = await page.request.get(`${apiOrigin}/api/v1/marketplace/public/en/stores/${store}/reviews/summary/`);
	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({ count: 0, average: null });
	await page.goto(`/en/stores/${store}/reviews`);
	await expect(page.getByText(aftercareCopy.en.reviewEmpty, { exact: true })).toBeVisible();
	await expect(page.getByText("0/5", { exact: true })).toHaveCount(0);
});
test("P15 a clean composer cannot unregister another message report's dirty guard", async ({ browser }) => {
	const values = fixtures(), buyer = await login(browser), copy = communicationCopy.en;
	const conversation = JSON.parse(disposablePython(`import json,uuid
from django.test import override_settings
from apps.accounts.models import User
from apps.messaging.models import Conversation
from apps.messaging import services
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.orders.management.commands.seed_dispute_examples import owned_storage
owned_storage()
item=Conversation.objects.get(product_id='${values.product}',buyer__user__email='phase12-buyer@example.test')
with override_settings(OWNER_MFA_REQUIRED=False):
    seller=actor(User.objects.get(email='phase12-owner@example.test'),'seller')
    result=services.send(seller,item.pk,{'command_id':uuid.uuid4(),'body':'Synthetic incoming guard fixture','images':[]})
print(json.dumps(result))`)) as { conversation: string; message: string };
	try {
		await buyer.page.goto(`/en/account/buyer/messages/${conversation.conversation}`);
		const thread = buyer.page.getByTestId("message-thread"), message = thread.locator("article").filter({ hasText: "Synthetic incoming guard fixture" }).last();
		await message.locator("summary").click();
		await message.getByLabel(copy.reason, { exact: true }).fill("Keep private message report");
		const composer = buyer.page.getByTestId("message-composer").locator('textarea[name="message"]');
		await composer.fill("Keep composer too");
		await thread.getByRole("link", { name: copy.back, exact: true }).click();
		const warning = buyer.page.getByRole("alert").filter({ has: buyer.page.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }) });
		await expect(warning).toBeVisible();
		await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
		await composer.fill("");
		await thread.getByRole("link", { name: copy.back, exact: true }).click();
		await expect(warning).toBeVisible();
		await warning.getByRole("button", { name: catalogueCopy.en.cancel, exact: true }).click();
		await expect(message.locator("textarea")).toHaveValue("Keep private message report");
	} finally { await buyer.session.close(); }
});
test("P15 own-report statuses remain available through authenticated notifications", async ({ browser }) => {
	const values = fixtures(), buyer = await login(browser), copy = communicationCopy.en;
	try {
		await buyer.page.goto("/en/account/buyer/notifications");
		const reports = buyer.page.locator("details").filter({ has: buyer.page.locator("summary", { hasText: copy.ownReports }) });
		await reports.locator("summary").click();
		await expect(reports).toContainText(values.reports.product.id);
		await expect(reports).toContainText(values.reports.store.id);
		await expect(reports).toContainText(values.reports.order.id);
		await expect(reports.locator(`a[href="/en/products/${values.product}"]`)).toBeVisible();
	} finally { await buyer.session.close(); }
});
for (const path of ["buyer/disputes/invalid", "seller/disputes/new", "buyer/disputes/00000000-0000-4000-8000-000000000015/withdraw", "seller/disputes/00000000-0000-4000-8000-000000000015/decide", "staff/disputes"]) {
	test(`P15 unknown command/staff route is private 404: ${path}`, async ({ page }) => {
		const response = await page.goto(`/en/account/${path}`);
		expect(response?.status()).toBe(404);
		expect(response?.headers()["x-robots-tag"]).toContain("noindex");
	});
}
