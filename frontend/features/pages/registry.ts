import { marketplaceRoute } from "../../lib/routes/marketplace-routes.ts";
/** Public CMS page summary delivered inside the site settings payload. */
export type PageSummary = {
	slug: string;
	path: string;
	group: "company" | "help" | "legal" | "hidden";
	kind: "page" | "article" | "contact" | "help-index";
	title: string;
	intro: string;
	position: number;
	show_in_footer: boolean;
};
export const pageGroups = ["company", "help", "legal", "hidden"] as const;
export const pageKinds = ["page", "article", "contact", "help-index"] as const;
export const slugPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export function pagePath(kind: PageSummary["kind"], slug: string): string {
	return kind === "article" ? `/help/${slug}` : `/${slug}`;
}
export function destinationAllowed(
	value: string,
	cmsPaths?: ReadonlySet<string>,
): boolean {
	if (!value) return true;
	if (
		/[\s\\]/u.test(value) ||
		[...value].some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		)
	)
		return false;
	if (value.startsWith("/"))
		return (
			value === "/" ||
			value === "/help" ||
			value === "/contact" ||
			!!cmsPaths?.has(value) ||
			!!marketplaceRoute(value) ||
			/^\/catalogue-preview\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
				value,
			) ||
			["dried-fruit", "clothing", "beauty", "furniture"].some(
				(name) => value === `/#demo-product-${name}`,
			) ||
			[
				"/auth/buyer-sign-in",
				"/auth/seller-sign-in",
				"/auth/buyer-registration",
				"/auth/seller-registration",
			].includes(value)
		);
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.port &&
			url.hostname.includes(".") &&
			!/^\d[\d.]*$/.test(url.hostname) &&
			!/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
		);
	} catch {
		return false;
	}
}
