import { test } from "node:test";
import assert from "node:assert/strict";
import {
	commerceRoute,
	sellerAccountRoute,
} from "../lib/routes/account-routes.ts";
import { negotiationCopy } from "../features/negotiations/copy.ts";
import {
	retain,
	getIntent,
	settle,
	clearNegotiationIntents,
	requestHref,
} from "../features/negotiations/api.ts";
test("negotiation routes preserve strict private roles and static builder", () => {
	assert.equal(commerceRoute(["negotiations", "new"]), true);
	assert.equal(sellerAccountRoute(["negotiations", "new"]), false);
	assert.equal(commerceRoute(["negotiations", "forged"]), false);
	assert.equal(commerceRoute(["negotiations", "new", "extra"]), false);
	assert.match(
		requestHref(
			"ar",
			"seller",
			"00000000-0000-4000-8000-000000000001",
			"00000000-0000-4000-8000-000000000002",
		),
		/\?seller=/,
	);
});
test("uncertain negotiation intent cannot silently change payload or cross scope", () => {
	const first = {
		key: "original",
		path: "negotiations/id/finalize/",
		body: { quantity: "2.000" },
		kind: "action" as const,
	};
	retain("a", first);
	first.body.quantity = "99.000";
	assert.equal(retain("a", { ...first, key: "replacement" }).key, "original");
	assert.equal(getIntent("a")?.body.quantity, "2.000");
	assert.equal(getIntent("b"), undefined);
	settle("a");
	assert.equal(getIntent("a"), undefined);
	retain("b", first);
	clearNegotiationIntents();
	assert.equal(getIntent("b"), undefined);
});
test("four locale copy is complete and explains caps, finalization and no expiry", () => {
	for (const copy of Object.values(negotiationCopy)) {
		assert.deepEqual(
			Object.keys(copy).sort(),
			Object.keys(negotiationCopy.en).sort(),
		);
		for (const key of [
			"explanation",
			"ack",
			"maxPrice",
			"maxQuantity",
			"noExpiry",
			"finalNotice",
		] as const)
			assert.ok(copy[key].length > 5);
	}
});

import { validateLines } from "../features/negotiations/validation.ts";
test("binding decimal limits reject nonfinite, missing, overflow and above-cap values exactly", () => {
	const line = {
		variant: "id",
		tier: "retail" as const,
		quantity: "999999999.999",
		max_quantity: "999999999.999",
		unit_price: "999999999.99",
		max_unit_price: "999999999.99",
	};
	assert.equal(validateLines([line]), true);
	for (const value of [
		"0.00",
		"-1.00",
		"NaN",
		"Infinity",
		"1000000000.00",
		"1.234",
		"",
	])
		assert.equal(validateLines([{ ...line, unit_price: value }]), false, value);
	assert.equal(
		validateLines([{ ...line, quantity: "2.001", max_quantity: "2.000" }]),
		false,
	);
	assert.equal(
		validateLines([{ ...line, unit_price: "15.01", max_unit_price: "15.00" }]),
		false,
	);
});

import {
	lineCents,
	moneyText,
	goodsTotal,
} from "../features/negotiations/validation.ts";
import { productText, productContext } from "../features/negotiations/api.ts";
test("negotiated amounts round each decimal line HALF_UP before summing", () => {
	assert.equal(
		moneyText(lineCents({ quantity: "0.500", unit_price: "0.01" })),
		"0.01",
	);
	assert.equal(
		moneyText(lineCents({ quantity: "0.125", unit_price: "12.50" })),
		"1.56",
	);
	const line = {
		variant: "a",
		tier: "retail" as const,
		quantity: "0.500",
		unit_price: "0.01",
		max_unit_price: "1.00",
		max_quantity: "1.000",
	};
	assert.equal(goodsTotal([line, line]), "0.02");
	assert.equal(
		moneyText(lineCents({ quantity: "NaN", unit_price: "1.00" })),
		"—",
	);
});
test("proposal context follows variant identity and requested locale through reordered final lines", () => {
	const context = {
		products: [
			{
				variant: "b",
				titles: { en: "English B", "fa-AF": "ب" },
				source_locale: "fa-AF",
				unit_labels: { en: "Piece" },
				unit: "piece",
			},
			{ variant: "a", titles: { "fa-AF": "الف" }, source_locale: "fa-AF" },
		],
		buyer: "Buyer",
		seller: "Seller",
		terms: {},
	};
	const proposal = {
		context,
		lines: [],
		choice: {
			seller: "s",
			country: "AF",
			city: "kabul",
			method: "cod" as const,
		},
		explanation: "seller-finalizes-v1" as const,
		note: "",
	};
	assert.equal(
		productText(productContext(proposal, "b", 1), "en", "fallback").title,
		"English B",
	);
	assert.equal(
		productText(productContext(proposal, "a", 0), "en", "fallback").source,
		"fa-AF",
	);
});
