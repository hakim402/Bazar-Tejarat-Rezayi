import type { Locale } from "../../../../lib/i18n/locales";
import type {
	Home,
	ProductPage,
	PublicStore,
} from "../../../../features/marketplace/types";
import { readMarketplace } from "../../../../features/marketplace/server";
import { marketplaceCopy } from "../../../../features/marketplace/copy";
import { Icon } from "../../../../components/ui/icon";
import {
	ProductCard,
	StoreCard,
} from "../../../../features/marketplace/components/cards";
import {
	carouselItemClass,
	MarketplaceCarousel,
} from "../../../../features/marketplace/components/carousel";
import { FeaturedStore } from "../../../../features/marketplace/components/featured-store";
export async function MarketplaceHome({
	locale,
	home,
}: {
	locale: Locale;
	home: Home;
}) {
	const t = marketplaceCopy[locale],
		featured = home.featured_store;
	const featuredProducts = featured
		? ((
				await readMarketplace<ProductPage>(
					locale,
					`stores/${featured.id}/products/`,
				)
			).data?.results.slice(0, 8) ?? [])
		: [];
	const sponsored = home.sponsored_stores ?? [];
	return (
		<div className="space-y-8" data-testid="marketplace-home">
			{featured && (
				<FeaturedStore
					locale={locale}
					store={featured}
					products={featuredProducts}
				/>
			)}
			{sponsored.length > 0 && (
				<section className="space-y-4">
					<h2 className="text-2xl">{t.sponsoredStores}</h2>
					<StoreCarousel
						label={t.sponsoredStores}
						locale={locale}
						stores={sponsored}
						sponsored
					/>
				</section>
			)}
			<section className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-2xl">{t.stores}</h2>
					<a
						className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-action no-underline hover:underline"
						href={`/${locale}/stores`}
					>
						{t.viewAll}
						<Icon name="arrow" className="size-4" />
					</a>
				</div>
				{home.stores.length ? (
					<StoreCarousel
						label={t.stores}
						locale={locale}
						stores={home.stores}
					/>
				) : (
					<p>{t.noStores}</p>
				)}
			</section>
			<section className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-2xl">{t.products}</h2>
					<a
						className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-action no-underline hover:underline"
						href={`/${locale}/products`}
					>
						{t.viewAll}
						<Icon name="arrow" className="size-4" />
					</a>
				</div>
				{home.products.length ? (
					<MarketplaceCarousel locale={locale} label={t.products}>
						{home.products.map((product) => (
							<div key={product.id} className={carouselItemClass}>
								<ProductCard product={product} locale={locale} />
							</div>
						))}
					</MarketplaceCarousel>
				) : (
					<p>{t.empty}</p>
				)}
			</section>
		</div>
	);
}

function StoreCarousel({
	label,
	locale,
	stores,
	sponsored = false,
}: {
	label: string;
	locale: Locale;
	stores: PublicStore[];
	sponsored?: boolean;
}) {
	return (
		<MarketplaceCarousel locale={locale} label={label}>
			{stores.map((store) => (
				<div
					key={store.id}
					className="w-72 shrink-0 snap-start min-[520px]:w-80"
				>
					<StoreCard store={store} locale={locale} sponsored={sponsored} />
				</div>
			))}
		</MarketplaceCarousel>
	);
}
