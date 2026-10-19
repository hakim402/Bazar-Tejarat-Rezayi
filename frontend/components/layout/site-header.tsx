import Image from "next/image";
import Link from "next/link";
import type { Locale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { Preferences } from "./preferences";
export function SiteHeader({ locale }: { locale: Locale }) {
	return (
		<header className="site-header border-b border-border bg-surface">
			<div className="page-container header-row flex flex-wrap items-center justify-between gap-3 py-3.5 desktop:flex-nowrap desktop:gap-6 desktop:py-5">
				<Link
					className="brand-link flex shrink-0 items-center py-1"
					href={`/${locale}`}
					aria-label={messages[locale].brand}
				>
					<Image
						className="logo-light h-14.5 w-50 max-w-full object-contain desktop:h-17.5 desktop:w-58"
						src={`/brand/${locale}-horizontal-blue.svg`}
						alt={messages[locale].brand}
						width={232}
						height={70}
						priority
					/>
					<Image
						className="logo-dark h-14.5 w-50 max-w-full object-contain desktop:h-17.5 desktop:w-58"
						src={`/brand/${locale}-horizontal-white.svg`}
						alt=""
						width={232}
						height={70}
					/>
				</Link>
				<Preferences locale={locale} />
			</div>
		</header>
	);
}
