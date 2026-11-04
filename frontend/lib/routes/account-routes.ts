// One strict registry for the seller dispatcher and navigation.
export const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type InventoryScreen =
	| "overview"
	| "inventory"
	| "movements"
	| "detail"
	| "receipt"
	| "adjustment"
	| "settings"
	| "batch";
export function sellerRoute(
	parts: string[] = [],
): { screen: InventoryScreen; variant?: string; batch?: string } | null {
	if (!parts.length) return { screen: "overview" };
	if (parts[0] !== "inventory") return null;
	if (parts.length === 1) return { screen: "inventory" };
	if (parts.length === 2 && parts[1] === "movements")
		return { screen: "movements" };
	if (!uuidPattern.test(parts[1])) return null;
	const variant = parts[1];
	if (parts.length === 2) return { screen: "detail", variant };
	if (parts.length === 3 && parts[2] === "settings")
		return { screen: "settings", variant };
	if (
		parts.length === 4 &&
		parts[3] === "new" &&
		["receipts", "adjustments"].includes(parts[2])
	)
		return {
			screen: parts[2] === "receipts" ? "receipt" : "adjustment",
			variant,
		};
	if (
		parts.length === 4 &&
		parts[2] === "batches" &&
		uuidPattern.test(parts[3])
	)
		return { screen: "batch", variant, batch: parts[3] };
	return null;
}
export type QueryReader = { get: (key: string) => string | null };
export function sellerHref(
	locale: string,
	path = "",
	seller?: string | null,
	filters?: QueryReader,
	changes: Record<string, string> = {},
) {
	const query = new URLSearchParams();
	if (seller) query.set("seller", seller);
	for (const key of ["q", "state", "sort", "page"]) {
		const value = filters?.get(key);
		if (value) query.set(key, value);
	}
	for (const [key, value] of Object.entries(changes)) {
		if (value) query.set(key, value);
		else query.delete(key);
	}
	return `/${locale}/account/seller${path ? `/${path}` : ""}${query.size ? `?${query}` : ""}`;
}

export function communicationRoute(parts: string[] = []): boolean {
	return (
		(parts.length === 1 && ["messages", "notifications"].includes(parts[0])) ||
		(parts.length === 2 &&
			parts[0] === "messages" &&
			uuidPattern.test(parts[1]))
	);
}
export function commerceRoute(parts: string[] = []): boolean {
	if (parts[0] === "payments")
		return (
			parts.length === 1 || (parts.length === 2 && uuidPattern.test(parts[1]))
		);
	if (parts[0] === "negotiations")
		return (
			parts.length === 1 ||
			(parts.length === 2 && (parts[1] === "new" || uuidPattern.test(parts[1])))
		);
	return (
		(parts.length === 1 &&
			["orders", "invoices", "checkouts", "checkout"].includes(parts[0])) ||
		(parts.length === 2 &&
			["orders", "invoices", "checkouts"].includes(parts[0]) &&
			uuidPattern.test(parts[1])) ||
		(parts.length === 3 &&
			parts[0] === "invoices" &&
			uuidPattern.test(parts[1]) &&
			parts[2] === "print")
	);
}
export function sellerAccountRoute(parts: string[] = []): boolean {
	if (parts[0] === "negotiations" && parts[1] === "new") return false;
	if (commerceRoute(parts) && !["checkouts", "checkout"].includes(parts[0]))
		return true;
	if (communicationRoute(parts)) return true;
	if (
		parts.length === 2 &&
		parts[0] === "settings" &&
		["store", "checkout"].includes(parts[1])
	)
		return true;
	if (sellerRoute(parts)) return true;
	if (["catalogue", "organizations"].includes(parts[0]))
		return (
			parts.length === 1 || (parts.length === 2 && uuidPattern.test(parts[1]))
		);
	return (
		parts.length === 1 &&
		["profile", "password", "link", "settings"].includes(parts[0])
	);
}
