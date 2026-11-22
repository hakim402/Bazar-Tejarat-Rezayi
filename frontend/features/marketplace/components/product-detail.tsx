"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/shadcn/button";
import { Icon } from "@/components/ui/icon";
import { displayDecimal } from "@/lib/display-decimal";
import { direction, type Locale } from "@/lib/i18n/locales";
import { ProductCartAction } from "../../cart/components/product-cart-action";
import { EnquiryEntry } from "../../messaging/components/enquiry-entry";
import { marketplaceCopy } from "../copy";
import type { PublicProduct, ReviewSummary } from "../types";
import { StoreAvatar, VerifiedBusiness } from "./cards";
import { CopyLinkButton } from "./copy-link-button";
import { ProductGallery } from "./product-gallery";
import { ProductReportPanel } from "./product-report";
import { ProductTabs } from "./product-tabs";

function attributes(values: unknown, labels: unknown, locale: Locale) {
	if (!values || typeof values !== "object" || Array.isArray(values)) return [];
	const names = labels as Record<string, Record<string, string>> | null;
	return Object.entries(values)
		.filter(
			([, value]) =>
				typeof value === "number" ||
				(typeof value === "string" && value.trim()),
		)
		.map(([key, value]) => ({
			label: names?.[key]?.[locale] || names?.[key]?.["fa-AF"] || key,
			value: String(value),
		}));
}

function Price({
	label,
	value,
	unit,
	currency,
}: {
	label: string;
	value: string;
	unit: string;
	currency: string;
}) {
	return (
		<div className="min-w-0 space-y-1">
			<p className="text-sm font-medium text-muted">{label}</p>
			<p className="flex flex-wrap items-baseline gap-x-2">
				<bdi
					dir="ltr"
					className="break-all text-2xl font-bold tabular-nums text-action sm:text-3xl"
				>
					{displayDecimal(value)}{" "}
					<span className="text-sm font-semibold">{currency}</span>
				</bdi>
				<span className="text-xs text-muted">/ {unit}</span>
			</p>
		</div>
	);
}

export function ProductDetail({
	product,
	locale,
	summary,
}: {
	product: PublicProduct;
	locale: Locale;
	summary: ReviewSummary | null;
}) {
	const t = marketplaceCopy[locale];
	const query = useSearchParams();
	const [variantId, setVariantId] = useState(
		() =>
			(
				product.variants.find((row) => row.id === query.get("variant")) ??
				product.variants[0]
			)?.id,
	);
	const [imageId, setImageId] = useState<string>();
	const [canShare, setCanShare] = useState(false);
	useEffect(() => {
		setCanShare(typeof navigator.share === "function");
	}, []);

	const variant = product.variants.find((row) => row.id === variantId);
	const availability =
		variant?.availability === "available"
			? "available"
			: variant?.availability === "unavailable"
				? "unavailableStock"
				: "unknown";
	const productPath = `/${locale}/products/${product.id}`;
	const storePath = `/${locale}/stores/${product.store.id}`;
	const language = product.resolved_locale as Locale;
	const hasImages = product.images.length > 0;
	const variantImage =
		product.images.find((image) => image.variant === variantId) ??
		product.images.find((image) => !image.variant);
	const description = product.body.description.trim();
	const unit = (row: PublicProduct["variants"][number]) =>
		row.unit_labels[locale] || row.unit;
	const reviewCount =
		summary?.count ?? product.store.review_summary?.count ?? 0;
	const bodySpecs = attributes(
		product.body.attributes,
		product.body.attribute_labels,
		locale,
	);
	const descriptionPoints = [
		...bodySpecs.map(({ label, value }) => `${label}: ${value}`),
		...(variant?.contents ? [variant.contents] : []),
	].slice(0, 8);
	const specs = [
		{ label: t.sku, value: variant?.sku },
		{ label: t.brand, value: product.body.brand },
		{
			label: t.category,
			value:
				product.body.category_labels[locale] ||
				product.body.category_labels["fa-AF"] ||
				product.body.category,
		},
		{ label: t.unit, value: variant && unit(variant) },
		{ label: t.increment, value: variant && displayDecimal(variant.increment) },
		{ label: t.minimum, value: variant && displayDecimal(variant.minimum) },
		{ label: t.pricing_mode, value: t[product.pricing_mode] },
		{ label: t.availability, value: variant && t[availability] },
		...bodySpecs,
		...attributes(variant?.attributes, variant?.attribute_labels, locale),
	]
		.filter(
			(row): row is { label: string; value: string } => !!row.value?.trim(),
		)
		.filter(
			(row, index, all) =>
				all.findIndex(({ label }) => label === row.label) === index,
		);

	function selectVariant(id: string) {
		setVariantId(id);
		setImageId(undefined);
		const url = new URL(window.location.href);
		url.searchParams.set("variant", id);
		history.pushState(null, "", url);
	}

	async function share() {
		try {
			await navigator.share({
				title: product.body.title,
				url: new URL(productPath, window.location.origin).href,
			});
		} catch (error) {
			if ((error as Error).name !== "AbortError") toast.error(t.linkCopyFailed);
		}
	}

	return (
		<article
			className="min-w-0 space-y-8 lg:space-y-12"
			data-testid="product-detail"
		>
			<div
				className={
					hasImages
						? "grid items-start gap-y-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10 wide:gap-x-14"
						: "max-w-2xl space-y-5"
				}
			>
				<header
					className={
						hasImages ? "min-w-0 lg:col-start-2 lg:row-start-1" : "min-w-0"
					}
				>
					<h1
						className="wrap-break-word text-3xl font-bold leading-tight sm:text-4xl"
						lang={language}
						dir={direction(language)}
					>
						{product.body.title}
					</h1>
					{product.source_fallback && (
						<p className="mt-1.5 text-xs text-muted">{t.fallback}</p>
					)}
					<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
						<Link
							prefetch={false}
							href={storePath}
							className="inline-flex min-w-0 items-center gap-2 text-action no-underline hover:underline"
						>
							<StoreAvatar
								store={product.store}
								className="size-10"
								textClassName="text-xs"
								padding="p-0.5"
							/>
							<span className="min-w-0">
								<span className="block text-xs text-muted">{t.soldBy}</span>
								<bdi
									className="block truncate font-semibold"
									lang={product.store.resolved_locale}
								>
									{product.store.name}
								</bdi>
							</span>
						</Link>
						{product.store.verified_business && (
							<VerifiedBusiness locale={locale} />
						)}
						{reviewCount > 0 && (
							<Link
								prefetch={false}
								href={`${storePath}/reviews`}
								className="text-muted underline-offset-4 hover:underline"
							>
								{new Intl.NumberFormat(locale).format(reviewCount)}{" "}
								{t.storeReviews}
							</Link>
						)}
					</div>
				</header>
				{hasImages && (
					<section
						aria-label={t.images}
						className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1"
					>
						<ProductGallery
							images={product.images}
							locale={locale}
							activeId={imageId ?? variantImage?.id}
							onSelect={setImageId}
						/>
					</section>
				)}
				<div
					className={
						hasImages
							? "min-w-0 space-y-5 lg:col-start-2 lg:row-start-2"
							: "min-w-0 space-y-5"
					}
				>
					{product.variants.length > 1 && (
						<fieldset className="m-0 min-w-0 border-0 p-0">
							<legend className="mb-2 text-sm font-semibold">{t.choose}</legend>
							<div className="flex flex-wrap gap-2">
								{product.variants.map((row) => {
									const label =
										attributes(row.attributes, row.attribute_labels, locale)
											.map(({ value }) => value)
											.join(" / ") || row.sku;
									return (
										<Button
											key={row.id}
											type="button"
											variant={row.id === variantId ? "secondary" : "outline"}
											className="max-w-full"
											aria-pressed={row.id === variantId}
											onClick={() => selectVariant(row.id)}
										>
											<bdi className="max-w-52 truncate" title={label}>
												{label}
											</bdi>
										</Button>
									);
								})}
							</div>
						</fieldset>
					)}
					<div className="space-y-3 border-y border-solid border-border py-4">
						<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-x-4 gap-y-3">
							{variant?.retail != null && (
								<Price
									label={t.retail}
									value={variant.retail}
									unit={unit(variant)}
									currency={product.currency}
								/>
							)}
							{variant?.wholesale != null && (
								<Price
									label={t.wholesale}
									value={variant.wholesale}
									unit={unit(variant)}
									currency={product.currency}
								/>
							)}
							{variant?.retail == null && variant?.wholesale == null && (
								<p className="text-sm text-muted">{t.noPrice}</p>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
							{variant && (
								<p
									role="status"
									className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${availability === "available" ? "bg-success-surface text-success" : availability === "unavailableStock" ? "bg-danger-surface text-danger" : "bg-surface text-muted"}`}
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
								</p>
							)}
							{product.pricing_mode === "negotiable" && (
								<p className="inline-flex items-center gap-1.5 text-muted">
									<Icon name="handshake" className="size-4" />
									{t.negotiable}
								</p>
							)}
						</div>
					</div>
					{variant && (
						<ProductCartAction
							key={`${locale}:${product.id}:${variant.id}`}
							locale={locale}
							product={product}
							variant={variant.id}
						/>
					)}
					<div className="flex flex-wrap items-start gap-2 border-t border-solid border-border pt-4">
						<EnquiryEntry
							key={`${locale}:${product.id}`}
							locale={locale}
							product={product.id}
						/>
						<CopyLinkButton locale={locale} path={productPath} />
						{canShare && (
							<Button
								type="button"
								variant="outline"
								size="icon-lg"
								className="size-11"
								onClick={() => void share()}
								aria-label={t.shareLink}
								title={t.shareLink}
							>
								<Icon name="share" className="size-4" />
							</Button>
						)}
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
								{description && (
									<p
										className="whitespace-pre-wrap break-words text-sm leading-6"
										lang={language}
										dir={direction(language)}
									>
										{description}
									</p>
								)}
								{descriptionPoints.length > 0 && (
									<ul className="space-y-1.5">
										{descriptionPoints.map((point) => (
											<li key={point} className="flex gap-2 text-sm">
												<Icon
													name="check"
													className="mt-1 size-3.5 shrink-0 text-success"
												/>
												<span className="break-words">{point}</span>
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
						panel: <SpecTable rows={specs} />,
					},
					{
						id: "store-delivery",
						label: t.storeDelivery,
						panel: (
							<div className="space-y-3 text-sm">
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
