"use client";
import { useState } from "react";
import Image from "next/image";
import { apiOrigin } from "../../../lib/api/client";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { direction, type Locale } from "../../../lib/i18n/locales";
import type { ProductBody, ProductDetail } from "../types";
export function ProductRevisionPreview({
	locale,
	body,
	item,
	label,
	revision,
}: {
	locale: Locale;
	body: ProductBody;
	item: Pick<
		ProductDetail,
		"seller_name" | "currency" | "pricing_mode" | "images" | "prices"
	>;
	label: string;
	revision?: string;
}) {
	const t = catalogueCopy[locale];
	const [selected, setSelected] = useState(0);
	const rows = body.variants.filter((v) => v.active);
	const variant = rows[selected] ?? rows[0];
	const price = item.prices.find((p) => p.id === variant?.id) ?? variant;
	return (
		<section
			className="min-w-0 space-y-5 rounded-card border border-border bg-background p-4 desktop:p-6"
			aria-label={label}
		>
			<h2 className="text-xl">{label}</h2>
			{revision && (
				<p className="text-sm break-all">
					<bdi>{revision}</bdi> · {body.locale}
				</p>
			)}
			<div className="grid gap-6 desktop:grid-cols-2">
				<div className="space-y-3">
					{body.images.map((ref, i) => {
						const image = item.images.find((img) => img.id === ref.id);
						return image ? (
							<Image
								unoptimized
								key={ref.id}
								className={
									i === 0
										? "aspect-square h-auto w-full rounded-card object-contain bg-surface"
										: "inline-block size-20 rounded-control object-contain"
								}
								src={apiOrigin(process.env.NEXT_PUBLIC_API_URL) + image.url}
								alt={ref.alt}
								width={image.width}
								height={image.height}
							/>
						) : null;
					})}
				</div>
				<div className="space-y-4">
					<h3
						lang={body.locale}
						dir={direction(body.locale)}
						className="text-2xl break-words"
					>
						{body.title}
					</h3>
					<p>{item.seller_name}</p>
					<strong className="text-action">
						{item.pricing_mode === "fixed" ? t.fixed : t.negotiable}
					</strong>
					{item.pricing_mode === "negotiable" && <p>{t.reference}</p>}
					<div className="rounded-card border border-border bg-surface p-4 space-y-3">
						{(["retail", "wholesale"] as const).map((k) => (
							<p key={k}>
								{t[k]}:{" "}
								<bdi className="text-xl font-bold">
									{item.currency} {price?.[k] ?? "—"}
								</bdi>{" "}
								/ <bdi>{variant?.unit_labels?.[locale] ?? variant?.unit}</bdi>
							</p>
						))}
						<p>
							{t.minimum}:{" "}
							<bdi>
								{variant?.minimum}{" "}
								{variant?.unit_labels?.[locale] ?? variant?.unit}
							</bdi>
						</p>
						{variant?.contents && <p>{variant.contents}</p>}
					</div>
					<div className="flex flex-wrap gap-3">
						{rows.map((v, i) => (
							<button
								key={v.id ?? v.clientKey}
								type="button"
								className="min-h-11 rounded-control border border-control px-4 aria-pressed:bg-primary aria-pressed:text-on-primary"
								aria-pressed={i === selected}
								onClick={() => setSelected(i)}
							>
								<bdi>{v.sku}</bdi> {Object.values(v.attributes).join(" · ")}
							</button>
						))}
					</div>
					<p>
						<bdi>{variant?.sku}</bdi>
					</p>
					<p className="text-muted">{t.wholesaleRule}</p>
					<p className="rounded-control bg-warning-surface p-3 text-warning">
						{t.inventory}
					</p>
					<p>{t.noCommerce}</p>
				</div>
			</div>
			<p
				lang={body.locale}
				dir={direction(body.locale)}
				className="whitespace-pre-wrap leading-loose break-words"
			>
				{body.description}
			</p>
			{Object.entries(body.attributes).map(([k, v]) => (
				<p key={k}>
					<span>{body.attribute_labels?.[k]?.[locale] ?? k}</span>: {String(v)}
				</p>
			))}
		</section>
	);
}
