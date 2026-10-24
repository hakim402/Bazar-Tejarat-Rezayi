import type { IconName } from "../../components/ui/icon";
import type { Locale } from "../../lib/i18n/locales";

/** Owner-requested static design data, independent of the real catalogue. */
export const categories = [
	{ id: "dried-fruit", icon: "leaf" },
	{ id: "clothing", icon: "dress" },
	{ id: "beauty", icon: "beauty" },
	{ id: "furniture", icon: "chair" },
	{ id: "home", icon: "home" },
	{ id: "electronics", icon: "phone" },
	{ id: "crafts", icon: "sparkle" },
	{ id: "accessories", icon: "store" },
	{ id: "sports", icon: "grid" },
	{ id: "children", icon: "team" },
	{ id: "stationery", icon: "file" },
] as const satisfies readonly { id: string; icon: IconName }[];
export type CategoryId = (typeof categories)[number]["id"];
export const demoProducts = [
	"dried-fruit",
	"clothing",
	"beauty",
	"furniture",
] as const;
export type DemoProduct = (typeof demoProducts)[number];
export const productImage = (id: DemoProduct) =>
	`/images/storefront/${id}.webp`;
export const categoryHref = (locale: Locale, id: CategoryId) =>
	`/${locale}#category-${id}`;
export const productHref = (locale: Locale, id: DemoProduct) =>
	`/${locale}#demo-product-${id}`;
export function isDemoProduct(value: string): value is DemoProduct {
	return demoProducts.some((id) => id === value);
}
export function isCategory(value: string): value is CategoryId {
	return categories.some(({ id }) => id === value);
}
export function heroHref(locale: Locale, destination: string) {
	if (!destination.startsWith("/")) return destination;
	if (destination === "/") return `/${locale}`;
	return `/${locale}${destination.startsWith("/#") ? destination.slice(1) : destination}`;
}
