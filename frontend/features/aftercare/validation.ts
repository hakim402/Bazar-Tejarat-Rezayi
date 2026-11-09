import { moneyUnits } from "../payments/validation.ts";
import { quantityUnits } from "../fulfilment/validation.ts";
import type { Line } from "./types";
export function validDecrease(before: Line, after: Line) {
	const quantity = quantityUnits(after.quantity), current = quantityUnits(before.quantity), price = moneyUnits(after.unit_price), oldPrice = moneyUnits(before.unit_price);
	if (before.line !== after.line || before.variant !== after.variant || before.tier !== after.tier || quantity === null || current === null || price === null || oldPrice === null || quantity >= current || price > oldPrice || !/^\d{1,9}\.\d{2}$/.test(after.unit_price)) return false;
	const increment = before.increment ? quantityUnits(before.increment) : null;
	const minimum = before.minimum_wholesale ? quantityUnits(before.minimum_wholesale) : null;
	return !(increment && quantity % increment !== BigInt(0)) && !(before.tier === "wholesale" && minimum && quantity < minimum);
}
export function lineAmount(line: Pick<Line, "quantity" | "unit_price">): string | null {
	const quantity = quantityUnits(line.quantity), price = moneyUnits(line.unit_price);
	if (quantity === null || price === null) return null;
	const cents = (quantity * price + BigInt(500)) / BigInt(1000);
	return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
export function amendedTotal(current: Line[], changes: Line[]): string | null {
	let total = BigInt(0);
	for (const before of current) {
		const amount = lineAmount(changes.find((line) => line.line === before.line) ?? before);
		if (amount === null) return null;
		total += BigInt(amount.replace(".", ""));
	}
	return `${total / BigInt(100)}.${String(total % BigInt(100)).padStart(2, "0")}`;
}
export function withinBound(amount: string, bound: string) {
	const value = moneyUnits(amount), maximum = moneyUnits(bound, true);
	return value !== null && maximum !== null && value <= maximum;
}
export function exactDue(amount: string, due: string) {
	const value = moneyUnits(amount);
	return value !== null && value === moneyUnits(due);
}
export function safeText(value: string) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsafe control characters in user text.
	return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/u.test(value);
}
export function validReason(value: string) {
	return value.trim().length >= 3 && value.length <= 1000 && safeText(value);
}
export function validReview(rating: string, text: string) {
	return /^[1-5]$/.test(rating) && text.trim().length >= 3 && text.length <= 2000 && safeText(text);
}
export function validEvidence(file: Pick<File, "size" | "type">, count: number) {
	return count < 3 && file.size > 0 && file.size <= 5 * 1024 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}
