"use client";
import { useState } from "react";
import Image from "next/image";
import { Icon } from "../../../components/ui/icon";
import { apiOrigin } from "../../../lib/api/client";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { interfaceCopy } from "../../../lib/i18n/interface";
import {
	direction,
	languageNames,
	type Locale,
} from "../../../lib/i18n/locales";
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
	const t = catalogueCopy[locale],
		ui = interfaceCopy[locale];
	const [selected, setSelected] = useState(0),
		[photo, setPhoto] = useState(0);
	const rows = body.variants.filter((v) => v.active),
		variant = rows[selected] ?? rows[0],
		price = item.prices.find((p) => p.id === variant?.id) ?? variant;
	const images = body.images.flatMap((ref) => {
		const image = item.images.find((img) => img.id === ref.id);
		return image ? [{ ...image, alt: ref.alt }] : [];
	});
	const current = images[Math.min(photo, images.length - 1)],
		unit = variant?.unit_labels?.[locale] ?? variant?.unit;
	return (
		<section
			className="min-w-0 space-y-6 rounded-card border border-border bg-surface p-4 shadow-card desktop:p-6"
			aria-label={label}
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
				<h2 className="text-base text-muted">{label}</h2>
				{revision && (
					<p className="text-xs text-muted wrap-anywhere">
						<bdi>{revision}</bdi> · {body.locale}
					</p>
				)}
			</header>
			<div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
				<section className="min-w-0 space-y-3" aria-label={ui.gallery}>
					<div className="flex aspect-square items-center justify-center overflow-hidden rounded-card border border-border bg-page">
						{current ? (
							<Image
								unoptimized
								className="h-full w-full object-contain"
								src={apiOrigin(process.env.NEXT_PUBLIC_API_URL) + current.url}
								alt={current.alt}
								width={current.width}
								height={current.height}
							/>
						) : (
							<div className="space-y-3 p-6 text-center text-muted">
								<Icon name="box" className="mx-auto size-12" />
								<p className="text-sm">{ui.noImage}</p>
							</div>
						)}
					</div>
					{images.length > 1 && (
						<div className="flex gap-2 overflow-x-auto pb-2">
							{images.map((image, i) => (
								<button
									key={image.id}
									type="button"
									aria-label={`${ui.image} ${i + 1}: ${image.alt}`}
									aria-pressed={image.id === current?.id}
									onClick={() => setPhoto(i)}
									className="size-20 shrink-0 overflow-hidden rounded-control border-2 border-border bg-page p-1 aria-pressed:border-action"
								>
									<Image
										unoptimized
										className="h-full w-full object-contain"
										src={apiOrigin(process.env.NEXT_PUBLIC_API_URL) + image.url}
										alt=""
										width={80}
										height={80}
									/>
								</button>
							))}
						</div>
					)}
				</section>
				<div className="min-w-0 space-y-5">
					<div className="space-y-2">
						<p className="text-sm text-action">{body.brand}</p>
						<h3
							lang={body.locale}
							dir={direction(body.locale)}
							className="text-2xl desktop:text-3xl"
						>
							{body.title}
						</h3>
						<p className="text-xs text-muted">
							{ui.source}:{" "}
							<span lang={body.locale}>{languageNames[body.locale]}</span>
						</p>
					</div>
					<div className="space-y-3 rounded-card border border-border bg-info p-5">
						<strong className="inline-block rounded-full bg-surface px-3 py-1 text-xs text-action">
							{item.pricing_mode === "fixed" ? t.fixed : t.negotiable}
						</strong>
						{(["retail", "wholesale"] as const).map((k) => (
							<div
								key={k}
								className="flex flex-wrap items-baseline justify-between gap-2"
							>
								<span className="text-sm text-muted">{t[k]}</span>
								<span>
									<bdi dir="ltr" className="font-identifier text-2xl font-bold">
										{price?.[k] ?? "—"} {item.currency}
									</bdi>{" "}
									<span className="text-sm">
										/ <bdi>{unit}</bdi>
									</span>
								</span>
							</div>
						))}
						<p className="border-t border-border pt-3 text-sm">
							{t.minimum}:{" "}
							<bdi>
								{variant?.minimum} {unit}
							</bdi>
						</p>
						{variant?.contents && <p className="text-sm">{variant.contents}</p>}
						{item.pricing_mode === "negotiable" && (
							<p className="text-sm text-muted">{t.reference}</p>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						{rows.map((v, i) => (
							<button
								key={v.id ?? v.clientKey ?? v.sku}
								type="button"
								aria-pressed={v === variant}
								onClick={() => setSelected(i)}
								className="min-h-11 rounded-control border border-control px-3 py-2 text-sm aria-pressed:border-action aria-pressed:bg-info aria-pressed:text-action"
							>
								<bdi>{v.sku}</bdi> {Object.values(v.attributes).join(" · ")}
							</button>
						))}
					</div>
					<div className="flex items-center gap-3 rounded-card border border-border p-4">
						<span className="flex size-11 items-center justify-center rounded-control bg-info text-action">
							<Icon name="store" />
						</span>
						<div className="min-w-0">
							<p className="text-xs text-muted">{ui.seller}</p>
							<strong className="wrap-anywhere">{item.seller_name}</strong>
						</div>
					</div>
					<p className="text-sm text-muted">{t.wholesaleRule}</p>
					<p className="rounded-control bg-warning-surface p-3 text-sm text-warning">
						{t.inventory}
					</p>
					<p className="text-sm text-muted">{t.noCommerce}</p>
				</div>
			</div>
			<section className="space-y-4 border-t border-border pt-5">
				<h3 className="text-lg">{ui.details}</h3>
				<p
					lang={body.locale}
					dir={direction(body.locale)}
					className="whitespace-pre-wrap leading-8 wrap-anywhere"
				>
					{body.description}
				</p>
				{!!Object.keys(body.attributes).length && (
					<dl className="overflow-hidden rounded-control border border-border">
						{Object.entries(body.attributes).map(([k, v]) => (
							<div
								key={k}
								className="grid grid-cols-2 gap-3 border-b border-border bg-page px-4 py-3 last:border-0"
							>
								<dt className="text-sm text-muted">
									{body.attribute_labels?.[k]?.[locale] ?? k}
								</dt>
								<dd className="m-0 text-sm wrap-anywhere">{String(v)}</dd>
							</div>
						))}
					</dl>
				)}
			</section>
		</section>
	);
}
