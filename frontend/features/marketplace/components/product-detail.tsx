"use client";
import { useState } from "react";
import { EnquiryEntry } from "../../messaging/components/enquiry-entry";
import { ProductCartAction } from "../../cart/components/product-cart-action";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../lib/i18n/locales";
import type { PublicProduct } from "../types";
import { marketplaceCopy } from "../copy";
import { Asset } from "./cards";
export function ProductDetail({
	product,
	locale,
}: {
	product: PublicProduct;
	locale: Locale;
}) {
	const t = marketplaceCopy[locale],
		query = useSearchParams(),
		initial = query.get("variant"),
		variantId = product.variants.some((v) => v.id === initial)
			? initial
			: product.variants[0]?.id,
		[imageId, setImageId] = useState(product.images[0]?.id);
	const v = product.variants.find((row) => row.id === variantId),
		image =
			product.images.find((row) => row.id === imageId) || product.images[0];
	return (
		<article
			className="grid min-w-0 gap-6 desktop:grid-cols-2"
			data-testid="product-detail"
		>
			<section className="min-w-0 space-y-3">
				{image ? (
					<Asset
						asset={image}
						loading="eager"
						className="aspect-square h-auto w-full rounded-3xl border border-border bg-surface object-contain p-5"
					/>
				) : (
					<div className="flex aspect-square items-center justify-center rounded-3xl bg-surface p-5 text-muted">
						{t.noImage}
					</div>
				)}
				<div className="flex flex-wrap gap-3">
					{product.images.map((asset) => (
						<button
							key={asset.id}
							type="button"
							className="size-20 rounded-control border border-border p-1 aria-pressed:ring-2 aria-pressed:ring-action"
							aria-pressed={image?.id === asset.id}
							aria-label={asset.alt}
							onClick={() => setImageId(asset.id)}
						>
							<Asset asset={asset} className="size-full object-contain" />
						</button>
					))}
				</div>
			</section>
			<section className="min-w-0 space-y-5">
				<h1
					className="break-words text-3xl"
					lang={product.resolved_locale}
					dir={direction(product.resolved_locale as Locale)}
				>
					{product.body.title}
				</h1>
				{product.source_fallback && (
					<p className="text-sm text-muted">{t.fallback}</p>
				)}
				<Link
					prefetch={false}
					className="inline-flex min-h-11 items-center font-bold"
					href={`/${locale}/stores/${product.store.id}`}
				>
					{product.store.name || t.stores}
				</Link>
				<p
					className="whitespace-pre-wrap break-words"
					lang={product.resolved_locale}
					dir={direction(product.resolved_locale as Locale)}
				>
					{product.body.description}
				</p>
				{product.body.brand && (
					<p className="font-bold">{product.body.brand}</p>
				)}
				<Attributes
					values={product.body.attributes}
					labels={product.body.attribute_labels}
					locale={locale}
				/>
				<label className="block space-y-2">
					<span>{t.choose}</span>
					<select
						className="min-h-11 w-full rounded-control border border-border bg-surface px-3"
						value={variantId || ""}
						onChange={(event) => {
							const next = new URL(location.href);
							next.searchParams.set("variant", event.target.value);
							history.pushState(null, "", next);
							const picture = product.images.find(
								(row) => row.variant === event.target.value,
							);
							if (picture) setImageId(picture.id);
						}}
					>
						{product.variants.map((row) => (
							<option key={row.id} value={row.id}>
								{row.sku} ·{" "}
								{Object.values(row.attributes as Record<string, string>).join(
									" / ",
								)}{" "}
								· {row.unit_labels[locale] || row.unit}
							</option>
						))}
					</select>
				</label>
				{v && (
					<div className="space-y-3 rounded-card border border-border bg-surface p-5">
						<p className="font-bold">{t[product.pricing_mode]}</p>
						<Attributes
							values={v.attributes}
							labels={v.attribute_labels}
							locale={locale}
						/>
						{(["retail", "wholesale"] as const).map((tier) => (
							<p key={tier}>
								{t[tier]}:{" "}
								{v[tier] === null ? (
									t.noPrice
								) : (
									<>
										<bdi dir="ltr">
											{v[tier]} {product.currency}
										</bdi>{" "}
										/ {v.unit_labels[locale] || v.unit}
									</>
								)}
							</p>
						))}
						<p>
							{t.increment}: <bdi dir="ltr">{v.increment}</bdi>{" "}
							{v.unit_labels[locale] || v.unit}
						</p>
						<p>
							{t.minimum}: <bdi dir="ltr">{v.minimum}</bdi>{" "}
							{v.unit_labels[locale] || v.unit}
						</p>
						{v.contents && <p>{v.contents}</p>}
						<p role="status">
							{
								t[
									v.availability === "unavailable"
										? "unavailableStock"
										: v.availability
								]
							}
						</p>
					</div>
				)}
				<p className="text-sm text-muted">{t.wholesaleRule}</p>
				<p className="text-sm text-muted">{t.delivery}</p>
                <EnquiryEntry key={`${locale}:${product.id}`} locale={locale} product={product.id} />
                {v && <ProductCartAction key={`${locale}:${product.id}:${v.id}`} locale={locale} product={product} variant={v.id}/>}
			</section>
		</article>
	);
}
function Attributes({
	values,
	labels,
	locale,
}: {
	values: unknown;
	labels: unknown;
	locale: Locale;
}) {
	if (!values || typeof values !== "object" || Array.isArray(values))
		return null;
	const names =
		labels && typeof labels === "object"
			? (labels as Record<string, Record<string, string>>)
			: {};
	return (
		<dl className="space-y-2">
			{Object.entries(values).map(([key, value]) => (
				<div key={key} className="flex flex-wrap gap-3">
					<dt className="text-muted">
						{names[key]?.[locale] || names[key]?.["fa-AF"] || key}
					</dt>
					<dd className="break-words">{String(value)}</dd>
				</div>
			))}
		</dl>
	);
}
