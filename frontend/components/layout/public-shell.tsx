import { Document } from "../../features/content/components/document";
import { SkipLink } from "../ui/skip-link";
import { authCopy } from "../../lib/i18n/auth";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { contentCopy } from "../../lib/i18n/content";
import type { Content, ContentShell } from "../../features/content/types";
import { SiteHeader } from "./site-header";
export function SupportDetails({
	resource,
	locale,
}: {
	resource?: Content | null;
	locale: Locale;
}) {
	const t = contentCopy[locale],
		support = resource?.payload.support;
	if (resource === undefined)
		return (
			<aside role="alert" className="rounded-card border border-border p-5">
				{t.outage}
			</aside>
		);
	return (
		<aside className="space-y-2 rounded-card border border-border bg-surface p-5">
			<h2 className="text-2xl">{t.contact}</h2>
			{resource?.fallback && (
				<p lang={locale} dir={direction(locale)}>
					{t.fallback}
				</p>
			)}
			{support && (support.email || support.phone || support.website) ? (
				<address className="flex min-w-0 flex-wrap gap-5 not-italic wrap-anywhere">
					{support.email && (
						<a href={`mailto:${support.email}`}>
							<bdi dir="ltr">{support.email}</bdi>
						</a>
					)}
					{support.phone && (
						<a href={`tel:${support.phone.replace(/[ ()-]/g, "")}`}>
							<bdi dir="ltr">{support.phone}</bdi>
						</a>
					)}
					{support.website && (
						<a href={support.website} rel="noopener noreferrer">
							<bdi dir="ltr">{support.website}</bdi>
						</a>
					)}
				</address>
			) : (
				<p className="text-muted">{t.noContact}</p>
			)}
		</aside>
	);
}
export function PublicShell({
	locale,
	shell,
	children,
}: {
	locale: Locale;
	shell: ContentShell | null;
	children: ReactNode;
}) {
	const t = contentCopy[locale];
	const groups = shell?.navigation?.payload.navigation ?? [];
	return (
		<>
			<SkipLink label={messages[locale].skip} />
			<SiteHeader locale={locale} />
			<nav
				aria-label={t.navigation}
				className="border-b border-border bg-surface"
			>
				<div className="page-container flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
					<Link href={`/${locale}`}>{t.home}</Link>
					<Link href={`/${locale}/help`}>{t.help}</Link>
					{groups
						.filter((g) => g.placement === "header")
						.map((g) => (
							<span
								key={g.id}
								lang={shell?.navigation?.content_locale}
								dir={direction(
									(shell?.navigation?.content_locale ?? locale) as Locale,
								)}
								className="contents"
							>
								{g.links.map((link) => (
									<Link key={link.id} href={`/${locale}${link.target}`}>
										{link.label}
									</Link>
								))}
							</span>
						))}
					<Link href={`/${locale}/auth/buyer-sign-in`}>
						{authCopy[locale].buyerSignin}
					</Link>
					<Link href={`/${locale}/auth/seller-sign-in`}>
						{authCopy[locale].sellerSignin}
					</Link>
				</div>
			</nav>
			{shell?.announcement && (
				<aside className="border-b border-border bg-info">
					<div
						className="page-container py-3"
						lang={shell.announcement.content_locale}
						dir={direction(shell.announcement.content_locale as Locale)}
					>
						{shell.announcement.fallback && (
							<p lang={locale} dir={direction(locale)}>
								{t.fallback}
							</p>
						)}
						<strong>{shell.announcement.payload.title}</strong>
						<Document
							data={shell.announcement.payload}
							locale={locale}
							contentLocale={shell.announcement.content_locale as Locale}
							heading={false}
							compact
						/>
					</div>
				</aside>
			)}
			<main
				id="main"
				tabIndex={-1}
				className="page-container space-y-6 py-7 desktop:py-12"
			>
				{children}
			</main>
			<footer className="border-t border-border bg-surface">
				<div className="page-container space-y-5 py-7">
					<strong>{messages[locale].brand}</strong>
					{shell?.navigation?.fallback && (
						<p className="text-muted">{t.fallback}</p>
					)}
					<div
						className="flex flex-wrap gap-x-12 gap-y-4"
						lang={shell?.navigation?.content_locale}
						dir={direction(
							(shell?.navigation?.content_locale ?? locale) as Locale,
						)}
					>
						{groups
							.filter((g) => g.placement === "footer")
							.map((g) => (
								<nav key={g.id} aria-label={g.label} className="space-y-2">
									<strong>{g.label}</strong>
									<ul className="m-0 list-none space-y-2 p-0">
										{g.links.map((link) => (
											<li key={link.id}>
												<Link href={`/${locale}${link.target}`}>
													{link.label}
												</Link>
											</li>
										))}
									</ul>
								</nav>
							))}
					</div>
					{shell?.support && (
						<SupportDetails resource={shell.support} locale={locale} />
					)}
				</div>
			</footer>
		</>
	);
}
