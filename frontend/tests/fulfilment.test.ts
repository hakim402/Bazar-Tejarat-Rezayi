import test from "node:test";
import assert from "node:assert/strict";
import {
	wholeSelection,
	quantityUnits,
	moneyUnits,
	actualTime,
} from "../features/fulfilment/validation.ts";
import {
	fulfilmentHref,
	retainFulfilment,
	pendingFulfilment,
	settleFulfilment,
	clearFulfilmentIntents,
} from "../features/fulfilment/api.ts";
import {
	sellerAccountRoute,
	commerceRoute,
} from "../lib/routes/account-routes.ts";
const id = "bb8ed8ab-a111-4233-988a-f2f3388beabd",
	batch = "f17c92ad-b111-4833-9faa-f7f4311beabc";
test("P13 whole demand aggregates accepted tiers and requires every exact batch quantity", () => {
	const goods = [
		{ variant: id, quantity: "1.000" },
		{ variant: id, quantity: "2.000" },
	];
	assert.equal(
		wholeSelection(goods, [{ variant: id, batch: null, quantity: "3.000" }]),
		true,
	);
	assert.equal(
		wholeSelection(goods, [
			{ variant: id, batch: null, quantity: "1.000" },
			{ variant: id, batch, quantity: "2.000" },
		]),
		true,
	);
	for (const lines of [
		[],
		[{ variant: id, batch: null, quantity: "2.999" }],
		[{ variant: id, batch: null, quantity: "4.000" }],
		[
			{ variant: id, batch: null, quantity: "1.000" },
			{ variant: id, batch: null, quantity: "2.000" },
		],
		[{ variant: batch, batch: null, quantity: "3.000" }],
	])
		assert.equal(wholeSelection(goods, lines), false);
});
test("P13 stock and delivery money reject exponent, signs, overflow and rounding", () => {
	for (const raw of [
		"1",
		"1.00",
		"1e2",
		"-1.000",
		"1.0001",
		"1000000000.000",
		"NaN",
	])
		assert.equal(quantityUnits(raw), null);
	assert.equal(quantityUnits("999999999.999"), BigInt("999999999999"));
	assert.equal(moneyUnits("0.00"), null);
	assert.equal(moneyUnits("0.00", true), BigInt(0));
	assert.equal(
		moneyUnits("9999999999999999999999.99"),
		BigInt("999999999999999999999999"),
	);
	assert.equal(moneyUnits("10000000000000000000000.00"), null);
	assert.equal(actualTime("2999-01-01T00:00:00Z"), null);
});
test("P13 pending command keeps the first exact immutable packet until reconciliation", () => {
	clearFulfilmentIntents();
	const scope = "synthetic-buyer:order";
	const packet = {
		key: id,
		path: "dispatch/",
		body: {
			command_id: id,
			recipient: "synthetic-private",
			lines: [{ quantity: "1.000" }],
		},
		upload: false,
	};
	const first = retainFulfilment(scope, packet);
	packet.body.lines[0].quantity = "99.000";
	assert.equal(
		(first.body as { lines: { quantity: string }[] }).lines[0].quantity,
		"1.000",
	);
	assert.equal(retainFulfilment(scope, { ...packet, key: batch }), first);
	assert.equal(pendingFulfilment(scope), first);
	assert.equal(pendingFulfilment("another-identity:order"), undefined);
	settleFulfilment(scope);
	assert.equal(pendingFulfilment(scope), undefined);
	retainFulfilment(scope, packet);
	clearFulfilmentIntents();
	assert.equal(pendingFulfilment(scope), undefined);
});
test("P13 private links carry only opaque identity and bounded filters", () => {
	const buyer = fulfilmentHref("fa-AF", "buyer", id),
		seller = fulfilmentHref("en", "seller", id, batch, 2, "dispatched");
	assert.equal(buyer, `/fa-AF/account/buyer/deliveries/${id}`);
	assert.equal(
		seller,
		`/en/account/seller/fulfilment/${id}?seller=${batch}&page=2&state=dispatched`,
	);
	assert.equal(commerceRoute(["deliveries", id]), true);
	assert.equal(sellerAccountRoute(["fulfilment", id]), true);
	assert.equal(sellerAccountRoute(["deliveries", id]), false);
	assert.equal(commerceRoute(["fulfilment", id, "print"]), false);
	assert.equal(commerceRoute(["deliveries", "not-a-uuid"]), false);
});
