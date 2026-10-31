import { privateRequest } from "../../lib/api/private-client.ts";
import type { components } from "../../lib/api/schema.d";
export type Context = "buyer" | "seller";
export type Conversation = components["schemas"]["ConversationDetail"];
export type Inbox = components["schemas"]["ConversationPage"];
export type History = components["schemas"]["MessagingHistory"];
export type Message = components["schemas"]["MessageRow"];
export type ImageRef = components["schemas"]["ImageResult"];
export type Sent = components["schemas"]["Sent"];
export type Profiles = components["schemas"]["MessagingProfiles"];
export type ReportResult = components["schemas"]["ReportResult"];
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
