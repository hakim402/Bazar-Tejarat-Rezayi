import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { defaultLocale, direction, isLocale } from "../lib/i18n/locales";
import "./globals.css";
import { readSite } from "../features/site/server";
import { bundledSite } from "../features/site/contract";
import { SiteProvider } from "../features/site/context";
import { ReviewOriginRedirect } from "../components/layout/review-origin-redirect";
const arabic = localFont({
	src: [
		{ path: "../public/fonts/NotoSansArabic-Regular.ttf", weight: "400" },
		{ path: "../public/fonts/NotoSansArabic-Bold.ttf", weight: "700" },
	],
	variable: "--font-arabic",
	display: "swap",
});
const heading = localFont({
	src: "../public/fonts/NotoNaskhArabic-Bold.ttf",
	weight: "700",
	variable: "--font-heading",
	display: "swap",
});
const latin = localFont({
	src: [
		{ path: "../public/fonts/NotoSans-Regular.ttf", weight: "400" },
		{ path: "../public/fonts/NotoSans-Bold.ttf", weight: "700" },
	],
	variable: "--font-latin",
	display: "swap",
});
// Private/unknown routes inherit noindex; approved public pages override explicitly.
export const metadata = { robots: { index: false, follow: false } };
const themeScript = `(function(){try{var t=localStorage.getItem('rezayi-theme');if(['light','dark','system'].includes(t))document.documentElement.dataset.theme=t}catch(e){}})()`;
export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const value = (await headers()).get("x-rezayi-locale") ?? defaultLocale;
	const locale = isLocale(value) ? value : defaultLocale;
	const site = (await readSite(locale)) ?? bundledSite(locale);
	return (
		<html
			lang={locale}
			data-theme={site.default_theme}
			dir={direction(locale)}
			suppressHydrationWarning
			className={`${arabic.variable} ${heading.variable} ${latin.variable}`}
		>
			<head>
				<script id="theme-init">{themeScript}</script>
			</head>
			<body>
				<ReviewOriginRedirect />
				<SiteProvider site={site}>{children}</SiteProvider>
			</body>
		</html>
	);
}
