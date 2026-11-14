import { direction, type Locale } from "../../../lib/i18n/locales";
import { siteCopy } from "../../../lib/i18n/site";
import { Icon, type IconName } from "../../../components/ui/icon";
import { heroHref } from "../../storefront/data";
import type { Page } from "../api";
const groupIcon: Record<Page["group"], IconName> = {
	company: "store",
	help: "help",
	legal: "file",
	hidden: "file",
};
function CtaLink({
	locale,
	cta,
	primary = false,
}: {
	locale: Locale;
	cta: { label: string; url: string };
	primary?: boolean;
}) {
	const external = !cta.url.startsWith("/");
	// Long labels shrink on phones so a stacked button never overflows.
	const size =
		cta.label.length > 24
			? "min-h-11 px-4 py-2 text-xs"
			: "min-h-12 px-5 py-2.5 text-sm";
	const frame = `inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-control text-center font-bold leading-snug no-underline break-words desktop:w-auto desktop:max-w-none desktop:min-h-13 desktop:px-6 desktop:py-3 desktop:text-base ${size}`;
	return (
		<a
			href={heroHref(locale, cta.url)}
			{...(external ? { target: "_blank", rel: "nofollow noopener" } : {})}
			className={
				primary
					? `${frame} bg-brand-ink text-brand-panel shadow-card hover:brightness-95`
					: `${frame} border border-brand-ink/40 text-brand-ink hover:bg-brand-ink/10`
			}
		>
			{cta.label}
			{primary && (
				<Icon
					name="arrow"
					className="size-4 shrink-0 rtl:rotate-180 desktop:size-5"
				/>
			)}
		</a>
	);
}
/** Brand-gradient hero for owner-authored pages; CTAs come from the CMS. */
export function PageHero({ locale, page }: { locale: Locale; page: Page }) {
	const t = siteCopy[locale],
		groupLabel = page.group === "hidden" ? "" : t.pageGroups[page.group],
		primary =
			page.cta_label && page.cta_url
				? { label: page.cta_label, url: page.cta_url }
				: null,
		secondary =
			page.cta_secondary_label && page.cta_secondary_url
				? { label: page.cta_secondary_label, url: page.cta_secondary_url }
				: null;
	return (
		<header
			className={`page-hero relative isolate overflow-hidden rounded-card border border-border bg-linear-to-br from-brand to-brand-panel text-brand-ink ${page.cover ? "desktop:grid desktop:grid-cols-[1.15fr_0.85fr]" : ""}`}
		>
			<div
				className="relative z-10 min-w-0 p-6 text-center desktop:p-10 desktop:text-start"
				lang={page.content_locale}
				dir={direction(page.content_locale)}
			>
				{groupLabel && (
					<span className="inline-flex items-center gap-2 rounded-full bg-brand-ink/15 px-3 py-1 text-xs font-bold">
						<Icon name={groupIcon[page.group]} className="size-4" />
						{groupLabel}
					</span>
				)}
				<h1
					className={`mx-auto mt-4 max-w-2xl leading-tight desktop:mx-0 ${page.title.length > 40 ? "text-2xl" : "text-3xl"} desktop:text-5xl`}
				>
					{page.title}
				</h1>
				{page.intro && (
					<p className="mx-auto mt-4 max-w-xl text-base leading-8 opacity-90 desktop:mx-0 desktop:text-lg">
						{page.intro}
					</p>
				)}
				{page.fallback && (
					<p
						lang={locale}
						dir={direction(locale)}
						className="mt-4 inline-flex rounded-control bg-brand-ink/10 px-3 py-1 text-xs"
					>
						{t.fallback}
					</p>
				)}
				{(primary || secondary) && (
					<div className="mt-7 flex flex-col items-center gap-3 desktop:flex-row desktop:flex-wrap">
						{primary && <CtaLink locale={locale} cta={primary} primary />}
						{secondary && <CtaLink locale={locale} cta={secondary} />}
					</div>
				)}
			</div>
			{page.cover && (
				<div className="relative z-10 min-h-52 desktop:min-h-full">
					{/* biome-ignore lint/performance/noImgElement: CMS covers use the validated media origin; next/image remote patterns are not configured. */}
					<img
						src={page.cover.url}
						alt=""
						width={page.cover.width}
						height={page.cover.height}
						loading="lazy"
						decoding="async"
						className="absolute inset-0 h-full w-full object-cover"
					/>
					<div
						aria-hidden="true"
						className="absolute inset-0 bg-linear-to-t from-brand-panel/50 to-transparent desktop:bg-linear-to-r desktop:from-brand-panel/40 desktop:to-transparent"
					/>
				</div>
			)}
		</header>
	);
}
