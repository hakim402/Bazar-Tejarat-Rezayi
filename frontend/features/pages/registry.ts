/** Only public destinations delivered through Phase 6. SEO overrides cannot add routes. */
export const pages = {
	home: { path: "", kind: "home" },
	"how-it-works": { path: "/how-it-works", kind: "page" },
	wholesale: { path: "/wholesale", kind: "page" },
	sell: { path: "/sell", kind: "page" },
	about: { path: "/about", kind: "page" },
	contact: { path: "/contact", kind: "page" },
	terms: { path: "/terms", kind: "legal" },
	privacy: { path: "/privacy", kind: "legal" },
	help: { path: "/help", kind: "help" },
	"payment-and-delivery": {
		path: "/help/payment-and-delivery",
		kind: "article",
	},
	"cancellations-and-disputes": {
		path: "/help/cancellations-and-disputes",
		kind: "article",
	},
	verification: { path: "/help/verification", kind: "article" },
} as const;
export type PageKey = keyof typeof pages;
export const pageKeys = Object.keys(pages) as PageKey[];
export const helpKeys = pageKeys.filter((key) => pages[key].kind === "article");
export const headerKeys: PageKey[] = [
	"how-it-works",
	"wholesale",
	"sell",
	"help",
];
export const footerKeys: PageKey[] = [
	"about",
	"contact",
	...helpKeys,
	"terms",
	"privacy",
];
export function pageAtPath(path: string): PageKey | undefined {
	return pageKeys.find((key) => (pages[key].path || "/") === path);
}
export function destinationAllowed(value: string): boolean {
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
			!!pageAtPath(value) ||
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
