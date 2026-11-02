import test from "node:test";
import assert from "node:assert/strict";
import {
	commerceRoute,
	sellerAccountRoute,
} from "../lib/routes/account-routes.ts";
import { safeReturn } from "../features/identity/api/accounts.ts";
import { commerceCopy } from "../features/orders/copy.ts";
import { estimate, addQuantity, invoiceHref } from "../features/orders/api.ts";
import {
	pendingIntent,
	retainIntent,
	settleIntent,
	clearCommerceIntents,
} from "../features/orders/intents.ts";
const id = "11111111-2222-4333-8444-555555555555";
test("commerce routes and modal return keep private role/UUID boundaries", () => {
	for (const route of [
		["orders"],
		["orders", id],
		["invoices"],
		["invoices", id, "print"],
		["checkouts", id],
		["checkout"],
	])
		assert.equal(commerceRoute(route), true);
	for (const route of [
		["orders", "bad"],
		["invoices", id, "edit"],
		["checkouts", id, "pay"],
		["checkout", id],
	])
		assert.equal(commerceRoute(route), false);
	assert.equal(sellerAccountRoute(["orders", id]), true);
	assert.equal(sellerAccountRoute(["checkout"]), false);
	assert.equal(safeReturn("/en/cart", "en", "buyer"), "/en/cart");
	assert.equal(
		safeReturn("/en/account/buyer/invoices/bad", "en", "buyer"),
		"/en/account/buyer",
	);
	assert.equal(
		safeReturn("/en/account/seller/orders/" + id, "en", "buyer"),
		"/en/account/buyer",
	);
	assert.equal(
		invoiceHref("fa-AF", "seller", id, id),
		`/fa-AF/account/seller/invoices/${id}?seller=${id}`,
	);
});
test("estimates round per line exactly without binary money arithmetic", () => {
	assert.equal(estimate("0.04", "0.125"), "0.01");
	assert.equal(estimate("12.50", "0.125"), "1.56");
	assert.equal(
		estimate("999999999.99", "999999999.999"),
		"999999999989000000.00",
	);
	assert.equal(addQuantity("0.125", "1.875"), "2.000");
	for (const value of ["NaN", "1e2", "-1", "0.0001", " 1"])
		assert.throws(() => addQuantity("1.000", value));
});
test("unknown purchase keeps exact business payload across language remounts and scopes", () => {
	const packet = {
		command_id: id,
		version: 4,
		currency: "AFN",
		lines: [id],
		choices: [
			{ seller: id, country: "AF", city: "Kabul", method: "advance" as const },
		],
		shown_prices: [],
		locale: "en",
	};
	const first = retainIntent("identity:buyer", packet);
	packet.lines = [];
	assert.deepEqual(first.lines, [id]);
	assert.equal(pendingIntent("other:buyer"), undefined);
	assert.equal(
		retainIntent("identity:buyer", {
			...packet,
			command_id: crypto.randomUUID(),
			locale: "ar",
		}).command_id,
		id,
	);
	settleIntent("other:buyer");
	assert.ok(pendingIntent("identity:buyer"));
	clearCommerceIntents();
	assert.equal(pendingIntent("identity:buyer"), undefined);
});
test("commerce copy has equal four-language scope and truthful payment/delivery wording", () => {
	for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
		assert.deepEqual(
			Object.keys(commerceCopy[locale]).sort(),
			Object.keys(commerceCopy.en).sort(),
		);
		assert.ok(Object.values(commerceCopy[locale]).every((s) => s.length > 0));
	}
	assert.match(commerceCopy.en.delivery, /pending/);
	assert.match(commerceCopy.en.unreserved, /unreserved/);
	assert.match(commerceCopy.en.currentPrice, /current server prices/);
	assert.match(commerceCopy.en.wholesaleHelp, /approved/);
});

test("cart correction quantity defaults and validation preserve exact increment bounds", async () => {
	const { initialCartQuantity, validCartQuantity } = await import(
		"../features/cart/recovery.ts"
	);
	assert.equal(initialCartQuantity("2.000"), "2.000");
	assert.equal(initialCartQuantity("0.125"), "1.000");
	for (const q of [
		"0",
		"-1",
		"NaN",
		"1e2",
		"1.0001",
		"1000000000.000",
		"1.000",
	])
		assert.equal(validCartQuantity(q, "2.000"), false);
	assert.equal(validCartQuantity("2.000", "2.000"), true);
	assert.equal(validCartQuantity("0.375", "0.125"), true);
});
test("uncertain cart commands survive locale remounts in memory with exact scope and are cleared on session change", async () => {
	const { retainCartIntent, cartIntent, settleCartIntent } = await import(
		"../features/cart/recovery.ts"
	);
	const original = {
		command_id: "synthetic-original",
		version: 1,
		action: "set" as const,
		quantity: "2.000",
	};
	retainCartIntent("buyer-A:variant-A", original);
	retainCartIntent("buyer-A:variant-A", { ...original, quantity: "4.000" });
	assert.equal(cartIntent("buyer-A:variant-A")?.quantity, "2.000");
	assert.equal(cartIntent("buyer-B:variant-A"), undefined);
	settleCartIntent("buyer-A:variant-A");
	assert.equal(cartIntent("buyer-A:variant-A"), undefined);
	retainCartIntent("guest:variant-A", original);
	clearCommerceIntents();
	assert.equal(cartIntent("guest:variant-A"), undefined);
});
