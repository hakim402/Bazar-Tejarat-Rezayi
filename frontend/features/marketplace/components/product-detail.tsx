"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/shadcn/button";
import { Icon } from "@/components/ui/icon";
import { displayDecimal } from "@/lib/display-decimal";
import { catalogueCopy } from "@/lib/i18n/catalogue";
import { direction, type Locale } from "@/lib/i18n/locales";
import { ProductCartAction } from "../../cart/components/product-cart-action";
import { EnquiryEntry } from "../../messaging/components/enquiry-entry";
import { communicationCopy } from "../../messaging/copy";
import { marketplaceCopy } from "../copy";
import type { PublicProduct, ReviewSummary } from "../types";
import { StoreAvatar, VerifiedBusiness } from "./cards";
import { CopyLinkButton } from "./copy-link-button";
import { ProductGallery } from "./product-gallery";
import { ProductReportPanel } from "./product-report";

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
	value,
	unit,
	currency,
	className,
}: {
	value: string;
	unit: string;
	currency: string;
	className: string;
}) {
	return (
		<span className="inline-flex flex-wrap items-baseline gap-x-1.5">
			<bdi dir="ltr" className={className}>
				{displayDecimal(value)} {currency}
			</bdi>
			<span className="text-muted">/ {unit}</span>
		</span>
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
	const [reportOpened, setReportOpened] = useState(false);
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
	const specs = [
		{ label: t.sku, value: variant?.sku },
		{ label: t.brand, value: product.body.brand },
		{ label: catalogueCopy[locale].contents, value: variant?.contents },
		...attributes(
			product.body.attributes,
			product.body.attribute_labels,
			locale,
		),
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
			className="min-w-0 space-y-8 desktop:space-y-10"
			data-testid="product-detail"
		>
			<div
				className={
					hasImages
						? "grid items-start gap-5 desktop:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] desktop:grid-rows-[auto_1fr] desktop:gap-x-10"
						: "max-w-2xl space-y-5"
				}
			>
				<header
					className={
						hasImages
							? "min-w-0 desktop:col-start-2 desktop:row-start-1"
							: "min-w-0"
					}
				>
					<h1
						className="wrap-break-word text-2xl font-bold leading-tight sm:text-3xl"
						lang={language}
						dir={direction(language)}
					>
						{product.body.title}
					</h1>
					{product.source_fallback && (
						<p className="mt-1.5 text-xs text-muted">{t.fallback}</p>
					)}
					<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
						<Link
							prefetch={false}
							href={storePath}
							className="inline-flex min-w-0 items-center gap-2 text-action no-underline hover:underline"
						>
							<StoreAvatar
								store={product.store}
								className="size-8"
								textClassName="text-xs"
								padding="p-0.5"
							/>
							<span className="min-w-0 truncate">
								<span className="me-1.5 text-muted">{t.soldBy}</span>
								<bdi
									className="font-semibold"
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
						className="min-w-0 desktop:col-start-1 desktop:row-span-2 desktop:row-start-1"
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
							? "min-w-0 space-y-5 desktop:col-start-2 desktop:row-start-2"
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
					<div className="space-y-2 border-y border-border py-4 text-sm">
						{variant?.retail != null ? (
							<p>
								<Price
									value={variant.retail}
									unit={unit(variant)}
									currency={product.currency}
									className="text-3xl font-bold tracking-tight text-action"
								/>
							</p>
						) : (
							variant?.wholesale == null && (
								<p className="text-muted">{t.noPrice}</p>
							)
						)}
						{variant?.wholesale != null && (
							<p className="flex flex-wrap items-baseline gap-x-2">
								<span className="text-muted">{t.wholesale}</span>
								<Price
									value={variant.wholesale}
									unit={unit(variant)}
									currency={product.currency}
									className={
										variant.retail == null
											? "text-2xl font-bold text-action"
											: "font-semibold"
									}
								/>
							</p>
						)}
						<div className="flex flex-wrap gap-x-4 gap-y-1">
							{variant && (
								<p
									role="status"
									className={`inline-flex items-center gap-1.5 ${availability === "available" ? "text-success" : availability === "unavailableStock" ? "text-danger" : "text-muted"}`}
								>
									<Icon
										name={
											availability === "available"
												? "check-circle"
												: availability === "unavailableStock"
													? "close"
													: "help"
										}
										className="size-4"
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
					<div className="flex flex-wrap items-start gap-2">
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
			{(description || specs.length > 0) && (
				<div
					className={`grid gap-7 border-t border-border pt-6 ${description && specs.length > 0 ? "desktop:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] desktop:gap-10" : ""}`}
				>
					{description && (
						<section className="min-w-0 space-y-3">
							<h2 className="text-lg font-bold">{t.productDescription}</h2>
							<p
								className="max-w-prose wrap-break-word whitespace-pre-wrap text-sm leading-relaxed text-muted"
								lang={language}
								dir={direction(language)}
							>
								{description}
							</p>
						</section>
					)}
					{specs.length > 0 && (
						<section className="min-w-0 space-y-2">
							<h2 className="text-lg font-bold">{t.specifications}</h2>
							<dl className="max-w-2xl divide-y divide-border text-sm">
								{specs.map(({ label, value }) => (
									<div
										key={label}
										className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 py-2.5"
									>
										<dt className="wrap-break-word text-muted">{label}</dt>
										<dd className="wrap-break-word">
											<bdi>{value}</bdi>
										</dd>
									</div>
								))}
							</dl>
						</section>
					)}
				</div>
			)}
			<details
				className="group/report border-t border-border pt-3"
				onToggle={(event) => {
					if (event.currentTarget.open) setReportOpened(true);
				}}
			>
				<summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-muted hover:text-action [&::-webkit-details-marker]:hidden">
					<Icon name="shield" className="size-4" />
					{communicationCopy[locale].reportProduct}
					<Icon
						name="chevron-down"
						className="size-4 transition-transform group-open/report:rotate-180 motion-reduce:transition-none"
					/>
				</summary>
				{reportOpened && (
					<div className="max-w-2xl pb-3">
						<ProductReportPanel locale={locale} id={product.id} />
					</div>
				)}
			</details>
		</article>
	);
}
