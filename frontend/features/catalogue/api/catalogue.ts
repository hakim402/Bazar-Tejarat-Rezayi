import { privateRequest } from "../../../lib/api/private-client.ts";
export function catalogueRequest<T>(
	context: string,
	path: string,
	data?: unknown,
	method = "POST",
) {
	return privateRequest<T>(`catalogue/${context}/${path}`, data, method);
}
