import type { Locale } from "../../../../lib/i18n/locales";
import type { Home } from "../../../../features/marketplace/types";
import { marketplaceCopy } from "../../../../features/marketplace/copy";
import {
	ProductGrid,
	StoreCard,
} from "../../../../features/marketplace/components/cards";
export function MarketplaceHome({
	locale,
	home,
}: {
	locale: Locale;
	home: Home;
}) {
	const t = marketplaceCopy[locale];
	return (
		<div className="space-y-8" data-testid="marketplace-home">
			<section className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-2xl">{t.products}</h2>
					<a
						className="inline-flex min-h-11 items-center"
						href={`/${locale}/products`}
					>
						{t.products}
					</a>
				</div>
				{home.products.length ? (
					<ProductGrid products={home.products} locale={locale} />
				) : (
					<p>{t.empty}</p>
				)}
			</section>
			<section className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-2xl">{t.stores}</h2>
					<a
						className="inline-flex min-h-11 items-center"
						href={`/${locale}/stores`}
					>
						{t.stores}
					</a>
				</div>
				{home.stores.length ? (
					<div className="grid gap-4 min-[640px]:grid-cols-2 desktop:grid-cols-3">
						{home.stores.map((store) => (
							<StoreCard key={store.id} store={store} locale={locale} />
						))}
					</div>
				) : (
					<p>{t.noStores}</p>
				)}
			</section>
			{home.featured_store && (
				<section className="max-w-xl space-y-4">
					<h2 className="text-2xl">{t.featured}</h2>
					<StoreCard store={home.featured_store} locale={locale} />
				</section>
			)}
		</div>
	);
}
