import { guestRead } from "../cart/transport.ts";
import { privateRequest, AccountError } from "../../lib/api/private-client.ts";
import { apiOrigin } from "../../lib/api/client.ts";
import type { Context } from "../messaging/api";
export type CartContext = Context | "guest";
export type Line = {
	id: string;
	version: number;
	variant: string;
	product: string;
	seller: string;
	seller_name: string;
	sku: string;
	tier: "retail" | "wholesale";
	quantity: string;
	increment: string;
	minimum: string;
	unit: string;
	unit_label: string;
	title: string;
	currency: "AFN" | "USD";
	mode: "fixed" | "negotiable";
	price: string | null;
	available: boolean;
};
export type Cart = {
	guest_scope?: string | null;
	id: string | null;
	version: number;
	guest_version: number;
	lines: Line[];
};
export type Terms = {
	seller: string;
	version: number;
	enabled: boolean;
	destinations: {
		uiKey?: string;
		country: string;
		all_cities: boolean;
		cities: string[];
	}[];
	methods: ("advance" | "cod")[];
};
export type Profile = {
	id: string;
	name: string;
	orders: boolean;
	invoices: boolean;
	terms: boolean;
};
export type Submission = {
	id: string;
	pending: boolean;
	currency: string;
	created_at: string;
	outcomes: {
		seller: string;
		state: "pending" | "accepted" | "failed";
		code: string;
		order: string | null;
		invoice: string | null;
		number: string | null;
		goods_total: string | null;
		accepted_at: string | null;
		price_changed: boolean;
	}[];
};
export type Choice = {
	seller: string;
	country: string;
	city: string;
	method: "advance" | "cod";
};
export type Packet = {
	command_id: string;
	version: number;
	currency: string;
	lines: string[];
	choices: Choice[];
	shown_prices: { line: string; price: string }[];
	locale: string;
};
export type OrderLine = {
	image?: string | null;
	id: string;
	variant: string;
	tier: "retail" | "wholesale";
	quantity: string;
	unit_price: string;
	goods_amount: string;
	snapshot: {
		titles: Record<string, string>;
		source_locale: string;
		sku: string;
		unit: string;
		unit_labels: Record<string, string>;
		definition: {
			attributes?: Record<string, string | number | boolean>;
			contents?: string;
			[key: string]: unknown;
		};
		attribute_labels?: Record<string, Record<string, string>>;
		increment: string;
		minimum: string;
		price_changed: boolean;
		max_quantity?: string;
		max_unit_price?: string;
		buyer_revision?: number;
		shown_price?: string | null;
	};
};
export type OrderPayment = {
	accepted_total: string;
	confirmed_total: string;
	received: string;
	refunded: string;
	refund_due: string;
	refundable_excess: string;
	remaining: string;
	overpayment: string;
	financial: string;
	allocation: string;
	original_due_at: string | null;
	effective_due_at: string | null;
	deadline_generation: number;
	version: number;
	overdue: boolean;
};
export type Order = {
	customer?: { name: string; email: string };
	id: string;
	seller: string;
	currency: string;
	goods_total: string;
	payment_method: "advance" | "cod";
	accepted_at: string;
	issued_at: string;
	due_at: string | null;
	invoice: string;
	number: string;
	snapshot: {
		seller: string;
		buyer: string;
		origin?: "negotiated";
		terms: Terms & { destination: { country: string; city: string } };
	};
	payment: OrderPayment;
	dimensions: Record<string, string>;
	capabilities: Record<string, boolean>;
	lines: OrderLine[];
};
export type Page<T> = { results: T[]; page: number; count: number };
export function commerce<T>(
	path: string,
	data?: unknown,
	method = "POST",
	signal?: AbortSignal,
) {
	if (path.startsWith("cart/guest/?") || path === "cart/guest/") {
		if (data === undefined) return guestRead<T>(path, signal);
	}
	return privateRequest<T>(path, data, method, { signal });
}
export const cartPath = (context: CartContext) => `cart/${context}/`;
export function invoiceHref(
	locale: string,
	context: Context,
	id: string,
	seller?: string | null,
) {
	return `/${locale}/account/${context}/invoices/${id}${seller ? `?seller=${seller}` : ""}`;
}
export async function downloadInvoice(
	context: Context,
	id: string,
	locale: string,
	signal: AbortSignal,
) {
	const base = apiOrigin(process.env.NEXT_PUBLIC_API_URL);
	const response = await fetch(
		`${base}/api/v1/orders/${context}/invoices/${id}/pdf/?locale=${encodeURIComponent(locale)}`,
		{
			credentials: "include",
			cache: "no-store",
			signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
			headers: { Accept: "application/pdf" },
		},
	);
	if (
		!response.ok ||
		!response.headers.get("content-type")?.includes("application/pdf")
	)
		throw new AccountError(response.status);
	const blob = await response.blob();
	if (signal.aborted) return;
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `invoice-${id}.pdf`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Exact arithmetic is for estimates only. The server alone accepts invoice amounts.
export function estimate(price: string, quantity: string) {
	const cents = BigInt(price.replace(".", "")),
		units = BigInt(quantity.replace(".", ""));
	const n = (cents * units + BigInt(500)) / BigInt(1000);
	return `${n / BigInt(100)}.${String(n % BigInt(100)).padStart(2, "0")}`;
}
export function addQuantity(a: string, b: string) {
	const parse = (s: string) => {
		if (!/^\d{1,9}(\.\d{1,3})?$/.test(s)) throw new AccountError(400);
		const [w, f = ""] = s.split(".");
		return BigInt(w) * BigInt(1000) + BigInt(f.padEnd(3, "0"));
	};
	const n = parse(a) + parse(b);
	return `${n / BigInt(1000)}.${String(n % BigInt(1000)).padStart(3, "0")}`;
}

export function estimateTotal(lines: Pick<Line, "price" | "quantity">[]) {
	if (lines.some((x) => x.price === null)) return null;
	let n = BigInt(0);
	for (const line of lines) {
		if (line.price !== null)
			n += BigInt(estimate(line.price, line.quantity).replace(".", ""));
	}
	return `${n / BigInt(100)}.${String(n % BigInt(100)).padStart(2, "0")}`;
}
