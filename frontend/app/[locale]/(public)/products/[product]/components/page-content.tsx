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
import type {
	ProductPage,
	PublicProduct,
	ReviewSummary,
} from "../../../../../../features/marketplace/types";
import { NavigationGuard } from "../../../../../../components/layout/navigation-guard";
import { ProductDetail } from "../../../../../../features/marketplace/components/product-detail";
import { ProductCard } from "../../../../../../features/marketplace/components/cards";
import { MarketplaceCarousel } from "../../../../../../features/marketplace/components/carousel";
import { marketplaceCopy } from "../../../../../../features/marketplace/copy";
import { Icon } from "../../../../../../components/ui/icon";
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
	let summary: ReviewSummary | null = null,
		related: PublicProduct[] = [];
	if (p) {
		const [summaryResult, categoryResult] = await Promise.all([
			readMarketplace<ReviewSummary>(
				locale,
				`stores/${p.store.id}/reviews/summary/`,
			),
			p.body.category
				? readMarketplace<ProductPage>(locale, `categories/${p.body.category}/`)
				: Promise.resolve({ data: null, status: 200 }),
		]);
		summary = summaryResult.data;
		related = (categoryResult.data?.results ?? []).filter(
			(row) => row.id !== p.id,
		);
		if (related.length < 4) {
			const storeResult = await readMarketplace<ProductPage>(
				locale,
				`stores/${p.store.id}/products/`,
			);
			const seen = new Set([p.id, ...related.map((row) => row.id)]);
			related = [
				...related,
				...(storeResult.data?.results ?? []).filter((row) => !seen.has(row.id)),
			];
		}
		related = related.slice(0, 8);
	}
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
		<NavigationGuard guardHistory>
			<MarketplaceShell locale={locale}>
				{p ? (
					<>
						<Breadcrumbs
							locale={locale}
							items={[
								{ name: t.products, path: "/products" },
								...(p.body.category
									? [
											{
												name:
													p.body.category_labels[locale] ||
													p.body.category_labels["fa-AF"] ||
													p.body.category,
												path: `/categories/${p.body.category}`,
											},
										]
									: []),
								{ name: p.body.title, path: `/products/${p.id}` },
							]}
						/>
						<ProductDetail
							key={p.id}
							product={p}
							locale={locale}
							summary={summary}
						/>
						{related.length > 0 && (
							<section className="space-y-4">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<h2 className="text-xl font-bold">{t.relatedProducts}</h2>
									{p.body.category && (
										<a
											className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-action no-underline hover:underline"
											href={`/${locale}/categories/${p.body.category}`}
										>
											{t.viewAll}
											<Icon name="arrow" className="size-4" />
										</a>
									)}
								</div>
								<MarketplaceCarousel locale={locale} label={t.relatedProducts}>
									{related.map((row) => (
										<div
											key={row.id}
											className="w-44 shrink-0 snap-start min-[520px]:w-52"
										>
											<ProductCard product={row} locale={locale} />
										</div>
									))}
								</MarketplaceCarousel>
							</section>
						)}
						<script type="application/ld+json">
							{JSON.stringify(data).replaceAll("<", "\\u003c")}
						</script>
					</>
				) : (
					<Feedback locale={locale} status={result.status} />
				)}
			</MarketplaceShell>
		</NavigationGuard>
	);
}
