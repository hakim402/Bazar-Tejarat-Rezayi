import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
import { Preferences } from "./layout/preferences";
import { authCopy } from "../lib/i18n/auth";
export function Shell({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	const t = messages[locale];
	return (
		<>
			<a href="#main" className="skip-link">
				{t.skip}
			</a>
			<header className="site-header">
				<div className="page-container header-row">
					<Link href={`/${locale}`} className="brand-link" aria-label={t.brand}>
						<Image
							className="logo-light"
							src={`/brand/${locale}-horizontal-blue.svg`}
							alt={t.brand}
							width={232}
							height={70}
							priority
						/>
						<Image
							className="logo-dark"
							src={`/brand/${locale}-horizontal-white.svg`}
							alt=""
							width={232}
							height={70}
							priority
						/>
					</Link>
					<Preferences locale={locale} />
				</div>
				<nav aria-label={t.home} className="page-container nav-row">
					<Link href={`/${locale}`} aria-current="page">
						{t.home}
					</Link>
					<span>{t.preview}</span>
					<Link href={`/${locale}/auth/buyer-sign-in`}>
						{authCopy[locale].buyerSignin}
					</Link>
					<Link href={`/${locale}/auth/seller-sign-in`}>
						{authCopy[locale].sellerSignin}
					</Link>
				</nav>
			</header>
			<main id="main" tabIndex={-1} className="page-container main-content">
				{children}
			</main>
			<footer className="site-footer">
				<div className="page-container footer-row">
					<strong>{t.brand}</strong>
					<details>
						<summary>{t.details}</summary>
						<p>{t.footer}</p>
						<p className="muted">{t.review}</p>
					</details>
					<a href={`/${locale}#main`}>{t.home}</a>
				</div>
			</footer>
		</>
	);
}
