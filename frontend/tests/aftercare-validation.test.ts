import test from "node:test";
import assert from "node:assert/strict";
import {
	validDecrease, lineAmount, amendedTotal, withinBound, exactDue,
	validReason, validEvidence,
} from "../features/aftercare/validation.ts";
import type { Line } from "../features/aftercare/types";

const original: Line = {
	line: "accepted-line", variant: "accepted-variant", tier: "retail",
	quantity: "3.000", unit_price: "12.50", goods_amount: "37.50",
	increment: "0.500", minimum_wholesale: "2.000",
};
const decrease = { ...original, quantity: "2.000", unit_price: "10.00" };

test("aftercare decrease preserves accepted line, variant and tier identity", () => {
	assert.equal(validDecrease(original, decrease), true);
	for (const field of ["line", "variant", "tier"] as const)
		assert.equal(validDecrease(original, { ...decrease, [field]: "substitute" }), false);
});
test("aftercare rejects zero, increased or unchanged quantity and increased price", () => {
	for (const quantity of ["0.000", "3.000", "3.500", "-1.000", "2e0", "2.0001"])
		assert.equal(validDecrease(original, { ...decrease, quantity }), false);
	assert.equal(validDecrease(original, { ...decrease, unit_price: "12.51" }), false);
	assert.equal(validDecrease(original, { ...decrease, unit_price: original.unit_price }), true);
});
test("aftercare enforces current increments without floating point rounding", () => {
	assert.equal(validDecrease(original, { ...decrease, quantity: "2.001" }), false);
	assert.equal(validDecrease(original, { ...decrease, quantity: "2.500" }), true);
});
test("aftercare wholesale minimum does not become a retail minimum", () => {
	const after = { ...decrease, quantity: "1.500" };
	assert.equal(validDecrease(original, after), true);
	assert.equal(validDecrease({ ...original, tier: "wholesale" }, { ...after, tier: "wholesale" }), false);
	assert.equal(validDecrease({ ...original, tier: "wholesale" }, { ...decrease, tier: "wholesale" }), true);
});
test("aftercare unit price accepts exact bounded positive decimal strings only", () => {
	for (const unit_price of ["0.00", "1", "01.00", "1.001", "1e1", "NaN", "-1.00", "1000000000.00"])
		assert.equal(validDecrease(original, { ...decrease, unit_price }), false);
});
test("aftercare rounds each line half up before adding the accepted total", () => {
	assert.equal(lineAmount({ quantity: "0.500", unit_price: "0.01" }), "0.01");
	assert.equal(lineAmount({ quantity: "0.499", unit_price: "0.01" }), "0.00");
	const a = { ...original, quantity: "0.500", unit_price: "0.01" };
	assert.equal(amendedTotal([a, { ...a, line: "second" }], []), "0.02");
});
test("aftercare totals keep unchanged lines and reject invalid changed arithmetic", () => {
	const second = { ...original, line: "second", quantity: "1.000" };
	assert.equal(amendedTotal([original, second], [decrease]), "32.50");
	assert.equal(amendedTotal([original], [{ ...decrease, quantity: "NaN" }]), null);
	assert.equal(lineAmount({ quantity: "1.000", unit_price: "1.001" }), null);
});
test("aftercare refund bounds remain exact above Number safe integers", () => {
	const bound = "9999999999999999999999.98";
	assert.equal(withinBound(bound, bound), true);
	assert.equal(withinBound("9999999999999999999999.99", bound), false);
	assert.equal(withinBound("0.01", "0.00"), false);
	for (const amount of ["0.00", "-0.01", "1e2", "1.001", "01.00"])
		assert.equal(withinBound(amount, "100.00"), false);
});
test("aftercare refund reports require the exact due, not a partial or rounded amount", () => {
	assert.equal(exactDue("12.50", "12.50"), true);
	for (const amount of ["12.49", "12.51", "12.500", "0.00", "12.5"])
		assert.equal(exactDue(amount, "12.50"), false);
});
test("aftercare reasons enforce trimmed minimum and raw maximum lengths", () => {
	assert.equal(validReason("  valid reason  "), true);
	assert.equal(validReason(" x "), false);
	assert.equal(validReason("   "), false);
	assert.equal(validReason("x".repeat(1000)), true);
	assert.equal(validReason("x".repeat(1001)), false);
});
test("aftercare evidence accepts three bounded private raster images only", () => {
	for (const type of ["image/jpeg", "image/png", "image/webp"])
		assert.equal(validEvidence({ type, size: 5 * 1024 * 1024 }, 2), true);
	for (const type of ["image/svg+xml", "application/pdf", "text/html", ""])
		assert.equal(validEvidence({ type, size: 1 }, 0), false);
	assert.equal(validEvidence({ type: "image/png", size: 0 }, 0), false);
	assert.equal(validEvidence({ type: "image/png", size: 5 * 1024 * 1024 + 1 }, 0), false);
	assert.equal(validEvidence({ type: "image/png", size: 1 }, 3), false);
});
