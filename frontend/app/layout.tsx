import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { defaultLocale, direction, isLocale } from "../lib/i18n/locales";
import "./globals.css";
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
const themeScript = `(function(){try{var t=localStorage.getItem('rezayi-theme');if(['light','dark','system'].includes(t))document.documentElement.dataset.theme=t}catch(e){}})()`;
export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const value = (await headers()).get("x-rezayi-locale") ?? defaultLocale;
	const locale = isLocale(value) ? value : defaultLocale;
	return (
		<html
			lang={locale}
			dir={direction(locale)}
			suppressHydrationWarning
			className={`${arabic.variable} ${heading.variable} ${latin.variable}`}
		>
			<head>
				<script id="theme-init">{themeScript}</script>
			</head>
			<body>{children}</body>
		</html>
	);
}
