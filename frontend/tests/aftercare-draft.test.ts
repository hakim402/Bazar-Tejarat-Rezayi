import test from "node:test";
import assert from "node:assert/strict";
import {
	emptyDraft, availableModes, buildAction, isStale, modeDomain, modeLabel, versionOf,
} from "../features/aftercare/draft.ts";
import { aftercareCopy } from "../features/aftercare/copy.ts";
import type { Mode, RequestRow, Workspace } from "../features/aftercare/types";

const id = "00000000-0000-4000-8000-000000000001";
const key = "00000000-0000-4000-8000-000000000002";
const at = "2020-01-01T10:00:00Z";
function workspace(): Workspace {
	const request: RequestRow = {
		id: "request", order: id, number: "SYNTHETIC-14", currency: "AFN", state: "pending",
		version: 1, reason: "Original reason", created_at: at, decision: null,
		decision_reason: "", decided_at: null, can_withdraw: true,
	};
	const money = {
		accepted_total: "37.50", received: "50.00", refunded: "0.00", refund_due: "5.00",
		remaining: "0.00", overpayment: "12.50", version: 7,
		original_due_at: null, effective_due_at: null,
	};
	return {
		order: {
			id, invoice: "invoice", number: request.number, currency: "AFN", seller: "seller",
			goods_total: "37.50", accepted_total: "37.50", version: 3,
			capabilities: ["cancel", "amend"], aftercare: {}, payment: money,
			effective_lines: [{ line: "line", variant: "variant", tier: "retail", quantity: "3.000", unit_price: "12.50", goods_amount: "37.50", increment: "0.500" }],
			cancellations: [request], amendments: [{ ...request, id: "amendment", after_total: "25.00", lines: [] }], adjustments: [],
		},
		payment: {
			...money, id, currency: "AFN", capabilities: { excess_refund: true, refund: true, evidence: true }, refundable_excess: "7.50",
			refund_dues: [{ id: "due", cause: "excess", amount: "5.00", currency: "AFN", state: "reported", version: 2, created_at: at, can_report: true, previous: "previous-report" }],
			refund_reports: [{ id: "report", due: "due", previous: null, amount: "5.00", sent_at: at, reference: "original-reference", description: "Original actual refund", state: "pending", reason: "", evidence: ["original-image"], can_withdraw: true }],
		},
		delivery: {
			id, version: 11, goods_version: 7, capabilities: { refund: true, evidence: true }, provider: "current-provider", charge_provider: "payee",
			delivery_confirmed: "6.00", delivery_refunded: "0.00", delivery_remaining: "0.00",
			refund_providers: [{ id: "payee", name: "Finalized synthetic payee", refundable: "6.00" }], delivery_refunds: [],
		},
	};
}
const reason = () => ({ ...emptyDraft(), reason: "  Reviewed synthetic reason  " });
const report = () => ({ ...emptyDraft(), target: "due", amount: "5.00", at, reference: " REF-14 ", description: " Actual synthetic refund ", images: ["image"] });
const modes: Mode[] = ["cancel", "cancel_withdraw", "amend", "amend_withdraw", "excess", "report", "refund_withdraw", "delivery_refund"];

test("aftercare drafts have independent arrays and no inherited private facts", () => {
	const first = emptyDraft(), next = emptyDraft();
	first.images.push("private-image");
	first.reason = "Private reason";
	assert.deepEqual(next.images, []);
	assert.deepEqual(next.lines, []);
	assert.equal(next.reason, "");
});
test("aftercare available actions derive from each current capability and owned row", () => {
	const data = workspace();
	assert.deepEqual(availableModes(data), modes);
	data.order.capabilities = [];
	data.order.cancellations[0].can_withdraw = false;
	data.order.amendments[0].can_withdraw = false;
	data.payment = null;
	data.delivery = null;
	assert.deepEqual(availableModes(data), []);
	assert.equal(buildAction("en", data, "cancel", reason(), key), null);
});
test("aftercare command families select their own independent version domain", () => {
	const data = workspace();
	for (const mode of modes) {
		const domain = mode === "delivery_refund" ? "fulfilment" : ["excess", "report", "refund_withdraw"].includes(mode) ? "payments" : "orders";
		assert.equal(modeDomain(mode), domain);
		assert.equal(versionOf(data, mode), domain === "orders" ? 3 : domain === "payments" ? 7 : 11);
	}
});
test("aftercare cancellation packet uses ORDER id and a trimmed reviewed reason", () => {
	const data = workspace();
	const review = buildAction("en", data, "cancel", reason(), key);
	assert.ok(review);
	assert.equal(review.intent.path, `orders/${id}/cancellations/`);
	assert.deepEqual(review.intent.body, { command_id: key, version: data.order.version, reason: reason().reason.trim() });
	assert.equal(buildAction("en", data, "cancel", emptyDraft(), key), null);
});
test("aftercare withdrawal binds the selected owned request, not the order or another target", () => {
	for (const mode of ["cancel_withdraw", "amend_withdraw"] as const) {
		const target = mode === "cancel_withdraw" ? "request" : "amendment";
		const review = buildAction("en", workspace(), mode, { ...reason(), target }, key);
		assert.ok(review);
		assert.equal(review.intent.path, `${mode === "cancel_withdraw" ? "cancellations" : "amendments"}/${target}/withdraw/`);
		assert.equal(buildAction("en", workspace(), mode, { ...reason(), target: id }, key), null);
	}
});
test("aftercare amendment reviews original and proposed snapshots with recomputed exact totals", () => {
	const data = workspace(), draft = reason();
	draft.lines = [{ ...data.order.effective_lines[0], quantity: "2.000", unit_price: "10.00" }];
	const review = buildAction("en", data, "amend", draft, key);
	assert.ok(review);
	assert.deepEqual(review.lines[0].before, data.order.effective_lines[0]);
	assert.equal(review.lines[0].after.goods_amount, "20.00");
	assert.equal(review.fields[aftercareCopy.en.after], "20.00 AFN");
	assert.deepEqual((review.intent.body as Record<string, unknown>).lines, [{ line: "line", quantity: "2.000", unit_price: "10.00" }]);
});
test("aftercare amendment rejects duplicate, absent, unknown and non-decreasing lines", () => {
	const data = workspace(), line = { ...data.order.effective_lines[0], quantity: "2.000" };
	for (const lines of [[], [line, line], [{ ...line, line: "unknown" }], data.order.effective_lines, Array.from({ length: 101 }, () => line)])
		assert.equal(buildAction("en", data, "amend", { ...reason(), lines }, key), null);
});
test("aftercare excess uses the current remaining refundable bound", () => {
	const data = workspace();
	assert.equal(buildAction("en", data, "excess", { ...reason(), amount: "7.51" }, key), null);
	const review = buildAction("en", data, "excess", { ...reason(), amount: "7.50" }, key);
	assert.ok(review);
	assert.equal(review.intent.path, `orders/${id}/refund-dues/`);
	assert.equal(review.fields[aftercareCopy.en.limit], "7.50 AFN");
});
test("aftercare report binds exact due and previous report with private evidence", () => {
	const review = buildAction("en", workspace(), "report", report(), key);
	assert.ok(review);
	assert.deepEqual(review.intent.body, {
		command_id: key, version: 7, amount: "5.00", sent_at: "2020-01-01T10:00:00.000Z",
		reference: "REF-14", description: "Actual synthetic refund", evidence: ["image"], due: "due", previous: "previous-report",
	});
	assert.equal(review.intent.path, `orders/${id}/refund-reports/`);
});
test("aftercare report rejects partial money, future time, oversized facts and unknown due", () => {
	for (const change of [{ amount: "4.99" }, { at: "2999-01-01T00:00:00Z" }, { reference: " " }, { reference: "x".repeat(161) }, { description: "x".repeat(501) }, { images: ["a", "b", "c", "d"] }, { target: "unknown" }])
		assert.equal(buildAction("en", workspace(), "report", { ...report(), ...change }, key), null);
});
test("aftercare delivery refund uses finalized eligible payee and both current versions", () => {
	const data = workspace(), draft = { ...report(), target: "payee", amount: "6.00" };
	const review = buildAction("en", data, "delivery_refund", draft, key);
	assert.ok(review);
	assert.equal(review.intent.domain, "fulfilment");
	assert.equal(review.intent.path, `orders/${id}/delivery-refunds/`);
	assert.equal((review.intent.body as Record<string, unknown>).goods_version, 7);
	assert.equal((review.intent.body as Record<string, unknown>).provider, "payee");
	assert.equal(buildAction("en", data, "delivery_refund", { ...draft, target: "current-provider" }, key), null);
	assert.equal(buildAction("en", data, "delivery_refund", { ...draft, amount: "6.01" }, key), null);
});
test("aftercare refund withdrawal displays original report evidence and facts", () => {
	const data = workspace();
	const review = buildAction("en", data, "refund_withdraw", { ...reason(), target: "report", images: ["wrong-image"] }, key);
	assert.ok(review);
	assert.deepEqual(review.images, data.payment?.refund_reports[0].evidence);
	assert.equal(review.fields[aftercareCopy.en.reference], "original-reference");
	assert.equal(review.intent.path, "refund-reports/report/withdraw/");
});
test("aftercare stale review detects selected domain, goods version and revoked capability", () => {
	const data = workspace();
	const review = buildAction("en", data, "delivery_refund", { ...report(), target: "payee" }, key);
	assert.ok(review);
	assert.equal(isStale(review, data), false);
	data.order.version++;
	assert.equal(isStale(review, data), false);
	assert.ok(data.delivery);
	data.delivery.goods_version++;
	assert.equal(isStale(review, data), true);
	data.delivery.goods_version--;
	data.delivery.version++;
	assert.equal(isStale(review, data), true);
	data.delivery.version--;
	data.delivery.capabilities.refund = false;
	assert.equal(isStale(review, data), true);
});
test("aftercare displayed packet cannot follow later edits to draft or backend projection", () => {
	const data = workspace(), draft = report();
	const review = buildAction("en", data, "report", draft, key);
	assert.ok(review);
	draft.images.push("later-image");
	draft.amount = "6.00";
	data.order.number = "later-number";
	assert.equal(review.number, "SYNTHETIC-14");
	assert.deepEqual(review.images, ["image"]);
	assert.equal((review.intent.body as Record<string, unknown>).amount, "5.00");
	assert.equal(Object.isFrozen(review.intent.body), true);
});
test("aftercare locale changes labels but not reviewed command currency or facts", () => {
	const data = workspace();
	const canonical = buildAction("en", data, "report", report(), key);
	assert.ok(canonical);
	for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
		const review = buildAction(locale, data, "report", report(), key);
		assert.ok(review);
		assert.deepEqual(review.intent, canonical.intent);
		assert.equal(review.currency, canonical.currency);
		assert.equal(modeLabel(locale, "report"), aftercareCopy[locale].report);
	}
});
