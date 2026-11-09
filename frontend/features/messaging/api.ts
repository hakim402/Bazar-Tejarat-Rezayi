import { privateRequest } from "../../lib/api/private-client.ts";
import { uuidPattern } from "../../lib/routes/account-routes.ts";
import type { components } from "../../lib/api/schema.d";
export type Context = "buyer" | "seller";
export type Conversation = components["schemas"]["ConversationDetail"];
export type Inbox = components["schemas"]["ConversationPage"];
export type History = components["schemas"]["MessagingHistory"];
export type Message = components["schemas"]["MessageRow"];
export type ImageRef = components["schemas"]["ImageResult"];
export type Sent = components["schemas"]["Sent"];
export type Profiles = components["schemas"]["MessagingProfiles"];
export type ReportResult = components["schemas"]["ReportResult"] & { created_at?: string };
export type ReportTarget = "message" | "product" | "store" | "order";
export function reportPath(target: ReportTarget, id: string) {
	return target === "message" ? `messages/${id}/reports/` : `reports/${target}/${id}/`;
}
export type OwnReport = components["schemas"]["OwnReportResult"];
export type OwnReportPage = components["schemas"]["OwnReportPage"];
export function reportTargetHref(locale: string, context: Context, target: ReportTarget, id: string, seller?: string) {
	if (!uuidPattern.test(id)) return `/${locale}/account/${context}/notifications`;
	if (target === "product" || target === "store") return `/${locale}/${target === "product" ? "products" : "stores"}/${id}`;
	if (target === "order") return `/${locale}/account/${context}/${context === "buyer" ? "cancellations" : "aftercare"}/${id}${context === "seller" && seller && uuidPattern.test(seller) ? `?seller=${seller}` : ""}`;
	// Own message reports expose a message UUID, not a conversation UUID.
	return `/${locale}/account/${context}/messages`;
}
export function reportPacket(category: string, reason: string, key: string) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsafe control characters in user text.
	if (!uuidPattern.test(key) || !["abuse", "fraud", "spam", "privacy", "other"].includes(category) || reason.trim().length < 3 || reason.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/u.test(reason)) return null;
	return Object.freeze({ command_id: key, category, reason: reason.trim() });
}
export function messaging<T>(
	context: Context,
	path: string,
	data?: unknown,
	options?: { signal?: AbortSignal },
) {
	return privateRequest<T>(
		`messaging/${context}/${path}`,
		data,
		"POST",
		options,
	);
}
export function threadHref(
	locale: string,
	context: Context,
	id: string,
	seller?: string,
) {
	return `/${locale}/account/${context}/messages/${id}${context === "seller" && seller ? `?seller=${seller}` : ""}`;
}
export function localTimestamp(value: string, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		timeZone: "Asia/Kabul",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}
