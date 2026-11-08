import { privateRequest } from "../../lib/api/private-client.ts";
import { uuidPattern } from "../../lib/routes/account-routes.ts";
import type { Context, Domain, Intent, Recovery } from "./types";
export function aftercare<T>(domain: Domain, context: Context, path: string, data?: unknown, signal?: AbortSignal) {
	return privateRequest<T>(`${domain}/${context}/${path}`, data, data === undefined ? "GET" : "POST", { signal });
}
export function aftercareHref(locale: string, context: Context, order?: string, seller?: string, page = 1) {
	const query = new URLSearchParams();
	if (seller && context === "seller") query.set("seller", seller);
	if (page > 1) query.set("page", String(page));
	return `/${locale}/account/${context}/${context === "buyer" ? "cancellations" : "aftercare"}${order ? `/${order}` : ""}${query.size ? `?${query}` : ""}`;
}
export const orderAftercarePath = (order: string) => `aftercare/${order}/`;
const attempts = new Map<string, Intent>();
export function retainAftercare(scope: string, intent: Intent) {
	if (!attempts.has(scope)) attempts.set(scope, intent.body instanceof FormData ? { ...intent, body: new FormData() } : structuredClone(intent));
	const retained = attempts.get(scope) ?? intent;
	if (intent.body instanceof FormData && retained.body instanceof FormData && !retained.body.has("command_id")) {
		for (const [name, value] of intent.body.entries()) retained.body.append(name, value);
	}
	return retained;
}
export const pendingAftercare = (scope: string) => attempts.get(scope);
export const settleAftercare = (scope: string) => attempts.delete(scope);
export const clearAftercare = () => attempts.clear();
export function aftercareDomain(value: unknown): Domain | null {
	return value === "orders" || value === "payments" || value === "fulfilment" ? value : null;
}
export function aftercareReference(key: string | null, domain?: Domain) {
	const url = new URL(location.href);
	if (key !== null) {
		const validatedDomain = aftercareDomain(domain);
		if (!uuidPattern.test(key) || !validatedDomain) throw Error("Invalid aftercare reference");
		// Only an opaque command key and its non-sensitive domain survive reload.
		url.searchParams.set("aftercare_attempt", key);
		url.searchParams.set("aftercare_domain", validatedDomain);
	} else {
		url.searchParams.delete("aftercare_attempt");
		url.searchParams.delete("aftercare_domain");
	}
	history.replaceState(history.state, "", url);
}
export function recoveryPath(domain: Domain, order: string, key: string) {
	return `orders/${order}/${domain === "orders" ? "aftercare-commands" : "commands"}/${key}/reconcile/`;
}
export function recoveryState(value: Recovery) {
	if (value.state === "applied" || value.state === "committed") return "applied";
	if (value.state === "rejected" || value.state === "absent_fenced") return "absent";
	return "unknown";
}
