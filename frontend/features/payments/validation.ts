export function moneyUnits(raw: string, zero = false): bigint | null {
	if (!/^(0|[1-9]\d{0,21})\.\d{2}$/.test(raw)) return null;
	const n = BigInt(raw.replace(".", ""));
	return (zero ? n >= BigInt("0") : n > BigInt("0")) &&
		n <= BigInt("999999999999999999999999")
		? n
		: null;
}
export function quantityUnits(raw: string): bigint | null {
	if (!/^(0|[1-9]\d{0,14})\.\d{3}$/.test(raw)) return null;
	const n = BigInt(raw.replace(".", ""));
	return n > BigInt("0") ? n : null;
}
export function actualTime(raw: string, now = Date.now()) {
	const time = Date.parse(raw);
	return Number.isFinite(time) && time <= now
		? new Date(time).toISOString()
		: null;
}
export function exactSelections(
	goods: { variant: string; quantity: string; increment: string }[],
	lines: { variant: string; batch: string | null; quantity: string }[],
) {
	if (!lines.length || lines.length > 100) return false;
	const seen = new Set<string>(),
		totals = new Map<string, bigint>();
	for (const l of lines) {
		const g = goods.find((g) => g.variant === l.variant),
			q = quantityUnits(l.quantity),
			increment = g ? quantityUnits(g.increment) : null,
			key = `${l.variant}:${l.batch ?? "plain"}`;
		if (
			!g ||
			q === null ||
			increment === null ||
			q % increment !== BigInt("0") ||
			seen.has(key)
		)
			return false;
		seen.add(key);
		totals.set(l.variant, (totals.get(l.variant) ?? BigInt("0")) + q);
	}
	return goods.every(
		(g) => totals.get(g.variant) === quantityUnits(g.quantity),
	);
}
