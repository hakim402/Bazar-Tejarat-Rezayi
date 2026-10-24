import Image from "next/image";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { siteCopy } from "../../lib/i18n/site";
import type { Site } from "../site/contract";
import { Hero } from "../site/hero";
import { Icon, type IconName } from "../../components/ui/icon";
import {
	categories,
	categoryHref,
	demoProducts,
	heroHref,
	productImage,
} from "./data";
import { storefrontCopy } from "./copy";
import { PromotionalVideo } from "./promotional-video";
import { DemoPreview } from "./preview";
export function HomeShowcase({
	locale,
	hero,
}: {
	locale: Locale;
	hero: Site["hero"];
}) {
	const t = storefrontCopy[locale];
	const recommended = hero.cards ?? [];
	return (
		<div className="mx-auto w-[95%] py-5 desktop:py-7">
			<div
				className={`grid min-w-0 gap-5 ${recommended.length ? "min-[1100px]:grid-cols-[13.5rem_minmax(0,1fr)_15.5rem]" : "min-[1100px]:grid-cols-[13.5rem_minmax(0,1fr)]"}`}
			>
				<aside className="hidden min-w-0 rounded-3xl border border-border/70 bg-surface p-3 shadow-card min-[1100px]:row-span-2 min-[1100px]:block">
					<h2 className="mb-4 px-3 pt-3 text-base">{t.categories}</h2>
					<div className="ms-3 mb-3 h-0.5 w-7 rounded-full bg-action" />
					<nav aria-label={t.categories}>
						{categories.map(({ id, icon }) => (
							<a
								key={id}
								href={categoryHref(locale, id)}
								className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-foreground no-underline transition-colors hover:bg-info hover:text-action"
							>
								<Icon name={icon} className="size-4" />
								<span>{t.categoryNames[id]}</span>
							</a>
						))}
					</nav>
				</aside>
				<div className="min-h-[23rem] min-w-0">
					<Hero locale={locale} hero={hero} />
				</div>
				{recommended.length > 0 && (
					<aside
						aria-label={t.recommended}
						className={`grid min-w-0 gap-4 ${recommended.length > 1 ? "grid-cols-2" : "grid-cols-1"} min-[1100px]:grid-cols-1`}
					>
						{recommended.map((slide, index) => {
							const id = slide.slot === "promo_1" ? "clothing" : "beauty",
								image = slide.image;
							if (slide.kind === "video")
								return (
									<PromotionalVideo
										key={slide.id}
										locale={locale}
										slide={slide}
									/>
								);
							if (!image) return null;
							return (
								<article
									key={id}
									className={`relative grid min-h-40 min-w-0 grid-cols-1 items-center gap-1 min-[1100px]:grid-cols-[1.15fr_0.85fr] overflow-hidden rounded-3xl border border-border/30 bg-linear-to-br from-surface p-4 min-[1100px]:p-5 ${index === 0 ? "to-campaign-warm" : "to-campaign-lilac"}`}
								>
									<div
										className="relative z-10 min-w-0 space-y-2"
										lang={slide?.content_locale ?? locale}
										dir={direction(slide?.content_locale ?? locale)}
									>
										<p className="hidden text-[0.65rem] font-bold text-action min-[1100px]:block">
											{t.collections}
										</p>
										{slide?.fallback && (
											<p
												lang={locale}
												dir={direction(locale)}
												className="text-xs text-muted"
											>
												{siteCopy[locale].fallback}
											</p>
										)}
										<h2 className="line-clamp-2 text-sm leading-relaxed min-[1100px]:line-clamp-none min-[1100px]:text-base">
											{slide.title}
										</h2>
										<a
											href={heroHref(locale, slide.cta_url)}
											className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-action no-underline hover:underline"
										>
											{slide.cta_label}
											<Icon name="arrow" className="size-3 rtl:rotate-180" />
										</a>
									</div>
									{/* biome-ignore lint/performance/noImgElement: inspected owner card media uses the native media boundary. */}
									<img
										src={image.url}
										alt={slide?.alt ?? ""}
										width={image.width}
										height={image.height}
										loading="lazy"
										className="order-first h-24 w-full object-contain min-[1100px]:order-none min-[1100px]:h-auto min-[1100px]:max-h-40"
									/>
								</article>
							);
						})}
					</aside>
				)}
				<section
					aria-labelledby="popular-categories"
					className={`min-w-0 space-y-4 min-[1100px]:col-start-2 ${recommended.length ? "min-[1100px]:col-span-2" : ""}`}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h2 id="popular-categories" className="text-lg desktop:text-xl">
							{t.popular}
						</h2>
						<a
							href="#demo-categories"
							className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-action no-underline hover:underline"
						>
							{t.viewAll}
							<Icon name="arrow" className="size-4 rtl:rotate-180" />
						</a>
					</div>
					<div className="grid grid-cols-2 gap-3 desktop:grid-cols-4 desktop:gap-4">
						{demoProducts.map((id, index) => (
							<a
								key={id}
								href={categoryHref(locale, id)}
								className={`group flex min-w-0 flex-col items-center rounded-3xl border border-border/30 bg-linear-to-br from-surface p-4 text-center text-foreground no-underline transition-colors hover:border-action ${index === 0 ? "to-campaign-end" : index === 1 ? "to-campaign-lilac" : index === 2 ? "to-campaign-start" : "to-campaign-warm"}`}
							>
								<Image
									src={productImage(id)}
									alt={t.products[id].alt}
									width={1280}
									height={1280}
									sizes="(max-width: 767px) 160px, 220px"
									className="mb-2 h-28 w-full object-contain transition-transform motion-safe:group-hover:scale-105 desktop:h-32"
								/>
								<h3 className="text-sm">{t.categoryNames[id]}</h3>
								<span className="mt-1 text-xs text-muted">{t.demo}</span>
							</a>
						))}
					</div>
				</section>
			</div>
			<div className="mt-5 grid grid-cols-2 gap-4 rounded-3xl border border-border/70 bg-surface p-5 desktop:grid-cols-4 desktop:p-6">
				{t.benefits.map(([title, description], index) => (
					<a
						key={title}
						href={`/${locale}${["/about", "/how-it-works", "/help", "/wholesale"][index]}`}
						className="flex min-w-0 items-center gap-3 text-foreground no-underline"
					>
						<span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-info text-action">
							<Icon
								name={(["grid", "file", "help", "store"] as IconName[])[index]}
								className="size-5"
							/>
						</span>
						<span className="min-w-0">
							<strong className="block text-xs desktop:text-sm">{title}</strong>
							<span className="mt-1 block text-xs text-muted">
								{description}
							</span>
						</span>
					</a>
				))}
			</div>
			<p className="mt-4 text-center text-xs leading-6 text-muted">
				{t.demoNotice}
			</p>
			<DemoPreview locale={locale} />
		</div>
	);
}
