"use client";
import { useEffect, useState } from "react";
import { BrandLogo } from "../../../../components/brand/brand-logo";
import { direction, isLocale, type Locale } from "../../../../lib/i18n/locales";

interface MaintenanceProps {
	locale: Locale;
	notice?: {
		enabled: boolean;
		title?: string;
		text?: string;
		fallback?: boolean;
		content_locale?: string;
	};
	maintenanceTitle: string;
	unavailableText: string;
}

function AnimatedCharacters({ locale }: { locale: Locale }) {
	const isRTL = direction(locale) === "rtl";
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setProgress((prev) => (prev >= 100 ? 0 : prev + 1));
		}, 100);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="relative mx-auto w-full max-w-md">
			<svg
				viewBox="0 0 400 300"
				className="w-full"
				style={{ direction: "ltr" }}
				aria-hidden="true"
			>
				<defs>
					<linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
						<stop offset="0%" stopColor="var(--color-brand-soft)" />
						<stop offset="100%" stopColor="var(--color-info)" />
					</linearGradient>
					<linearGradient id="groundGradient" x1="0%" y1="0%" x2="0%" y2="100%">
						<stop offset="0%" stopColor="var(--color-surface)" />
						<stop offset="100%" stopColor="var(--color-border)" />
					</linearGradient>
				</defs>

				{/* Background */}
				<rect width="400" height="300" fill="url(#bgGradient)" rx="20" />

				{/* Ground */}
				<ellipse cx="200" cy="270" rx="180" ry="20" fill="url(#groundGradient)" opacity="0.6" />

				{/* Dynamic Status Text */}
				<text x="200" y="40" textAnchor="middle" className="fill-foreground text-sm font-semibold">
					{locale === "fa-AF" && "در حال کار..."}
					{locale === "en" && "Working..."}
					{locale === "ps" && "کار کول..."}
					{locale === "ar" && "يعمل..."}
				</text>
				<text x="200" y="60" textAnchor="middle" className="fill-muted text-xs">
					{progress}%
				</text>

				{/* Animated Gear 1 */}
				<g transform="translate(80, 100)">
					<g className="animate-spin-slow">
						<circle cx="0" cy="0" r="25" fill="none" stroke="var(--color-brand)" strokeWidth="4" />
						<circle cx="0" cy="0" r="8" fill="var(--color-brand)" />
						{[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
							<rect
								key={angle}
								x="-4"
								y="-30"
								width="8"
								height="12"
								fill="var(--color-brand)"
								transform={`rotate(${angle})`}
								rx="2"
							/>
						))}
					</g>
				</g>

				{/* Animated Gear 2 */}
				<g transform="translate(140, 130)">
					<g className="animate-spin-reverse">
						<circle cx="0" cy="0" r="18" fill="none" stroke="var(--color-action)" strokeWidth="3" />
						<circle cx="0" cy="0" r="6" fill="var(--color-action)" />
						{[0, 60, 120, 180, 240, 300].map((angle) => (
							<rect
								key={angle}
								x="-3"
								y="-22"
								width="6"
								height="9"
								fill="var(--color-action)"
								transform={`rotate(${angle})`}
								rx="1"
							/>
						))}
					</g>
				</g>

				{/* Worker Character 1 */}
				<g transform={`translate(${isRTL ? 280 : 120}, 180)`}>
					<ellipse cx="0" cy="40" rx="15" ry="20" fill="var(--color-action)" />
					<circle cx="0" cy="10" r="12" fill="var(--color-foreground)" />
					<path d="M -12 5 Q 0 -5 12 5 L 12 8 L -12 8 Z" fill="var(--color-warning)" />
					<rect x="-14" y="6" width="28" height="3" fill="var(--color-warning)" rx="1" />
					<g className="animate-wave">
						<line x1="-10" y1="25" x2="-25" y2="10" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round" />
						<circle cx="-25" cy="10" r="4" fill="var(--color-foreground)" />
					</g>
					<line x1="10" y1="25" x2="20" y2="35" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round" />
					<line x1="-5" y1="55" x2="-8" y2="75" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round" />
					<line x1="5" y1="55" x2="8" y2="75" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round" />
					<g transform="translate(-25, 10) rotate(-45)">
						<rect x="-2" y="-15" width="4" height="20" fill="var(--color-muted)" rx="1" />
						<circle cx="0" cy="-15" r="5" fill="none" stroke="var(--color-muted)" strokeWidth="2" />
					</g>
				</g>

				{/* Worker Character 2 */}
				<g transform={`translate(${isRTL ? 320 : 280}, 190)`}>
					<ellipse cx="0" cy="35" rx="13" ry="18" fill="var(--color-brand)" />
					<circle cx="0" cy="8" r="10" fill="var(--color-foreground)" />
					<path d="M -10 3 Q 0 -5 10 3 L 10 6 L -10 6 Z" fill="var(--color-warning)" />
					<rect x="-12" y="4" width="24" height="3" fill="var(--color-warning)" rx="1" />
					<line x1="-8" y1="22" x2="-15" y2="30" stroke="var(--color-foreground)" strokeWidth="3" strokeLinecap="round" />
					<g className="animate-wave-delayed">
						<line x1="8" y1="22" x2="20" y2="15" stroke="var(--color-foreground)" strokeWidth="3" strokeLinecap="round" />
						<circle cx="20" cy="15" r="3" fill="var(--color-foreground)" />
					</g>
					<line x1="-4" y1="50" x2="-6" y2="68" stroke="var(--color-foreground)" strokeWidth="3" strokeLinecap="round" />
					<line x1="4" y1="50" x2="6" y2="68" stroke="var(--color-foreground)" strokeWidth="3" strokeLinecap="round" />
					<g transform="translate(20, 15)">
						<rect x="-6" y="-8" width="12" height="16" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1" rx="1" />
						<line x1="-4" y1="-4" x2="4" y2="-4" stroke="var(--color-muted)" strokeWidth="1" />
						<line x1="-4" y1="0" x2="4" y2="0" stroke="var(--color-muted)" strokeWidth="1" />
						<line x1="-4" y1="4" x2="2" y2="4" stroke="var(--color-muted)" strokeWidth="1" />
					</g>
				</g>

				{/* Floating Tools */}
				<g className="animate-float">
					<g transform="translate(60, 180)">
						<rect x="-2" y="-10" width="4" height="20" fill="var(--color-muted)" rx="1" />
						<rect x="-8" y="-15" width="16" height="8" fill="var(--color-foreground)" rx="2" />
					</g>
				</g>

				<g className="animate-float-delayed">
					<g transform="translate(340, 160)">
						<rect x="-2" y="-8" width="4" height="16" fill="var(--color-muted)" rx="1" />
						<rect x="-4" y="-12" width="8" height="6" fill="var(--color-action)" rx="1" />
					</g>
				</g>

				{/* Progress Bar */}
				<g transform="translate(100, 240)">
					<rect x="0" y="0" width="200" height="8" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1" rx="4" />
					<rect x="0" y="0" width={progress * 2} height="8" fill="var(--color-brand)" rx="4" />
				</g>

				{/* Sparkles */}
				<g className="animate-sparkle">
					<path d="M 50 80 L 52 85 L 57 87 L 52 89 L 50 94 L 48 89 L 43 87 L 48 85 Z" fill="var(--color-warning)" />
				</g>
				<g className="animate-sparkle-delayed">
					<path d="M 350 100 L 352 105 L 357 107 L 352 109 L 350 114 L 348 109 L 343 107 L 348 105 Z" fill="var(--color-warning)" />
				</g>
			</svg>
		</div>
	);
}

export function UnavailableContent({
	locale,
	notice,
	maintenanceTitle,
	unavailableText,
}: MaintenanceProps) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const contentLocale = notice?.enabled && isLocale(notice.content_locale)
		? notice.content_locale
		: locale;
	const title = notice?.enabled ? notice.title : maintenanceTitle;
	const text = notice?.enabled ? notice.text : unavailableText;

	return (
		<main id="main" className="relative min-h-screen">
			{/* Full-width Gradient Background */}
			<div className="absolute inset-0 bg-gradient-to-br from-brand/8 via-info/5 to-action/8" />

			{/* Content */}
			<div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16">
				<BrandLogo locale={locale} />

				{/* Animated Characters */}
				<div
					className={`relative w-full transition-all duration-700 ${
						mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
					}`}
				>
					<AnimatedCharacters locale={locale as Locale} />
				</div>

				{/* Minimal Content */}
				<div
					className={`relative w-full space-y-4 text-center transition-all duration-700 delay-200 ${
						mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
					}`}
					lang={contentLocale}
					dir={direction(contentLocale)}
				>
					<h1 className="text-2xl font-bold text-foreground">
						{title}
					</h1>
					<p className="text-base leading-relaxed text-muted">
						{text}
					</p>

					{/* Animated Dots */}
					<div className="flex items-center justify-center gap-2 pt-2">
						<div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:0ms]" />
						<div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:150ms]" />
						<div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:300ms]" />
					</div>
				</div>

				{/* Footer Note */}
				<p className="text-center text-sm text-muted">
					{locale === "fa-AF" && "تیم پشتیبانی در حال کار است"}
					{locale === "en" && "Our team is working on it"}
					{locale === "ps" && "زموږ ټیم پر دې کار کوي"}
					{locale === "ar" && "فريقنا يعمل على ذلك"}
				</p>
			</div>
		</main>
	);
}
