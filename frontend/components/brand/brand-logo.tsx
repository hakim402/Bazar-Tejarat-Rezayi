"use client";
import { useSite } from "../../features/site/context";
import type { Locale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
const sizes = {
	"fa-AF": [836, 240],
	ps: [764, 240],
	ar: [770, 240],
	en: [1080, 252],
} as const;
export function BrandLogo({
	locale,
	reversed = false,
	className = "w-44 desktop:w-52",
}: {
	locale: Locale;
	reversed?: boolean;
	className?: string;
}) {
	const site = useSite(),
		[width, height] = sizes[locale];
	function logo(white: boolean, classes: string) {
		const fallback = `/brand/${locale}-horizontal-${white ? "white" : "blue"}.svg`,
			replacement = white
				? site?.identity.logo_dark
				: site?.identity.logo_light;
		// Native raster replacements share the inspected site-public media boundary.
		return (
			// biome-ignore lint/performance/noImgElement: native original SVGs and inspected public replacements use no remote image proxy.
			<img
				className={`h-auto w-full max-h-20 object-contain ${classes}`}
				src={replacement?.url ?? fallback}
				width={replacement?.width ?? width}
				height={replacement?.height ?? height}
				alt=""
				onError={(event) => {
					if (event.currentTarget.getAttribute("src") !== fallback)
						event.currentTarget.src = fallback;
				}}
			/>
		);
	}
	return (
		<span
			className={`inline-flex max-w-full shrink-0 items-center ${className}`}
			role="img"
			aria-label={site?.identity.name || messages[locale].brand}
		>
			{logo(reversed, reversed ? "" : "dark:hidden")}
			{!reversed && logo(true, "hidden dark:block")}
		</span>
	);
}
