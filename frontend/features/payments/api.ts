import { privateRequest } from "../../lib/api/private-client.ts";
import type { Context } from "../messaging/api";
export type Capability =
	| "claim"
	| "receipt"
	| "correction"
	| "extension"
	| "selection"
	| "details"
	| "evidence";
export type Claim = {
	previous: string | null;
	replacement: string | null;
	id: string;
	amount: string;
	currency: string;
	paid_at: string;
	description: string;
	state: string;
	version: number;
	reason: string;
	evidence: string[];
	created_at: string;
};
export type Receipt = {
	id: string;
	claim: string | null;
	original_amount: string;
	amount: string;
	currency: string;
	paid_at: string;
	description: string;
	version: number;
	evidence: string[];
	review: string;
	created_at: string;
};
export type Plan = {
	id: string;
	replaces: string | null;
	intent_version: number;
	reason: string;
	state: string;
	lines: {
		variant: string;
		batch: string | null;
		quantity: string;
		sku: string;
		unit: string;
		unit_labels: Record<string, string>;
		batch_code: string;
		expires_on: string | null;
	}[];
};
export type Payment = {
	id: string;
	seller: string;
	buyer: string;
	invoice: string;
	number: string;
	currency: string;
	goods_total: string;
	payment_method: string;
	seller_name: string;
	buyer_name: string;
	confirmed_total: string;
	remaining: string;
	overpayment: string;
	financial: string;
	allocation: string;
	original_due_at: string | null;
	effective_due_at: string | null;
	deadline_generation: number;
	version: number;
	overdue: boolean;
	capabilities: Record<Capability, boolean>;
};
export type Detail = Payment & {
	claims: Claim[];
	receipts: Receipt[];
	corrections: {
		id: string;
		receipt: string;
		target_version: number;
		amount: string;
		paid_at: string;
		description: string;
		reason: string;
		state: string;
		evidence: string[];
	}[];
	cases: {
		id: string;
		kind: string;
		state: string;
		version: number;
		assigned: boolean;
	}[];
	extensions: {
		id: string;
		before_at: string;
		due_at: string;
		reason: string;
		generation: number;
	}[];
	plans: Plan[];
	history: {
		id: string;
		version: number;
		action: string;
		context: string;
		actor: string | null;
		created_at: string;
	}[];
	history_count: number;
	history_page: number;
	selection: {
		state: string;
		version: number;
		plan: string | null;
		allocation: string | null;
		shortage: string;
	} | null;
};
export type Profile = {
	id: string;
	name: string;
	write: boolean;
	evidence: boolean;
};
export type Selection = {
	count: number;
	page: number;
	maximum_buckets: number;
	goods: {
		variant: string;
		quantity: string;
		sku: string;
		unit: string;
		increment: string;
	}[];
	results: {
		bucket: string;
		variant: string;
		batch: string | null;
		code: string;
		expires_on: string | null;
		available: string;
		eligible: boolean;
	}[];
};
export type Outcome = {
	state?: string;
	outcome: Record<string, unknown>;
	current: Detail;
};
export type Intent = {
	key: string;
	path: string;
	body: Record<string, unknown> | FormData;
	upload: boolean;
};
const intents = new Map<string, Intent>();
export function retainPayment(scope: string, packet: Intent) {
	if (!intents.has(scope))
		intents.set(
			scope,
			packet.body instanceof FormData ? packet : structuredClone(packet),
		);
	return intents.get(scope) ?? packet;
}
export const pendingPayment = (scope: string) => intents.get(scope);
export const settlePayment = (scope: string) => intents.delete(scope);
export const clearPaymentIntents = () => intents.clear();
export function payment<T>(
	context: Context,
	path: string,
	data?: unknown,
	signal?: AbortSignal,
) {
	return privateRequest<T>(
		`payments/${context}/${path}`,
		data,
		data === undefined ? "GET" : "POST",
		{ signal },
	);
}
export function paymentHref(
	locale: string,
	context: Context,
	id?: string,
	seller?: string,
	page = 1,
	state = "",
) {
	const q = new URLSearchParams();
	if (seller) q.set("seller", seller);
	if (page > 1) q.set("page", String(page));
	if (state) q.set("state", state);
	return `/${locale}/account/${context}/payments${id ? `/${id}` : ""}${q.size ? `?${q}` : ""}`;
}
export function paymentReference(key: string | null) {
	const url = new URL(location.href);
	if (key) url.searchParams.set("payment_attempt", key);
	else url.searchParams.delete("payment_attempt");
	history.replaceState(null, "", url);
}

export type SelectionPreview = {
	variant: string;
	batch: string | null;
	sku: string;
	unit: string;
	code: string;
	quantity: string;
};
