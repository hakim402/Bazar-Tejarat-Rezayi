import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { direction } from "../../../../../../lib/i18n/locales";
import {
	MarketplaceShell,
	readMarketplace,
	Feedback,
	Breadcrumbs,
} from "../../../../../../features/marketplace/server";
import type {
	PublicStore,
	ReviewSummary,
} from "../../../../../../features/marketplace/types";
import { marketplaceCopy } from "../../../../../../features/marketplace/copy";
import {
	Asset,
	RatingStars,
	StoreAvatar,
} from "../../../../../../features/marketplace/components/cards";
import { Icon } from "../../../../../../components/ui/icon";
import { CopyLinkButton } from "../../../../../../features/marketplace/components/copy-link-button";
import { TrustStrip } from "../../../../../../features/marketplace/components/trust-strip";
import { featuredPlaceholders } from "../../../../../../features/marketplace/featured-placeholders";
import { mediaUrl } from "../../../../../../features/marketplace/api";
import { publicOrigin } from "../../../../../../features/pages/metadata";
export async function StoreShell({
	locale,
	id,
	tab = "products",
	children,
}: {
	locale: Locale;
	id: string;
	tab?: "products" | "about" | "reviews";
	children: React.ReactNode;
}) {
	const [result, summaryResult] = await Promise.all([
			readMarketplace<PublicStore>(locale, `stores/${id}/`),
			readMarketplace<ReviewSummary>(locale, `stores/${id}/reviews/summary/`),
		]),
		t = marketplaceCopy[locale];
	if (result.status === 404) notFound();
	const store = result.data,
		summary = summaryResult.data,
		rating =
			summary && summary.count > 0 && summary.average !== null
				? Number(summary.average)
				: null,
		location = store
			? [store.city, store.country]
					.filter(Boolean)
					.join(locale === "en" ? ", " : "، ")
			: "",
		dir = direction((store?.resolved_locale || locale) as Locale),
		yearFmt = new Intl.NumberFormat(locale, { useGrouping: false });
	return (
		<MarketplaceShell locale={locale}>
			{store ? (
				<>
					<Breadcrumbs
						locale={locale}
						items={[
							{ name: t.stores, path: "/stores" },
							{ name: store.name || t.stores, path: `/stores/${id}` },
						]}
					/>
					<script type="application/ld+json">
						{JSON.stringify({
							"@context": "https://schema.org",
							"@type": "ProfilePage",
							url: `${publicOrigin}/${locale}/stores/${id}`,
							mainEntity: {
								"@type": store.kind === "company" ? "Organization" : "Person",
								name: store.name,
								description: store.description,
								image: store.logo ? mediaUrl(store.logo.url) : undefined,
								...(rating !== null && summary
									? {
											aggregateRating: {
												"@type": "AggregateRating",
												ratingValue: summary.average,
												reviewCount: summary.count,
												bestRating: 5,
											},
										}
									: {}),
							},
						}).replaceAll("<", "\\u003c")}
					</script>
					<header className="rounded-card border border-border bg-surface shadow-card">
						<div className="relative h-40 overflow-hidden rounded-t-card sm:h-52 desktop:h-60">
							{store.banner ? (
								<Asset
									asset={store.banner}
									loading="eager"
									className="absolute inset-0 size-full object-cover"
								/>
							) : (
								<span
									aria-hidden
									className="absolute inset-0 bg-linear-to-r from-campaign-start via-campaign-end to-campaign-lilac"
								/>
							)}
							<span
								aria-hidden
								className="absolute inset-0 bg-gradient-to-t from-surface/90 via-surface/30 to-transparent"
							/>
							{store.featured && (
								<span className="absolute top-4 start-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-info px-4 py-1.5 text-sm font-bold text-action shadow-lifted">
									<Icon name="sparkle" className="size-4" />
									{t.topSeller}
								</span>
							)}
						</div>
						<div className="relative z-10 -mt-10 flex flex-col gap-5 px-5 pb-5 sm:px-6 sm:pb-6 desktop:mt-0 desktop:flex-row desktop:items-start">
							<StoreAvatar
								store={store}
								className="size-28 shrink-0 ring-4 ring-surface max-desktop:self-center sm:size-32 desktop:-mt-16"
								textClassName="text-4xl"
								padding="p-2"
							/>
							<div className="min-w-0 flex-1 space-y-2.5 max-desktop:text-center desktop:pt-5">
								<div className="flex flex-wrap items-center gap-2 max-desktop:justify-center">
									<h1
										className="break-words text-2xl font-extrabold leading-snug desktop:text-3xl"
										lang={store.resolved_locale}
										dir={dir}
									>
										{store.name || t.stores}
									</h1>
									<span className="rounded-full bg-info px-2.5 py-0.5 text-xs font-semibold text-action">
										{t[store.kind]}
									</span>
									<span className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold text-muted">
										<Icon name="history" className="size-3.5" />
										{t.memberSince}{" "}
										<bdi>
											{yearFmt.format(featuredPlaceholders.memberSince)}
										</bdi>
									</span>
								</div>
								<p className="text-sm text-muted">{t.tagline}</p>
								<p className="flex flex-wrap items-center gap-2 text-sm max-desktop:justify-center">
									{rating !== null && summary ? (
										<>
											<RatingStars average={rating} />
											<bdi className="font-bold">{summary.average}</bdi>
											<span className="text-muted">
												(<bdi>{summary.count}</bdi> {t.reviewCount})
											</span>
										</>
									) : (
										<span className="text-muted">{t.noReviews}</span>
									)}
									<span aria-hidden className="h-4 w-px bg-border" />
									<Icon
										name="award"
										className="size-4 text-chip-warning-icon"
									/>
									<bdi className="font-bold">
										{featuredPlaceholders.customers}
									</bdi>
									<span className="sr-only">{t.customers}</span>
								</p>
								<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted max-desktop:justify-center">
									{location && (
										<span className="inline-flex items-center gap-1.5">
											<Icon name="map-pin" className="size-4" />
											{location}
										</span>
									)}
									<span className="inline-flex items-center gap-1.5">
										<Icon name="box" className="size-4" />
										{t.products}: <bdi>{store.product_count}</bdi>
									</span>
								</div>
								{store.description && (
									<p
										className="line-clamp-2 break-words text-sm"
										lang={store.resolved_locale}
										dir={dir}
									>
										{store.description}
									</p>
								)}
								{tab !== "about" && (
									<a
										href={`/${locale}/stores/${id}/about`}
										className="inline-flex min-h-9 items-center gap-1 text-sm font-bold text-action no-underline hover:underline"
									>
										{t.moreAbout}
										<Icon name="chevron" className="size-4" />
									</a>
								)}
								{store.source_fallback && (
									<p className="text-xs text-muted">{t.fallback}</p>
								)}
							</div>
							<div className="flex shrink-0 flex-wrap items-center gap-3 max-desktop:justify-center desktop:w-48 desktop:flex-col desktop:items-stretch desktop:pt-5">
								<a
									href={
										tab === "products"
											? "#store-products"
											: `/${locale}/stores/${id}`
									}
									className="hidden min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-5 text-sm font-bold text-on-primary no-underline shadow-sm transition-opacity hover:opacity-90 desktop:inline-flex"
								>
									<Icon name="grid" className="size-4" />
									{t.browseProducts}
								</a>
								<CopyLinkButton
									locale={locale}
									path={`/${locale}/stores/${id}`}
								/>
							</div>
						</div>
						<TrustStrip
							locale={locale}
							className="mx-5 mb-5 hidden sm:mx-6 sm:mb-6 desktop:flex"
						/>
						<nav
							aria-label={store.name || t.stores}
							className="sticky top-0 z-20 overflow-x-auto rounded-b-card border-t border-border bg-surface/95 px-3 backdrop-blur-sm sm:px-5"
						>
							<div className="flex gap-1 max-desktop:mx-auto max-desktop:w-max max-desktop:min-w-full max-desktop:justify-center">
								{(["products", "about", "reviews"] as const).map((key) => (
									<a
										key={key}
										href={`/${locale}/stores/${id}${key === "products" ? "" : `/${key}`}`}
										aria-current={tab === key ? "page" : undefined}
										className={`inline-flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 px-4 text-sm font-bold no-underline transition-colors ${
											tab === key
												? "border-action text-action"
												: "border-transparent text-muted hover:text-foreground"
										}`}
									>
										{t[key]}
										{key === "products" && (
											<bdi className="rounded-full bg-page px-2 py-0.5 text-xs font-semibold text-muted">
												{store.product_count}
											</bdi>
										)}
										{key === "reviews" && summary && summary.count > 0 && (
											<bdi className="rounded-full bg-page px-2 py-0.5 text-xs font-semibold text-muted">
												{summary.count}
											</bdi>
										)}
									</a>
								))}
							</div>
						</nav>
					</header>
					{children}
				</>
			) : (
				<Feedback locale={locale} status={result.status} />
			)}
		</MarketplaceShell>
	);
}
