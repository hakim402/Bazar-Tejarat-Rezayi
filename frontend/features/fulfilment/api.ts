import { privateRequest } from "../../lib/api/private-client.ts";
import type { Context, Intent } from "./types";
export function fulfilment<T>(
	context: Context,
	path: string,
	data?: unknown,
	signal?: AbortSignal,
) {
	return privateRequest<T>(
		`fulfilment/${context}/${path}`,
		data,
		data === undefined ? "GET" : "POST",
		{ signal },
	);
}
export function fulfilmentHref(
	locale: string,
	context: Context,
	id?: string,
	seller?: string,
	page = 1,
	state = "",
	search = "",
) {
	const query = new URLSearchParams();
	if (seller) query.set("seller", seller);
	if (page > 1) query.set("page", String(page));
	if (state) query.set("state", state);
	if (search) query.set("q", search);
	return `/${locale}/account/${context}/${context === "buyer" ? "deliveries" : "fulfilment"}${id ? `/${id}` : ""}${query.size ? `?${query}` : ""}`;
}
const pending = new Map<string, Intent>();
export const pendingFulfilment = (scope: string) => pending.get(scope);
export function retainFulfilment(scope: string, intent: Intent) {
	if (!pending.has(scope))
		pending.set(
			scope,
			intent.body instanceof FormData ? intent : structuredClone(intent),
		);
	return pending.get(scope) ?? intent;
}
export const settleFulfilment = (scope: string) => pending.delete(scope);
export const clearFulfilmentIntents = () => pending.clear();
export function fulfilmentReference(key: string | null) {
	const url = new URL(location.href);
	if (key) url.searchParams.set("fulfilment_attempt", key);
	else url.searchParams.delete("fulfilment_attempt");
	history.replaceState(null, "", url);
}
