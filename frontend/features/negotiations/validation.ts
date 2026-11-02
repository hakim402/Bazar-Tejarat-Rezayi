import type { Line } from "./api";
export function validateLines(lines: Line[]) {
	const units = (s: string, scale: number) => {
		if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${scale}})?$`).test(s))
			return BigInt(0);
		const [whole, fraction = ""] = s.split(".");
		return BigInt(whole + fraction.padEnd(scale, "0"));
	};
	return (
		lines.length > 0 &&
		lines.every((l) => {
			const q = units(l.quantity, 3),
				mq = units(l.max_quantity, 3),
				p = units(l.unit_price, 2),
				mp = units(l.max_unit_price, 2);
			return (
				q > BigInt(0) &&
				mq > BigInt(0) &&
				p > BigInt(0) &&
				mp > BigInt(0) &&
				q <= mq &&
				p <= mp &&
				/^\d{1,9}\.\d{2}$/.test(l.unit_price) &&
				/^\d{1,9}\.\d{2}$/.test(l.max_unit_price)
			);
		})
	);
}

// Informational goods amounts use the server's per-line two-place HALF_UP rule.
export function lineCents(
	line: Pick<Line, "quantity" | "unit_price">,
): bigint | null {
	if (
		!/^\d{1,9}(\.\d{1,3})?$/.test(line.quantity) ||
		!/^\d{1,9}\.\d{2}$/.test(line.unit_price)
	)
		return null;
	const [q, f = ""] = line.quantity.split("."),
		[p, c] = line.unit_price.split(".");
	const quantity = BigInt(q + f.padEnd(3, "0")),
		price = BigInt(p + c);
	return quantity > BigInt(0) && price > BigInt(0)
		? (quantity * price + BigInt(500)) / BigInt(1000)
		: null;
}
export function moneyText(cents: bigint | null): string {
	if (cents === null) return "—";
	const value = cents.toString().padStart(3, "0");
	return `${value.slice(0, -2)}.${value.slice(-2)}`;
}
export function goodsTotal(lines: Line[]): string {
	const cents = lines.map(lineCents);
	return moneyText(
		cents.length && cents.every((c) => c !== null)
			? cents.reduce<bigint>((sum, c) => sum + (c ?? BigInt(0)), BigInt(0))
			: null,
	);
}
