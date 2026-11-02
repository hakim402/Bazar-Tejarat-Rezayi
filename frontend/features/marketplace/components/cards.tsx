import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { direction } from "../../../lib/i18n/locales";
import type { PublicProduct, PublicStore } from "../types";
import { marketplaceCopy } from "../copy";
import { mediaUrl } from "../api";
export function StoreCard({
	store,
	locale,
}: {
	store: PublicStore;
	locale: Locale;
}) {
	const t = marketplaceCopy[locale];
	return (
		<article className="min-w-0 space-y-3 rounded-3xl border border-border bg-surface p-5 shadow-card">
			<Link
				prefetch={false}
				className="flex min-h-11 items-center gap-3 text-foreground no-underline"
				href={`/${locale}/stores/${store.id}`}
			>
				{store.logo ? (
					<Asset
						asset={store.logo}
						className="size-14 rounded-2xl object-contain"
					/>
				) : (
					<span
						aria-hidden
						className="flex size-14 items-center justify-center rounded-2xl bg-info text-action"
					>
						◇
					</span>
				)}
				<h2 className="min-w-0 break-words text-lg">
					{store.name || t.stores}
				</h2>
			</Link>
			<p className="text-sm text-muted">{t[store.kind]}</p>
			<p>
				{store.city}
				{store.city && store.country ? ", " : ""}
				{store.country}
			</p>
			<p className="text-sm">
				{t.products}: <bdi>{store.product_count}</bdi>
			</p>
		</article>
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
		v = product.variants.length === 1 ? product.variants[0] : null;
	return (
		<article className="min-w-0 overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
			<Link
				prefetch={false}
				href={`/${locale}/products/${product.id}`}
				className="block text-foreground no-underline"
			>
				{product.images[0] ? (
					<Asset
						asset={product.images[0]}
						className="aspect-square h-auto w-full bg-page object-contain p-4"
					/>
				) : (
					<div className="flex aspect-square items-center justify-center bg-page p-4 text-muted">
						{t.noImage}
					</div>
				)}
				<div className="space-y-3 p-4">
					<h2
						className="break-words text-base"
						lang={product.resolved_locale}
						dir={direction(product.resolved_locale as Locale)}
					>
						{product.body.title}
					</h2>
					{product.source_fallback && (
						<p className="text-xs text-muted">{t.fallback}</p>
					)}
					{v ? (
						<div className="space-y-1 text-sm">
							{(["retail", "wholesale"] as const).map((tier) => (
								<p key={tier}>
									{t[tier]}:{" "}
									{v[tier] !== null ? (
										<>
											<bdi dir="ltr">
												{v[tier]} {product.currency}
											</bdi>{" "}
											/ {v.unit_labels[locale] || v.unit}
										</>
									) : (
										t.noPrice
									)}
								</p>
							))}
							<p className="text-muted">
								{
									t[
										v.availability === "unavailable"
											? "unavailableStock"
											: v.availability
									]
								}
							</p>
						</div>
					) : (
						<p className="text-sm text-muted">{t.choose}</p>
					)}
					<p className="text-xs text-muted">{t[product.pricing_mode]}</p>
				</div>
			</Link>
			<Link
				prefetch={false}
				className="mx-4 mb-3 inline-flex min-h-11 items-center text-sm"
				href={`/${locale}/stores/${product.store.id}`}
			>
				{product.store.name || t.stores}
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
		<div className="grid min-w-0 gap-4 min-[520px]:grid-cols-2 desktop:grid-cols-4">
			{products.map((product) => (
				<ProductCard key={product.id} product={product} locale={locale} />
			))}
		</div>
	);
}
