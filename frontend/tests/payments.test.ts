import test from "node:test";
import assert from "node:assert/strict";
import {
	moneyUnits,
	quantityUnits,
	exactSelections,
	actualTime,
} from "../features/payments/validation.ts";
import {
	retainPayment,
	pendingPayment,
	settlePayment,
	clearPaymentIntents,
	paymentHref,
} from "../features/payments/api.ts";
import { commerceRoute } from "../lib/routes/account-routes.ts";
test("payment amounts remain exact beyond Number safe integers", () => {
	assert.equal(
		moneyUnits("9999999999999999999999.99"),
		BigInt("999999999999999999999999"),
	);
	for (const v of [
		"1",
		"1.001",
		"NaN",
		"1e2",
		"-1.00",
		"0.00",
		"00.10",
		"10000000000000000000000.00",
	])
		assert.equal(moneyUnits(v), null);
	assert.equal(moneyUnits("0.00", true), BigInt(0));
});
test("whole accepted selection aggregates batches, no duplicates, increments or partial quantities", () => {
	const goods = [{ variant: "a", quantity: "2.000", increment: "0.500" }],
		one = { variant: "a", batch: "one", quantity: "1.000" };
	assert.equal(exactSelections(goods, [one, { ...one, batch: "two" }]), true);
	assert.equal(exactSelections(goods, [one, one]), false);
	assert.equal(exactSelections(goods, [one]), false);
	assert.equal(exactSelections(goods, [{ ...one, quantity: "2.001" }]), false);
	assert.equal(quantityUnits("1.0000"), null);
});
test("uncertain command retains exact immutable packet until scoped settlement", () => {
	clearPaymentIntents();
	const packet = {
		key: "first",
		path: "orders/id/receipts/",
		body: { amount: "5.00", version: 7 },
		upload: false,
	};
	retainPayment("actor:account:seller:business:order", packet);
	packet.body.amount = "9.00";
	retainPayment("actor:account:seller:business:order", {
		...packet,
		key: "replacement",
	});
	assert.equal(
		pendingPayment("actor:account:seller:business:order")?.key,
		"first",
	);
	assert.equal(
		pendingPayment("actor:account:seller:business:order")?.body instanceof
			FormData,
		false,
	);
	const stored = pendingPayment("actor:account:seller:business:order");
	assert.ok(stored);
	assert.equal((stored.body as Record<string, unknown>).amount, "5.00");
	assert.equal(pendingPayment("different-scope"), undefined);
	settlePayment("actor:account:seller:business:order");
	assert.equal(
		pendingPayment("actor:account:seller:business:order"),
		undefined,
	);
});
test("routes are strict and financial facts never enter navigation", () => {
	const id = "00000000-0000-4000-8000-000000000001";
	assert.equal(commerceRoute(["payments", id]), true);
	assert.equal(commerceRoute(["payments", "new"]), false);
	assert.equal(
		paymentHref("fa-AF", "seller", id, id).includes("amount"),
		false,
	);
});
test("actual payment time rejects future or invalid facts", () => {
	assert.equal(
		actualTime("2026-01-02T00:00:00Z", Date.parse("2026-01-01T00:00:00Z")),
		null,
	);
	assert.equal(actualTime("invalid"), null);
	assert.equal(
		actualTime("2026-01-01T00:00:00Z", Date.parse("2026-01-02T00:00:00Z")),
		"2026-01-01T00:00:00.000Z",
	);
});
