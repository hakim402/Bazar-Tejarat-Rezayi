import type { components } from "../../lib/api/schema.d";
export type PublicProduct = components["schemas"]["MarketplaceProduct"];
export type PublicStore = components["schemas"]["MarketplaceStore"];
export type ProductPage = components["schemas"]["MarketplaceProducts"];
export type StorePage = components["schemas"]["MarketplaceStores"];
export type CategoryPage = components["schemas"]["MarketplaceCategories"];
// Category storefront assets land in the API before the gated schema is regenerated;
// this intersection keeps them typed without hand-editing schema.d.ts.
export type CategoryAssets = { icon?: string; image?: string | null };
export type CategoryRow = CategoryPage["results"][number] & CategoryAssets;
export type HomeCategory = Home["categories"][number] & CategoryAssets;
// Category sale units land in the API before the gated schema is regenerated.
export type CategoryUnit = { code: string; name: string; fractional: boolean };
export type CategoryDetail = NonNullable<ProductPage["category"]> & {
	units?: CategoryUnit[];
};
export type ReviewSummary = components["schemas"]["MarketplaceReviewSummary"];
export type Home = components["schemas"]["MarketplaceHome"];
export type PrivateStore = components["schemas"]["StorePrivate"];
export type StoreProfiles = components["schemas"]["StoreProfiles"];
export type SitemapPage = components["schemas"]["MarketplaceSitemap"];
export type StoreEdition = {
	description: string;
	logo_alt: string;
	banner_alt: string;
};
export type StoreBody = {
	source_locale: import("../../lib/i18n/locales").Locale;
	editions: Partial<
		Record<import("../../lib/i18n/locales").Locale, StoreEdition>
	>;
	country: string;
	city: string;
	logo: string | null;
	banner: string | null;
};
