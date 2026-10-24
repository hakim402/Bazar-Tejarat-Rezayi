import { AccessProvider } from "../../features/identity/components/access-provider";
import type { ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { siteCopy } from "../../lib/i18n/site";
import type { Site } from "../../features/site/contract";
import { SiteHeader } from "./site-header";
import { Container } from "./container";
import { SiteFooter } from "./site-footer";
import { SkipLink } from "../ui/skip-link";
export function SupportDetails({
	site,
	locale,
}: {
	site?: Site | null;
	locale: Locale;
}) {
	const t = siteCopy[locale],
		contacts = site?.contacts;
	return (
		<aside className="min-w-0 space-y-3 rounded-card border border-border bg-surface p-5 text-foreground">
			<h2 className="text-2xl">{t.contact}</h2>
			{contacts && (contacts.email || contacts.phone || contacts.website) ? (
				<address className="flex min-w-0 flex-wrap gap-5 not-italic wrap-anywhere">
					{contacts.email && (
						<a href={`mailto:${contacts.email}`}>
							<bdi dir="ltr">{contacts.email}</bdi>
						</a>
					)}
					{contacts.phone && (
						<a href={`tel:${contacts.phone.replace(/[ ()-]/g, "")}`}>
							<bdi dir="ltr">{contacts.phone}</bdi>
						</a>
					)}
					{contacts.website && (
						<a href={contacts.website}>
							<bdi dir="ltr">{contacts.website}</bdi>
						</a>
					)}
				</address>
			) : (
				<p className="text-muted">{t.noContact}</p>
			)}
			{site?.identity.fallback &&
				(site.identity.address || site.identity.hours) && <p>{t.fallback}</p>}
			{site?.identity.address && (
				<p
					lang={site.identity.content_locale}
					dir={direction(site.identity.content_locale)}
				>
					{site.identity.address}
				</p>
			)}
			{site?.identity.hours && (
				<p
					lang={site.identity.content_locale}
					dir={direction(site.identity.content_locale)}
				>
					{site.identity.hours}
				</p>
			)}
			{contacts && (
				<div className="flex flex-wrap gap-5">
					{(["facebook", "instagram", "linkedin", "youtube"] as const).map(
						(key) =>
							contacts[key] && (
								<a
									key={key}
									href={contacts[key]}
									className="inline-flex min-h-11 items-center"
									lang="en"
									dir="ltr"
								>
									{key[0].toUpperCase() + key.slice(1)}
								</a>
							),
					)}
				</div>
			)}
		</aside>
	);
}
export function PublicShell({
	locale,
	site,
	hero,
	children,
}: {
	locale: Locale;
	site?: Site | null;
	hero?: ReactNode;
	children: ReactNode;
}) {
	const announcement = site?.announcement;
	return (
		<AccessProvider locale={locale}>
			<div className="flex min-h-screen flex-col">
				<SkipLink label={messages[locale].skip} />
				<SiteHeader locale={locale} />
				{announcement?.enabled && (
					<aside className="border-b border-border bg-info">
						<Container
							className="flex flex-wrap items-center gap-4 py-3"
							lang={announcement.content_locale}
							dir={direction(announcement.content_locale)}
						>
							{announcement.fallback && (
								<span lang={locale} dir={direction(locale)}>
									{siteCopy[locale].fallback}
								</span>
							)}
							<p>{announcement.text}</p>
							{announcement.label && announcement.url && (
								<a
									className="inline-flex min-h-11 items-center font-bold"
									href={
										announcement.url.startsWith("/")
											? `/${locale}${announcement.url === "/" ? "" : announcement.url}`
											: announcement.url
									}
								>
									{announcement.label}
								</a>
							)}
						</Container>
					</aside>
				)}
				<main id="main" tabIndex={-1} className="flex-1">
					{hero}
					{children && (
						<Container className="space-y-7 py-7 desktop:py-10">
							{children}
						</Container>
					)}
				</main>
				<SiteFooter locale={locale} />
			</div>
		</AccessProvider>
	);
}
