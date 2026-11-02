import { privateRequest } from "../../lib/api/private-client.ts";
import type { Context } from "../messaging/api";
export type Line = {
	variant: string;
	tier: "retail" | "wholesale";
	quantity: string;
	unit_price: string;
	max_quantity: string;
	max_unit_price: string;
};
export type Choice = {
	seller: string;
	country: string;
	city: string;
	method: "advance" | "cod" | "";
};
export type Proposal = {
	lines: Line[];
	choice: Choice;
	explanation: "seller-finalizes-v1";
	note: string;
	context?: {
		buyer: string;
		seller: string;
		terms: unknown;
		products: Record<string, unknown>[];
	};
	goods_total?: string;
};
export type RequestRow = {
	id: string;
	seller: string;
	buyer: string;
	seller_name: string;
	currency: string;
	state:
		| "submitted"
		| "correction_requested"
		| "accepted"
		| "rejected"
		| "withdrawn";
	version: number;
	revision: number;
	created_at: string;
	proposal: Proposal;
	history_count: number;
	history_page: number;
	history: {
		actor?: string;
		action: string;
		version?: number;
		revision: number;
		reason?: string;
		at: string;
		state?: { final?: { lines: Line[]; choice: Choice } };
		proposal?: Proposal;
	}[];
	actions: string[];
	order: string | null;
	invoice: string | null;
};
export type Result = {
	id?: string;
	rejected?: boolean;
	state?: string;
	version?: number;
	order?: string;
	invoice?: string;
	pending?: boolean;
	currency?: string;
	outcomes?: {
		seller: string;
		state: string;
		code: string;
		request: string | null;
	}[];
};
export type Pending = {
	key: string;
	path: string;
	body: Record<string, unknown>;
	kind: "submission" | "action";
};
const pending = new Map<string, Pending>();
export const getIntent = (scope: string) => pending.get(scope);
export function retain(scope: string, value: Pending) {
	if (!pending.has(scope)) pending.set(scope, structuredClone(value));
	return pending.get(scope) ?? value;
}
export const settle = (scope: string) => pending.delete(scope);
export const clearNegotiationIntents = () => pending.clear();
export function negotiation<T>(
	context: Context,
	path: string,
	data?: unknown,
	signal?: AbortSignal,
) {
	return privateRequest<T>(
		`orders/${context}/${path}`,
		data,
		data === undefined ? "GET" : "POST",
		{ signal },
	);
}
export function requestHref(
	locale: string,
	context: Context,
	id?: string,
	seller?: string,
) {
	return `/${locale}/account/${context}/negotiations${id ? `/${id}` : ""}${seller ? `?seller=${seller}` : ""}`;
}
export function reference(key: string | null) {
	const url = new URL(location.href);
	if (key) url.searchParams.set("negotiation_command", key);
	else url.searchParams.delete("negotiation_command");
	history.replaceState(null, "", url);
}

export type PreviewResult = {
	goods_total?: string;
	results?: { seller: string; code: string; goods_total?: string }[];
};
export type FinalPreviewResult = {
	binding: false;
	goods_total: string;
	proposal: Proposal;
	final: {
		lines: Pick<Line, "variant" | "tier" | "quantity" | "unit_price">[];
		choice: Choice;
	};
	version: number;
};
export function productContext(
	proposal: Proposal,
	variant: string,
	index: number,
) {
	return (
		proposal.context?.products.find((p) => p.variant === variant) ??
		proposal.context?.products[index]
	);
}
export function productText(
	product: Record<string, unknown> | undefined,
	locale: string,
	fallback: string,
) {
	const titles = (product?.titles ?? {}) as Record<string, string>,
		source = String(product?.source_locale ?? "fa-AF"),
		units = (product?.unit_labels ?? {}) as Record<string, string>;
	return {
		title: titles[locale] ?? titles[source] ?? fallback,
		source: titles[locale] ? null : source,
		unit: units[locale] ?? String(product?.unit ?? ""),
	};
}
