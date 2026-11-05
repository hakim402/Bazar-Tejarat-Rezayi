import { moneyUnits, actualTime } from "../payments/validation.ts";
import type { StockLine } from "./types";
export { moneyUnits, actualTime };
export function quantityUnits(raw: string): bigint | null {
	if (!/^(0|[1-9]\d{0,8})\.\d{3}$/.test(raw)) return null;
	const value = BigInt(raw.replace(".", ""));
	return value > BigInt(0) ? value : null;
}
export function wholeSelection(
	goods: { variant: string; quantity: string }[],
	lines: StockLine[],
) {
	if (!lines.length || lines.length > 100) return false;
	const wanted = new Map<string, bigint>(),
		totals = new Map<string, bigint>(),
		seen = new Set<string>();
	for (const g of goods) {
		const quantity = quantityUnits(g.quantity);
		if (quantity === null) return false;
		wanted.set(g.variant, (wanted.get(g.variant) ?? BigInt(0)) + quantity);
	}
	for (const line of lines) {
		const quantity = quantityUnits(line.quantity),
			key = `${line.variant}:${line.batch ?? "plain"}`;
		if (quantity === null || seen.has(key) || !wanted.has(line.variant))
			return false;
		seen.add(key);
		totals.set(
			line.variant,
			(totals.get(line.variant) ?? BigInt(0)) + quantity,
		);
	}
	return [...wanted].every(([id, quantity]) => totals.get(id) === quantity);
}
