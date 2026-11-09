import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../lib/i18n/locales";
import {
	MarketplaceShell,
	readMarketplace,
	Feedback,
	marketMetadata,
	Breadcrumbs,
	type Search,
} from "../../../../../../features/marketplace/server";
import type { PublicProduct } from "../../../../../../features/marketplace/types";
import { NavigationGuard } from "../../../../../../components/layout/navigation-guard";
import { TargetReport } from "../../../../../../features/messaging/components/report";
import { ProductDetail } from "../../../../../../features/marketplace/components/product-detail";
import { marketplaceCopy } from "../../../../../../features/marketplace/copy";
import { publicOrigin } from "../../../../../../features/pages/metadata";
import { mediaUrl } from "../../../../../../features/marketplace/api";
export async function metadataFor(
	locale: Locale,
	p: { product: string },
	search: Search,
) {
	const result = await readMarketplace<PublicProduct>(
		locale,
		`products/${p.product}/`,
	);
	if (result.status === 404) notFound();
	if (!result.data)
		return {
			robots: { index: false, follow: false },
			title: marketplaceCopy[locale].unavailable,
		};
	return marketMetadata(
		locale,
		`/products/${p.product}`,
		result.data.body.title,
		result.data.body.description,
		Object.keys(search).some((k) => k !== "variant"),
		result.data.images[0] ? mediaUrl(result.data.images[0].url) : undefined,
	);
}
export async function PageContent({
	locale,
	params,
}: {
	locale: Locale;
	params: { product: string };
	search: Search;
}) {
	const result = await readMarketplace<PublicProduct>(
			locale,
			`products/${params.product}/`,
		),
		t = marketplaceCopy[locale];
	if (result.status === 404) notFound();
	const p = result.data;
	const data = p
		? {
				"@context": "https://schema.org",
				"@type": "Product",
				name: p.body.title,
				description: p.body.description,
				sku: p.variants.length === 1 ? p.variants[0].sku : undefined,
				url: `${publicOrigin}/${locale}/products/${p.id}`,
				image: p.images.map((i) => mediaUrl(i.url)),
				brand: p.body.brand
					? { "@type": "Brand", name: p.body.brand }
					: undefined,
			}
		: null;
	return (
		<NavigationGuard guardHistory><MarketplaceShell locale={locale}>
			{p ? (
				<>
					<Breadcrumbs
						locale={locale}
						items={[
							{ name: t.products, path: "/products" },
							{ name: p.body.title, path: `/products/${p.id}` },
						]}
					/>
					<ProductDetail key={p.id} product={p} locale={locale} />
						<TargetReport locale={locale} id={p.id} target="product" />
					<script type="application/ld+json">
						{JSON.stringify(data).replaceAll("<", "\\u003c")}
					</script>
				</>
			) : (
				<Feedback locale={locale} status={result.status} />
			)}
		</MarketplaceShell></NavigationGuard>
	);
}
