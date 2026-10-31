import { privateRequest } from "../../lib/api/private-client";
import type { components } from "../../lib/api/schema.d";
import type { Context } from "../messaging/api";
export type Counts = components["schemas"]["Counts"];
export type Preference = components["schemas"]["EmailPreference"];
export type Notices = components["schemas"]["NoticePage"];
export function notification<T>(
	context: Context,
	path: string,
	data?: unknown,
	method = "POST",
	options?: { signal?: AbortSignal },
) {
	return privateRequest<T>(
		`notifications/${context}/${path}`,
		data,
		method,
		options,
	);
}
