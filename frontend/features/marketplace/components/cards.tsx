import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { direction } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import type { PublicProduct, PublicStore } from "../types";
import { marketplaceCopy } from "../copy";
import {
	featuredPlaceholders,
	placeholderCompareAt,
} from "../featured-placeholders";
import { mediaUrl } from "../api";
export function StoreAvatar({
	store,
	className = "size-14",
	textClassName = "text-xl",
	padding = "p-1.5",
}: {
	store: PublicStore;
	className?: string;
	textClassName?: string;
	padding?: string;
}) {
	const letter = Array.from(store.name.trim())[0]?.toLocaleUpperCase();
	return store.logo ? (
		<span
			className={`shrink-0 overflow-hidden rounded-full border border-border bg-surface ${className}`}
		>
			<Asset
				asset={store.logo}
				className={`block size-full object-contain ${padding}`}
			/>
		</span>
	) : (
		<span
			aria-hidden
			className={`flex shrink-0 items-center justify-center rounded-full bg-brand-panel font-bold text-brand-ink ${className} ${textClassName}`}
		>
			{letter ? (
				<bdi>{letter}</bdi>
			) : (
				<Icon name="store" className="size-[45%]" />
			)}
		</span>
	);
}
export function RatingStars({
	average,
	className = "size-4",
}: {
	average: number;
	className?: string;
}) {
	const filled = Math.round(average);
	return (
		<span aria-hidden className="inline-flex items-center gap-0.5">
			{[1, 2, 3, 4, 5].map((i) => (
				<Icon
					key={i}
					name="star"
					className={`${className} ${i <= filled ? "fill-current text-chip-warning-icon" : "text-border"}`}
				/>
			))}
		</span>
	);
}
export function StoreCard({
	store,
	locale,
}: {
	store: PublicStore;
	locale: Locale;
}) {
	const t = marketplaceCopy[locale],
		fmt = new Intl.NumberFormat(locale),
		dir = direction(store.resolved_locale as Locale),
		location = [store.city, store.country]
			.filter(Boolean)
			.join(locale === "en" ? ", " : "، ");
	return (
		<Link
			prefetch={false}
			href={`/${locale}/stores/${store.id}`}
			className="group flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface text-foreground no-underline shadow-card transition-[border-color,box-shadow] duration-200 hover:border-action/50 hover:shadow-lifted motion-reduce:transition-none"
		>
			<span className="relative block h-20 shrink-0 overflow-hidden">
				{store.banner ? (
					<Asset
						asset={store.banner}
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
					className="absolute inset-0 bg-gradient-to-t from-surface/60 to-transparent"
				/>
				<span className="absolute top-2 start-2 inline-flex items-center gap-1 rounded-full bg-surface/85 px-2 py-0.5 text-[0.65rem] font-semibold text-muted backdrop-blur-sm">
					<Icon name="store" className="size-3" />
					{t[store.kind]}
				</span>
				{store.featured && (
					<span className="absolute top-2 end-2 inline-flex items-center gap-1 rounded-full bg-info px-2 py-0.5 text-[0.65rem] font-bold text-action shadow-sm">
						<Icon name="sparkle" className="size-3" />
						{t.topSeller}
					</span>
				)}
			</span>
			<span className="relative z-10 -mt-7 flex shrink-0 justify-center px-4">
				<StoreAvatar
					store={store}
					className="size-14 ring-4 ring-surface"
					textClassName="text-lg"
					padding="p-1"
				/>
			</span>
			<span className="flex flex-1 flex-col items-center gap-1.5 px-4 pb-4 pt-2 text-center">
				<h2
					className="line-clamp-1 break-words text-base font-bold"
					lang={store.resolved_locale}
					dir={dir}
				>
					{store.name || t.stores}
				</h2>
				<span className="text-xs text-muted">{t.tagline}</span>
				<span className="flex items-center gap-1 text-xs text-muted">
					<Icon
						name="star"
						className="size-3.5 fill-current text-chip-warning-icon"
					/>
					<bdi className="font-bold text-foreground">
						{fmt.format(featuredPlaceholders.rating)}
					</bdi>
					<span>
						(<bdi>{featuredPlaceholders.ratingCount}</bdi> {t.reviewCount})
					</span>
				</span>
				<span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
					{location && (
						<span className="flex min-w-0 items-center gap-1">
							<Icon name="map-pin" className="size-3.5" />
							<span className="truncate">{location}</span>
						</span>
					)}
					<span className="flex items-center gap-1">
						<Icon name="box" className="size-3.5" />
						{t.products}: <bdi>{store.product_count}</bdi>
					</span>
				</span>
				<span className="mt-auto inline-flex min-h-9 items-center gap-1.5 pt-2 text-sm font-bold text-action group-hover:underline">
					{t.viewStore}
					<Icon name="chevron" className="size-4" />
				</span>
			</span>
		</Link>
	);
}
export function Asset({
	asset,
	className,
	loading = "lazy",
}: {
	asset: { url: string; alt?: string; width: number; height: number };
	className: string;
	loading?: "lazy" | "eager";
}) {
	return (
		// biome-ignore lint/performance/noImgElement: inspected API media requires its native publication-aware byte boundary.
		<img
			src={mediaUrl(asset.url)}
			alt={asset.alt ?? ""}
			width={asset.width}
			height={asset.height}
			loading={loading}
			className={className}
		/>
	);
}
export function ProductCard({
	product,
	locale,
}: {
	product: PublicProduct;
	locale: Locale;
}) {
	const t = marketplaceCopy[locale],
		v = product.variants.length === 1 ? product.variants[0] : null,
		availability = v
			? v.availability === "unavailable"
				? "unavailableStock"
				: v.availability === "available"
					? "available"
					: "unknown"
			: null;
	return (
		<article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-sm border border-border/60 bg-surface transition-colors duration-200 hover:border-action/40 motion-reduce:transition-none">
			<Link
				prefetch={false}
				href={`/${locale}/products/${product.id}`}
				className="flex flex-1 flex-col text-foreground no-underline"
			>
				<span className="flex items-center justify-between gap-1.5 px-2 pt-2 min-[520px]:gap-2 min-[520px]:px-3 min-[520px]:pt-3">
					<span className="inline-flex min-w-0 items-center gap-1 text-[0.65rem] font-semibold tracking-wide text-muted">
						{availability && (
							<>
								<Icon
									name={
										availability === "available"
											? "check-circle"
											: availability === "unavailableStock"
												? "close"
												: "help"
									}
									className="size-3 min-[520px]:size-3.5"
								/>
								<span className="truncate">{t[availability]}</span>
							</>
						)}
					</span>
					<StoreAvatar
						store={product.store}
						className="size-5 min-[520px]:size-6"
						textClassName="text-[0.6rem]"
						padding="p-0.5"
					/>
				</span>
				<span className="relative block">
					{product.images[0] ? (
						<Asset
							asset={product.images[0]}
							className="aspect-square h-auto w-full object-contain p-3 transition-opacity duration-200 group-hover:opacity-30 motion-reduce:transition-none min-[520px]:p-6"
						/>
					) : (
						<span className="flex aspect-square items-center justify-center text-muted">
							<Icon name="image" className="size-7 min-[520px]:size-10" />
						</span>
					)}
					<span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
						<span className="inline-flex min-h-8 items-center rounded-control bg-primary px-3 text-[0.7rem] font-bold text-on-primary shadow-sm min-[520px]:min-h-9 min-[520px]:px-4 min-[520px]:text-xs">
							{t.viewDetails}
						</span>
					</span>
				</span>
				<span className="flex flex-1 flex-col gap-0.5 px-2 pb-3 text-center min-[520px]:gap-1 min-[520px]:px-3 min-[520px]:pb-4">
					<h2
						className="line-clamp-1 break-words text-xs font-bold min-[520px]:text-sm"
						lang={product.resolved_locale}
						dir={direction(product.resolved_locale as Locale)}
					>
						{product.body.title}
					</h2>
					{v ? (
						<span className="text-[0.7rem] font-semibold text-success min-[520px]:text-xs">
							{v.retail !== null ? (
								<>
									<bdi dir="ltr">
										{v.retail} {product.currency}
									</bdi>
									<span className="hidden font-normal text-muted min-[400px]:inline">
										{" "}
										/ {v.unit_labels[locale] || v.unit}
									</span>
								</>
							) : (
								<span className="font-normal text-muted">{t.noPrice}</span>
							)}
						</span>
					) : (
						<span className="text-xs text-muted">{t.choose}</span>
					)}
					{product.source_fallback && (
						<span className="hidden text-[0.65rem] text-muted min-[520px]:block">
							{t.fallback}
						</span>
					)}
				</span>
			</Link>
		</article>
	);
}
export function FeaturedProductCard({
	product,
	locale,
	discounted = false,
}: {
	product: PublicProduct;
	locale: Locale;
	discounted?: boolean;
}) {
	const t = marketplaceCopy[locale],
		v = product.variants.length === 1 ? product.variants[0] : null,
		fmt = new Intl.NumberFormat(locale),
		compare =
			discounted && v?.retail
				? placeholderCompareAt(v.retail, featuredPlaceholders.discountPercent)
				: null;
	return (
		<article className="flex h-full min-w-0 flex-col rounded-card border border-border/60 bg-surface p-3 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-action/40 hover:shadow-lifted motion-reduce:transition-none">
			<Link
				prefetch={false}
				href={`/${locale}/products/${product.id}`}
				className="flex flex-1 flex-col gap-2.5 text-foreground no-underline"
			>
				<span className="relative block overflow-hidden rounded-sm bg-page">
					{product.images[0] ? (
						<Asset
							asset={product.images[0]}
							className="aspect-[4/3] h-auto w-full object-contain p-4"
						/>
					) : (
						<span className="flex aspect-[4/3] items-center justify-center text-muted">
							<Icon name="image" className="size-10" />
						</span>
					)}
					{discounted && (
						<span className="absolute top-2 start-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[0.65rem] font-bold text-on-primary shadow-sm">
							<bdi>{fmt.format(featuredPlaceholders.discountPercent)}%</bdi>
							{t.off}
						</span>
					)}
				</span>
				<h2
					className="line-clamp-1 break-words text-center text-sm font-bold"
					lang={product.resolved_locale}
					dir={direction(product.resolved_locale as Locale)}
				>
					{product.body.title}
				</h2>
				<span className="flex items-center justify-center gap-1 text-xs text-muted">
					<Icon
						name="star"
						className="size-3.5 fill-current text-chip-warning-icon"
					/>
					<bdi className="font-bold text-foreground">
						{fmt.format(featuredPlaceholders.productRating)}
					</bdi>
					<span>
						(<bdi>{featuredPlaceholders.productRatingCount}</bdi>{" "}
						{t.reviewCount})
					</span>
				</span>
				<span className="mt-auto flex flex-wrap items-center justify-center gap-2 pb-1 text-center">
					{v ? (
						v.retail !== null ? (
							<>
								<bdi dir="ltr" className="text-base font-extrabold text-action">
									{v.retail} {product.currency}
								</bdi>
								{compare && (
									<bdi dir="ltr" className="text-xs text-muted line-through">
										{compare} {product.currency}
									</bdi>
								)}
							</>
						) : (
							<span className="text-xs text-muted">{t.noPrice}</span>
						)
					) : (
						<span className="text-xs text-muted">{t.choose}</span>
					)}
				</span>
			</Link>
		</article>
	);
}
export function ProductGrid({
	products,
	locale,
}: {
	products: PublicProduct[];
	locale: Locale;
}) {
	return (
		<div className="order-5 grid min-w-0 grid-cols-2 gap-2.5 min-[520px]:gap-4 min-[1024px]:grid-cols-3">
			{products.map((product) => (
				<ProductCard key={product.id} product={product} locale={locale} />
			))}
		</div>
	);
}
