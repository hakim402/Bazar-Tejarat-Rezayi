import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { apiOrigin } from "../../../lib/api/client";
import type { Locale } from "../../../lib/i18n/locales";
import { siteCopy } from "../../../lib/i18n/site";
import {
	PublicShell,
	SupportDetails,
} from "../../../components/layout/public-shell";
import { Icon } from "../../../components/ui/icon";
import { Breadcrumb } from "../../../components/ui/breadcrumb";
import { readSite } from "../../site/server";
import { readPage } from "../api";
import { prepareBody } from "../html";
import { HelpIndex } from "./help-index";
import { PageBody } from "./page-body";
import { PageHero } from "./page-hero";
/** Server renderer for every owner-authored public page. */
export async function PublicPage({
	locale,
	slug,
	expect,
}: {
	locale: Locale;
	slug: string;
	expect: "page" | "article";
}) {
	const [site, page] = await Promise.all([
		readSite(locale),
		readPage(locale, slug),
	]);
	if (!page) notFound();
	if (expect === "article" && page.kind !== "article") notFound();
	if (expect === "page" && page.kind === "article")
		redirect(`/${locale}/help/${page.slug}`);
	const t = siteCopy[locale],
		body = prepareBody(
			page.body,
			page.content_locale,
			apiOrigin(process.env.NEXT_PUBLIC_API_URL),
		),
		pages = site?.pages ?? [],
		articles = pages
			.filter((item) => item.kind === "article")
			.sort((a, b) => a.position - b.position),
		siblings = pages
			.filter(
				(item) =>
					item.slug !== page.slug &&
					item.group !== "hidden" &&
					item.group === page.group,
			)
			.sort((a, b) => a.position - b.position)
			.slice(0, 4);
	return (
		<PublicShell locale={locale} site={site}>
			<Breadcrumb
				label={t.navigation}
				items={[
					{ label: t.home, href: `/${locale}` },
					...(page.kind === "article"
						? [{ label: t.help, href: `/${locale}/help` }]
						: []),
					{ label: page.title },
				]}
			/>
			<PageHero locale={locale} page={page} />
			{page.kind === "help-index" && (
				<HelpIndex locale={locale} articles={articles} />
			)}
			{body.html && (
				<PageBody
					locale={locale}
					contentLocale={page.content_locale}
					html={body.html}
					sections={body.sections}
				/>
			)}
			{page.kind === "contact" && (
				<SupportDetails locale={locale} site={site} />
			)}
			{siblings.length > 0 && (
				<section aria-labelledby="keep-reading" className="space-y-5">
					<h2 id="keep-reading" className="text-2xl">
						{t.keepReading}
					</h2>
					<div className="grid gap-5 desktop:grid-cols-2">
						{siblings.map((item) => (
							<Link
								key={item.slug}
								href={`/${locale}${item.path}`}
								className="group space-y-2 rounded-card border border-border bg-surface p-6 no-underline shadow-card hover:border-action/40"
							>
								<span className="flex items-center justify-between gap-3 text-lg font-bold text-foreground group-hover:text-action">
									{item.title}
									<Icon
										name="chevron"
										className="size-4 shrink-0 rtl:rotate-180"
									/>
								</span>
								{item.intro && (
									<span className="block text-sm leading-7 text-muted">
										{item.intro}
									</span>
								)}
							</Link>
						))}
					</div>
				</section>
			)}
		</PublicShell>
	);
}
