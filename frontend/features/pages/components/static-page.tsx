import { SellerLanding } from "../../identity/components/seller-landing";
import Link from "next/link";
import Image from "next/image";
import type { Locale } from "../../../lib/i18n/locales";
import { siteCopy } from "../../../lib/i18n/site";
import {
	PublicShell,
	SupportDetails,
} from "../../../components/layout/public-shell";
import { readSite } from "../../site/server";
import { HomeShowcase } from "../../storefront/home-showcase";
import { bundledSite } from "../../site/contract";
import { pageCopy } from "../copy";
import { pages, type PageKey } from "../registry";
import { HelpIndex } from "./help-index";
export async function StaticPage({
	locale,
	page,
}: {
	locale: Locale;
	page: PageKey;
}) {
	const site = await readSite(locale),
		copy = pageCopy[locale][page],
		t = siteCopy[locale],
		home = page === "home";
	if (page === "sell")
		return (
			<PublicShell locale={locale} site={site}>
				<SellerLanding locale={locale} />
			</PublicShell>
		);
	if (home)
		return (
			<PublicShell
				locale={locale}
				site={site}
				hero={
					<HomeShowcase
						locale={locale}
						hero={(site ?? bundledSite(locale)).hero}
					/>
				}
			>
				{null}
			</PublicShell>
		);
	return (
		<PublicShell locale={locale} site={site}>
			{!home && (
				<>
					<nav
						className="flex flex-wrap gap-3 text-sm"
						aria-label={t.navigation}
					>
						<Link href={`/${locale}`}>{t.home}</Link>
						{pages[page].kind === "article" && (
							<Link href={`/${locale}/help`}>{t.help}</Link>
						)}
					</nav>
					<header className="max-w-3xl space-y-3">
						<h1>{copy.title}</h1>
						<p className="text-lg text-muted">{copy.intro}</p>
					</header>
				</>
			)}
			{page === "help" && <HelpIndex locale={locale} />}
			{!home && copy.sections.length > 0 && (
				<div
					className={`grid items-start gap-6 ${home ? "desktop:grid-cols-3" : "desktop:grid-cols-[15rem_minmax(0,1fr)]"}`}
				>
					{!home && (
						<nav
							aria-label={copy.title}
							className="rounded-card border border-border bg-surface p-4 desktop:sticky desktop:top-6"
						>
							<ol className="m-0 list-none space-y-1 p-0">
								{copy.sections.map((section) => (
									<li key={section.anchor}>
										<a
											className="inline-flex min-h-11 items-center text-sm"
											href={`#${section.anchor}`}
										>
											{section.heading}
										</a>
									</li>
								))}
							</ol>
						</nav>
					)}
					<div className={home ? "contents" : "min-w-0 space-y-6"}>
						{copy.sections.map((section) => (
							<section
								key={section.anchor}
								id={section.anchor}
								className={`min-w-0 space-y-4 rounded-card border p-6 shadow-card desktop:p-8 ${pages[page].kind === "legal" && section.anchor === "development-sample" ? "border-warning bg-warning-surface text-warning" : "border-border bg-surface"}`}
							>
								<h2 className="text-xl desktop:text-2xl">{section.heading}</h2>
								<p className="max-w-3xl whitespace-pre-line leading-8">
									{section.body}
								</p>
								{section.steps.length > 0 && (
									<ol className="space-y-3 ps-6">
										{section.steps.map((step) => (
											<li key={step}>{step}</li>
										))}
									</ol>
								)}
								{section.illustration && (
									<Image
										src={section.illustration.src}
										alt={section.illustration.alt}
										width={1536}
										height={1024}
										className="h-auto max-h-96 w-full rounded-card object-cover"
									/>
								)}
								{section.actions.length > 0 && (
									<div className="flex flex-wrap gap-4">
										{section.actions.map((action) => (
											<Link
												className="inline-flex min-h-11 items-center font-bold"
												key={action.href}
												href={`/${locale}${action.href}`}
											>
												{action.label}
											</Link>
										))}
									</div>
								)}
							</section>
						))}
					</div>
				</div>
			)}
			{page === "contact" && <SupportDetails locale={locale} site={site} />}
		</PublicShell>
	);
}
