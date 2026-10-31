import { uuidPattern } from "./account-routes.ts";
export const marketplacePages = [
	"categories",
	"products",
	"search",
	"stores",
] as const;
export function marketplaceRoute(path: string): string | null {
	const parts = path.replace(/^\//, "").split("/");
	if (
		parts.length === 1 &&
		marketplacePages.some((value) => value === parts[0])
	)
		return `${parts[0] === "search" ? "products" : parts[0]}/`;
	if (
		parts[0] === "categories" &&
		parts.length === 2 &&
		/^[a-z0-9][a-z0-9_-]{0,39}$/.test(parts[1])
	)
		return `categories/${parts[1]}/`;
	if (
		["products", "stores"].includes(parts[0]) &&
		uuidPattern.test(parts[1] || "")
	) {
		if (parts.length === 2) return `${parts[0]}/${parts[1]}/`;
		if (
			parts[0] === "stores" &&
			parts.length === 3 &&
			["about", "reviews"].includes(parts[2])
		)
			return `stores/${parts[1]}/`;
	}
	return null;
}
