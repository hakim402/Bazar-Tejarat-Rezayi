"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import type { PublicProduct, ReviewSummary } from "../types";
import { marketplaceCopy } from "../copy";
import {
	featuredPlaceholders,
	placeholderCompareAt,
} from "../featured-placeholders";
import { EnquiryEntry } from "../../messaging/components/enquiry-entry";
import { ProductCartAction } from "../../cart/components/product-cart-action";
import { RatingStars, StoreAvatar } from "./cards";
import { CopyLinkButton } from "./copy-link-button";
import { ProductGallery } from "./product-gallery";
import { ProductTabs } from "./product-tabs";
import { ProductReportPanel } from "./product-report";
import { TrustStrip } from "./trust-strip";
export function ProductDetail({
	product,
	locale,
	summary,
}: {
	product: PublicProduct;
	locale: Locale;
	summary: ReviewSummary | null;
}) {
	const t = marketplaceCopy[locale],
		fmt = new Intl.NumberFormat(locale),
		dir = direction(product.resolved_locale as Locale),
		query = useSearchParams(),
		initial = query.get("variant"),
		[variantId, setVariantId] = useState(
			product.variants.some((row) => row.id === initial)
				? initial
				: product.variants[0]?.id,
		),
		[imageId, setImageId] = useState(product.images[0]?.id),
		[canShare, setCanShare] = useState(false);
	useEffect(() => {
		setCanShare(typeof navigator.share === "function");
	}, []);
	const v = product.variants.find((row) => row.id === variantId),
		compare = v?.retail
			? placeholderCompareAt(v.retail, featuredPlaceholders.discountPercent)
			: null,
		availability =
			v?.availability === "unavailable"
				? "unavailableStock"
				: v?.availability === "available"
					? "available"
					: "unknown",
		categoryLabel =
			product.body.category_labels[locale] ||
			product.body.category_labels["fa-AF"] ||
			product.body.category,
		storeLocation = [product.store.city, product.store.country]
			.filter(Boolean)
			.join(locale === "en" ? ", " : "، "),
		variantLabel = (row: PublicProduct["variants"][number]) =>
			Object.values(row.attributes as Record<string, string>).join(" / ") ||
			row.sku,
		selectVariant = (id: string) => {
			setVariantId(id);
			const next = new URL(window.location.href);
			next.searchParams.set("variant", id);
			history.pushState(null, "", next);
			const picture = product.images.find((row) => row.variant === id);
			if (picture) setImageId(picture.id);
		},
		share = async () => {
			try {
				await navigator.share({
					title: product.body.title,
					url: `${window.location.origin}/${locale}/products/${product.id}`,
				});
			} catch (error) {
				if ((error as Error)?.name !== "AbortError")
					toast.error(t.linkCopyFailed);
			}
		},
		names = (labels: unknown) =>
			labels && typeof labels === "object"
				? (labels as Record<string, Record<string, string>>)
				: {},
		entries = (values: unknown, labels: unknown) => {
			const map = names(labels);
			return values && typeof values === "object" && !Array.isArray(values)
				? Object.entries(values as Record<string, unknown>).map(
						([key, value]) => ({
							label: map[key]?.[locale] || map[key]?.["fa-AF"] || key,
							value: String(value),
						}),
					)
				: [];
		},
		bodyRows = entries(product.body.attributes, product.body.attribute_labels),
		bullets = [
			...bodyRows.map((row) => `${row.label}: ${row.value}`),
			...(v?.contents ? [v.contents] : []),
		].slice(0, 8),
		specRows = [
			{ label: t.sku, value: v?.sku },
			{ label: t.brand, value: product.body.brand },
			{ label: t.category, value: categoryLabel },
			{ label: t.unit, value: v ? v.unit_labels[locale] || v.unit : undefined },
			{ label: t.increment, value: v?.increment },
			{ label: t.minimum, value: v?.minimum },
			{ label: t.pricing_mode, value: t[product.pricing_mode] },
			{ label: t.availability, value: v ? t[availability] : undefined },
			...bodyRows,
			...(v ? entries(v.attributes, v.attribute_labels) : []),
		]
			.filter((row): row is { label: string; value: string } => !!row.value)
			.filter(
				(row, i, all) => all.findIndex((x) => x.label === row.label) === i,
			);
	return (
		<article
			className="mx-auto w-full max-w-6xl space-y-5"
			data-testid="product-detail"
		>
			<div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
				<div className="grid min-w-0 gap-5 desktop:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] desktop:gap-6">
					<ProductGallery
						images={product.images}
						locale={locale}
						activeId={imageId}
						onSelect={setImageId}
					/>
					<section className="min-w-0 space-y-3">
						<div className="space-y-1.5">
							{product.body.category && (
								<Link
									prefetch={false}
									href={`/${locale}/categories/${product.body.category}`}
									className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-info px-2.5 text-xs font-bold text-action no-underline hover:underline"
								>
									<Icon name="grid" className="size-3.5" />
									{categoryLabel}
								</Link>
							)}
							<h1
								className="break-words text-xl font-extrabold leading-snug sm:text-2xl"
								lang={product.resolved_locale}
								dir={dir}
							>
								{product.body.title}
							</h1>
							{product.source_fallback && (
								<p className="text-xs text-muted">{t.fallback}</p>
							)}
						</div>
						<p className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
							<RatingStars
								average={featuredPlaceholders.productRating}
								className="size-3.5"
							/>
							<bdi className="font-bold">
								{fmt.format(featuredPlaceholders.productRating)}
							</bdi>
							<span className="text-muted">
								(<bdi>{featuredPlaceholders.productRatingCount}</bdi>{" "}
								{t.reviewCount})
							</span>
							<span aria-hidden className="h-4 w-px bg-border" />
							<Link
								prefetch={false}
								href={`/${locale}/stores/${product.store.id}/reviews`}
								className="font-semibold text-action no-underline hover:underline"
							>
								{summary && summary.count > 0
									? `${fmt.format(summary.count)} ${t.storeReviews}`
									: t.storeReviews}
							</Link>
						</p>
						{v && (
							<p className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
								<span
									role="status"
									className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
										availability === "available"
											? "bg-success/10 text-success"
											: availability === "unavailableStock"
												? "bg-danger/10 text-danger"
												: "bg-page text-muted"
									}`}
								>
									<Icon
										name={
											availability === "available"
												? "check-circle"
												: availability === "unavailableStock"
													? "close"
													: "help"
										}
										className="size-3.5"
									/>
									{t[availability]}
								</span>
								<span className="text-muted">
									{t.sku}:{" "}
									<bdi className="font-semibold text-foreground">{v.sku}</bdi>
								</span>
							</p>
						)}
						<div className="space-y-1 border-y border-border py-3">
							<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								{v?.retail != null ? (
									<>
										<bdi
											dir="ltr"
											className="text-2xl font-extrabold text-action"
										>
											{v.retail} {product.currency}
										</bdi>
										<span className="text-xs text-muted sm:text-sm">
											/ {v.unit_labels[locale] || v.unit}
										</span>
										{compare && (
											<bdi
												dir="ltr"
												className="text-xs text-muted line-through sm:text-sm"
											>
												{compare} {product.currency}
											</bdi>
										)}
										{compare && (
											<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-primary">
												<bdi>
													{fmt.format(featuredPlaceholders.discountPercent)}%
												</bdi>{" "}
												{t.off}
											</span>
										)}
									</>
								) : (
									<span className="text-sm text-muted">{t.noPrice}</span>
								)}
								{product.pricing_mode === "negotiable" && (
									<span className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold text-muted">
										<Icon name="handshake" className="size-3.5" />
										{t.negotiable}
									</span>
								)}
							</p>
							{v?.wholesale != null && (
								<p className="text-xs text-muted sm:text-sm">
									{t.wholesale}:{" "}
									<bdi dir="ltr" className="font-semibold text-foreground">
										{v.wholesale} {product.currency}
									</bdi>{" "}
									/ {v.unit_labels[locale] || v.unit}
								</p>
							)}
						</div>
						{product.variants.length > 1 && (
							<div className="space-y-1.5">
								<p className="text-sm font-semibold">{t.choose}</p>
								<div className="flex flex-wrap gap-2">
									{product.variants.map((row) => (
										<button
											key={row.id}
											type="button"
											aria-pressed={row.id === variantId}
											onClick={() => selectVariant(row.id)}
											className={`inline-flex min-h-10 flex-col items-start justify-center gap-0.5 rounded-control border px-3 py-1 text-start shadow-sm transition-colors active:scale-[0.98] motion-reduce:active:scale-100 ${
												row.id === variantId
													? "border-action bg-info text-action"
													: "border-border bg-surface hover:border-action/50"
											}`}
										>
											<span className="max-w-44 truncate text-sm font-semibold">
												{variantLabel(row)}
											</span>
											<span
												className={`text-xs ${row.id === variantId ? "text-action/80" : "text-muted"}`}
											>
												{row.retail != null ? (
													<bdi dir="ltr">
														{row.retail} {product.currency}
													</bdi>
												) : (
													t.noPrice
												)}{" "}
												/ {row.unit_labels[locale] || row.unit}
											</span>
										</button>
									))}
								</div>
							</div>
						)}
						{v && (
							<ProductCartAction
								key={`${locale}:${product.id}:${v.id}`}
								locale={locale}
								product={product}
								variant={v.id}
							/>
						)}
					</section>
				</div>
				<div className="mt-5 space-y-4 border-t border-border pt-5">
					<div className="flex flex-col gap-3 desktop:flex-row desktop:items-center">
						<div className="min-w-0 flex-1">
							<EnquiryEntry
								key={`${locale}:${product.id}`}
								locale={locale}
								product={product.id}
							/>
						</div>
						<div className="flex shrink-0 flex-wrap items-center gap-2.5">
							<CopyLinkButton
								locale={locale}
								path={`/${locale}/products/${product.id}`}
							/>
							{canShare && (
								<button
									type="button"
									onClick={() => void share()}
									aria-label={t.shareLink}
									title={t.shareLink}
									className="inline-flex size-11 items-center justify-center gap-2 rounded-control border border-border bg-surface text-sm font-bold text-foreground shadow-sm transition-colors hover:border-action/50 hover:text-action active:scale-95 motion-reduce:active:scale-100 desktop:size-auto desktop:min-h-11 desktop:px-4"
								>
									<Icon name="share" className="size-4" />
									<span className="hidden desktop:inline">{t.shareLink}</span>
								</button>
							)}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-page/40 p-3 sm:p-4">
						<StoreAvatar
							store={product.store}
							className="size-12"
							textClassName="text-base"
							padding="p-1"
						/>
						<div className="min-w-0 flex-1">
							<span className="block text-xs text-muted">{t.soldBy}</span>
							<Link
								prefetch={false}
								href={`/${locale}/stores/${product.store.id}`}
								className="block truncate text-sm font-bold no-underline hover:underline"
								lang={product.store.resolved_locale}
								dir={direction(product.store.resolved_locale as Locale)}
							>
								{product.store.name || t.stores}
							</Link>
							{storeLocation && (
								<span className="block truncate text-xs text-muted">
									{storeLocation}
								</span>
							)}
						</div>
						<Link
							prefetch={false}
							href={`/${locale}/stores/${product.store.id}`}
							className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-control border border-border bg-surface px-4 text-xs font-bold text-action no-underline transition-colors hover:border-action/50 hover:bg-info sm:text-sm"
						>
							{t.viewStore}
							<Icon name="chevron" className="size-4" />
						</Link>
					</div>
				</div>
			</div>
			<ProductTabs
				locale={locale}
				tabs={[
					{
						id: "description",
						label: t.productDescription,
						panel: (
							<div className="space-y-3">
								<p
									className={`whitespace-pre-wrap break-words text-sm leading-6 ${product.body.description ? "" : "text-muted"}`}
									lang={product.resolved_locale}
									dir={dir}
								>
									{product.body.description || t.descriptionPlaceholder}
								</p>
								{bullets.length > 0 && (
									<ul className="space-y-1.5">
										{bullets.map((bullet) => (
											<li key={bullet} className="flex gap-2 text-sm">
												<Icon
													name="check"
													className="mt-1 size-3.5 shrink-0 text-success"
												/>
												<span className="break-words">{bullet}</span>
											</li>
										))}
									</ul>
								)}
							</div>
						),
					},
					{
						id: "specifications",
						label: t.specifications,
						panel: <SpecTable rows={specRows} />,
					},
					{
						id: "store-delivery",
						label: t.storeDelivery,
						panel: (
							<div className="space-y-3 text-sm">
								<TrustStrip locale={locale} />
								<p className="text-muted">{t.delivery}</p>
								<p className="text-muted">{t.wholesaleRule}</p>
							</div>
						),
					},
					{
						id: "report",
						label: t.reportTab,
						panel: <ProductReportPanel locale={locale} id={product.id} />,
					},
				]}
			/>
		</article>
	);
}
function SpecTable({ rows }: { rows: { label: string; value: string }[] }) {
	return (
		<dl className="overflow-hidden rounded-card border border-border">
			{rows.map((row, i) => (
				<div
					key={row.label}
					className={`grid grid-cols-[8rem_1fr] border-b border-border/60 transition-colors last:border-b-0 hover:bg-info/40 max-[480px]:grid-cols-[6.5rem_1fr] ${
						i % 2 ? "bg-page/60" : "bg-surface"
					}`}
				>
					<dt className="border-e border-border/60 px-3 py-2 text-xs font-bold text-muted sm:px-4">
						{row.label}
					</dt>
					<dd className="break-words px-3 py-2 text-sm font-semibold sm:px-4">
						{row.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
