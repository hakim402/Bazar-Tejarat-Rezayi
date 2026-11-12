import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { direction } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import type { PublicProduct, PublicStore, ReviewSummary } from "../types";
import { marketplaceCopy } from "../copy";
import { featuredPlaceholders } from "../featured-placeholders";
import { Asset, FeaturedProductCard, StoreAvatar } from "./cards";
import { carouselItemClass, MarketplaceCarousel } from "./carousel";
import { TrustStrip } from "./trust-strip";
export function FeaturedStore({
	locale,
	store,
	products,
	summary,
}: {
	locale: Locale;
	store: PublicStore;
	products: PublicProduct[];
	summary: ReviewSummary | null;
}) {
	const t = marketplaceCopy[locale],
		fmt = new Intl.NumberFormat(locale),
		dir = direction(store.resolved_locale as Locale),
		real =
			summary && summary.count > 0 && summary.average !== null
				? { value: Number(summary.average), count: summary.count }
				: null,
		rating = real?.value ?? featuredPlaceholders.rating,
		ratingCount = real
			? fmt.format(real.count)
			: featuredPlaceholders.ratingCount;
	return (
		<section className="space-y-6" aria-label={t.featured}>
			<div className="relative rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
				<span className="absolute -top-4 start-6 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-info px-4 py-1.5 text-sm font-bold text-action shadow-lifted">
					<Icon name="sparkle" className="size-4" />
					{t.topSeller}
				</span>
				<div className="grid gap-6 desktop:grid-cols-[22rem_minmax(0,1fr)]">
					<div className="flex min-w-0 flex-col gap-4">
						<div className="flex items-center gap-4">
							<StoreAvatar
								store={store}
								className="size-24"
								textClassName="text-3xl"
								padding="p-2"
							/>
							<div className="min-w-0">
								<h2
									className="break-words text-2xl font-extrabold"
									lang={store.resolved_locale}
									dir={dir}
								>
									{store.name}
								</h2>
								<p className="mt-1 text-sm text-muted">{t.tagline}</p>
							</div>
						</div>
						<p className="flex flex-wrap items-center gap-2 text-sm">
							<Icon
								name="star"
								className="size-4 fill-current text-chip-warning-icon"
							/>
							<bdi className="font-bold">{fmt.format(rating)}</bdi>
							<span className="text-muted">
								(<bdi>{ratingCount}</bdi> {t.reviewCount})
							</span>
							<span aria-hidden className="h-4 w-px bg-border" />
							<Icon name="award" className="size-4 text-chip-warning-icon" />
							<bdi className="font-bold">{featuredPlaceholders.customers}</bdi>
							<span className="sr-only">{t.customers}</span>
						</p>
						<p className="flex items-center gap-1 text-sm text-muted">
							<span
								className="line-clamp-1"
								lang={store.resolved_locale}
								dir={dir}
							>
								{store.description || t.noAbout}
							</span>
							<Icon name="chevron-down" className="size-3.5" />
						</p>
					</div>
					<div className="relative order-first min-h-48 overflow-hidden rounded-card desktop:order-none desktop:min-h-60">
						{store.banner ? (
							<Asset
								asset={store.banner}
								loading="eager"
								className="absolute inset-0 size-full object-cover"
							/>
						) : (
							<span
								aria-hidden
								className="absolute inset-0 bg-gradient-to-br from-info via-brand-panel to-surface"
							/>
						)}
						<span
							aria-hidden
							className="absolute inset-0 bg-gradient-to-t from-surface/80 via-surface/20 to-transparent"
						/>
						<span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-5">
							<bdi
								className="break-words text-3xl font-extrabold text-brand-ink"
								lang={store.resolved_locale}
								dir={dir}
							>
								{store.name}
							</bdi>
							<span className="text-sm font-semibold text-brand-ink/80">
								{t.slogan}
							</span>
						</span>
					</div>
				</div>
				<div className="mt-5 flex flex-wrap items-center justify-between gap-3">
					<Link
						prefetch={false}
						href={`/${locale}/stores/${store.id}`}
						className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-5 text-sm font-bold text-on-primary no-underline shadow-sm transition-colors hover:bg-primary/90 motion-reduce:transition-none"
					>
						{t.viewStore}
						<Icon name="chevron" className="size-4" />
					</Link>
					<TrustStrip locale={locale} className="min-w-0 flex-1" />
				</div>
			</div>
			{products.length > 0 && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="flex items-center gap-2 text-2xl font-bold">
							<Icon
								name="crown"
								className="size-6 fill-current text-chip-warning-icon"
							/>
							{t.featuredProducts}
						</h2>
						<Link
							prefetch={false}
							href={`/${locale}/stores/${store.id}`}
							className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-action no-underline hover:underline"
						>
							{t.viewAll}
							<Icon name="arrow" className="size-4" />
						</Link>
					</div>
					<MarketplaceCarousel locale={locale} label={t.featuredProducts}>
						{products.map((product, index) => (
							<div key={product.id} className={carouselItemClass}>
								<FeaturedProductCard
									product={product}
									locale={locale}
									discounted={index === 0}
								/>
							</div>
						))}
					</MarketplaceCarousel>
				</div>
			)}
		</section>
	);
}
