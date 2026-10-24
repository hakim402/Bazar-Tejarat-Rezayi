"use client";
import { AccessLink } from "../../features/identity/components/access-provider";
import Image from "next/image";
import Link from "next/link";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { useSite } from "../../features/site/context";
import { storefrontCopy } from "../../features/storefront/copy";
import { productImage } from "../../features/storefront/data";
import { pageCopy } from "../../features/pages/copy";
import { pages, type PageKey } from "../../features/pages/registry";
import { authCopy } from "../../lib/i18n/auth";
import { siteCopy } from "../../lib/i18n/site";
import { BrandLogo } from "../brand/brand-logo";
import { Icon } from "../ui/icon";
import { Container } from "./container";
export function SiteFooter({ locale }: { locale: Locale }) {
	const site = useSite(),
		t = storefrontCopy[locale],
		a = authCopy[locale],
		contact = site?.contacts;
	const groups: [string, PageKey[]][] = [
		[t.company, ["about", "how-it-works", "wholesale", "sell"]],
		[
			t.support,
			[
				"help",
				"contact",
				"payment-and-delivery",
				"cancellations-and-disputes",
				"verification",
			],
		],
	];
	const account = [
		[a.buyerSignin, "buyer-sign-in"],
		[a.sellerSignin, "seller-sign-in"],
		[a.buyerRegister, "buyer-registration"],
		[a.sellerRegister, "seller-registration"],
	] as const;
	return (
		<footer className="site-footer mt-12 border-t border-border/60 bg-surface text-foreground desktop:mt-20">
			<Container>
				<section
					aria-labelledby="newsletter-heading"
					className="relative mx-auto -mt-8 grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-5 overflow-hidden rounded-3xl bg-linear-to-br from-brand to-brand-panel p-6 text-brand-ink shadow-card desktop:-mt-12 desktop:grid-cols-[0.85fr_1.15fr] desktop:gap-10 desktop:px-12 desktop:py-9"
				>
					<div className="relative hidden items-center justify-center desktop:flex">
						<span
							aria-hidden="true"
							className="absolute size-56 rounded-full bg-brand-ink/10"
						/>
						<Image
							src={productImage("furniture")}
							alt=""
							width={1280}
							height={1280}
							sizes="400px"
							className="relative z-10 h-60 w-full object-contain drop-shadow-xl"
						/>
					</div>
					<div className="relative z-10 min-w-0 max-w-xl space-y-4">
						<span className="inline-flex rounded-full bg-brand-ink/15 px-3 py-1 text-xs font-bold">
							{t.soon}
						</span>
						<h2
							id="newsletter-heading"
							className="text-2xl leading-relaxed desktop:text-3xl"
						>
							{t.newsletter}
						</h2>
						<p className="text-sm leading-7">{t.newsletterBody}</p>
						<div className="grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-brand-ink/30 bg-brand-ink/15 p-2 desktop:flex desktop:rounded-full desktop:p-1.5 desktop:ps-4">
							<Icon name="mail" className="size-4" />
							<input
								type="email"
								disabled
								aria-label={t.email}
								placeholder={t.email}
								className="w-full min-w-0 border-0 bg-transparent text-sm text-brand-ink placeholder:text-brand-ink disabled:opacity-100"
							/>
							<button
								type="button"
								disabled
								className="col-span-2 min-h-10 w-full shrink-0 rounded-full border-0 bg-brand-ink px-4 text-xs font-bold text-brand-panel disabled:cursor-not-allowed desktop:w-auto"
							>
								{t.subscribe}
							</button>
						</div>
						<p className="text-xs leading-6">{t.newsletterNote}</p>
					</div>
				</section>
				<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-8 py-10 desktop:grid-cols-2 desktop:gap-10 min-[68.75rem]:grid-cols-[1.4fr_1fr_1.2fr_1fr_1.35fr] desktop:py-12">
					<div className="col-span-full min-w-0 space-y-5 min-[68.75rem]:col-span-1">
						<Link
							href={`/${locale}`}
							className="inline-flex min-h-11 max-w-full"
						>
							<BrandLogo locale={locale} className="w-44" />
						</Link>
						<p className="max-w-xs text-sm leading-7 text-muted">
							{t.footerBody}
						</p>
						{contact && (
							<div className="flex flex-wrap gap-3">
								{(
									["facebook", "instagram", "linkedin", "youtube"] as const
								).map(
									(name) =>
										contact[name] && (
											<a
												key={name}
												href={contact[name]}
												className="inline-flex min-h-11 items-center text-xs font-bold"
												lang="en"
												dir="ltr"
											>
												{name[0].toUpperCase() + name.slice(1)}
											</a>
										),
								)}
							</div>
						)}
					</div>
					{groups.map(([title, keys]) => (
						<nav key={title} aria-label={title} className="min-w-0">
							<h2 className="mb-4 text-base">{title}</h2>
							<ul className="m-0 list-none space-y-1 p-0">
								{keys.map((key) => (
									<li key={key}>
										<Link
											href={`/${locale}${pages[key].path}`}
											className="inline-flex min-h-10 max-w-full items-center text-sm leading-6 wrap-anywhere text-muted no-underline hover:text-action hover:underline"
										>
											{pageCopy[locale][key].title}
										</Link>
									</li>
								))}
							</ul>
						</nav>
					))}
					<nav aria-label={t.account} className="min-w-0">
						<h2 className="mb-4 text-base">{t.account}</h2>
						<ul className="m-0 list-none space-y-1 p-0">
							{account.map(([label, path]) => (
								<li key={path}>
									<AccessLink
										locale={locale}
										screen={path}
										className="inline-flex min-h-10 max-w-full items-center text-sm leading-6 wrap-anywhere text-muted no-underline hover:text-action hover:underline"
									>
										{label}
									</AccessLink>
								</li>
							))}
						</ul>
					</nav>
					<div className="min-w-0 space-y-4">
						<h2 className="text-base">{t.contact}</h2>
						<address className="space-y-2 not-italic">
							{contact?.phone && (
								<a
									href={`tel:${contact.phone.replace(/[ ()-]/g, "")}`}
									className="flex min-h-10 items-center gap-2 text-sm text-muted no-underline"
								>
									<Icon name="call" className="size-4 text-action" />
									<bdi dir="ltr">{contact.phone}</bdi>
								</a>
							)}
							{contact?.email && (
								<a
									href={`mailto:${contact.email}`}
									className="flex min-h-10 items-center gap-2 text-sm text-muted no-underline wrap-anywhere"
								>
									<Icon name="mail" className="size-4 text-action" />
									<bdi dir="ltr">{contact.email}</bdi>
								</a>
							)}
							{contact?.website && (
								<a
									href={contact.website}
									className="flex min-h-10 items-start gap-2 text-sm text-muted no-underline wrap-anywhere"
								>
									<Icon name="globe" className="mt-1 size-4 text-action" />
									<bdi dir="ltr">{new URL(contact.website).hostname}</bdi>
								</a>
							)}
							{!contact?.email && !contact?.phone && !contact?.website && (
								<p className="text-sm text-muted">
									{siteCopy[locale].noContact}
								</p>
							)}
						</address>
						{site?.identity.address && (
							<p
								lang={site.identity.content_locale}
								dir={direction(site.identity.content_locale)}
								className="text-sm leading-7 text-muted"
							>
								{site.identity.address}
							</p>
						)}
						{site?.identity.hours && (
							<p
								lang={site.identity.content_locale}
								dir={direction(site.identity.content_locale)}
								className="text-sm leading-7 text-muted"
							>
								{site.identity.hours}
							</p>
						)}
					</div>
				</div>
			</Container>
			<div className="border-t border-border">
				<Container className="flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-muted">
					<p>
						© {new Date().getUTCFullYear()} {site?.identity.name}. {t.rights}
					</p>
					<nav aria-label={t.legal} className="flex flex-wrap gap-x-6 gap-y-2">
						{(["privacy", "terms"] as const).map((key) => (
							<Link
								key={key}
								href={`/${locale}${pages[key].path}`}
								className="inline-flex min-h-11 items-center text-inherit no-underline hover:text-action"
							>
								{pageCopy[locale][key].title}
							</Link>
						))}
					</nav>
				</Container>
			</div>
		</footer>
	);
}
