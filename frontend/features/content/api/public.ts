import { ApiError, apiOrigin } from "../../../lib/api/client.ts";
import type { Content, ContentList, ContentShell } from "../types";
export function validContent(value: unknown): value is Content {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<Content>;
	return (
		typeof v.key === "string" &&
		typeof v.revision === "string" &&
		typeof v.number === "number" &&
		["fa-AF", "en", "ps", "ar"].includes(v.content_locale ?? "") &&
		typeof v.fallback === "boolean" &&
		Array.isArray(v.available_locales) &&
		!!v.payload &&
		typeof v.payload.title === "string" &&
		Array.isArray(v.payload.blocks) &&
		v.payload.blocks.every(
			(b) =>
				!!b &&
				typeof b.id === "string" &&
				typeof b.type === "string" &&
				typeof b.title === "string" &&
				typeof b.text === "string" &&
				Array.isArray(b.links) &&
				Array.isArray(b.items),
		)
	);
}
export async function publicCall<T>(
	origin: string | undefined,
	path: string,
	validate: (value: unknown) => value is T,
): Promise<T | null> {
	try {
		const response = await fetch(
			`${apiOrigin(origin)}/api/v1/content/public/${path}`,
			{
				cache: "no-store",
				credentials: "omit",
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(5000),
			},
		);
		if (response.status === 404) return null;
		if (!response.ok) throw new ApiError("unavailable", response.status);
		if (!response.headers.get("content-type")?.includes("application/json"))
			throw new ApiError("invalid");
		const data: unknown = await response.json();
		if (!validate(data)) throw new ApiError("invalid");
		return data;
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError("unavailable");
	}
}
export const validShell = (v: unknown): v is ContentShell =>
	!!v &&
	typeof v === "object" &&
	["navigation", "support", "announcement"].every(
		(k) =>
			k in v &&
			((v as Record<string, unknown>)[k] === null ||
				validContent((v as Record<string, unknown>)[k])),
	);
export const validList = (v: unknown): v is ContentList =>
	!!v &&
	typeof v === "object" &&
	"results" in v &&
	Array.isArray(v.results) &&
	v.results.every(validContent) &&
	"count" in v &&
	typeof v.count === "number" &&
	"page" in v &&
	typeof v.page === "number";
export function contentPath(locale: string, key: string) {
	return `${locale}/${key === "home" ? "home/" : `pages/${key}/`}`;
}
