import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicShell } from "../../../components/layout/public-shell";
import { isLocale, direction, locales } from "../../../lib/i18n/locales";
import { contentCopy } from "../../../lib/i18n/content";
import { readHelp, readShell } from "../../../features/content/api/server";
import { Retry } from "../../../features/content/components/retry";
import {
	indexingAllowed,
	publicOrigin,
} from "../../../features/content/metadata";
export const dynamic = "force-dynamic";
export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) return {};
	const { data } = await readHelp(locale, 1);
	const available = locales.filter(
		(l) =>
			data?.results.length &&
			data.results.every((a) => a.available_locales.includes(l)),
	);
	const canonical = available.includes(locale) ? locale : "fa-AF";
	return {
		title: contentCopy[locale].help,
		metadataBase: new URL(publicOrigin),
		robots: {
			index: !!data?.count && indexingAllowed(),
			follow: !!data?.count && indexingAllowed(),
		},
		...(data?.count
			? {
					alternates: {
						canonical: `/${canonical}/help`,
						languages: Object.fromEntries(
							available.map((l) => [l, `/${l}/help`]),
						),
					},
				}
			: {}),
	};
}
export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	const p = Number((await searchParams).page ?? 1);
	if (!Number.isInteger(p) || p < 1 || p > 10000) notFound();
	const [{ data, failure }, shell] = await Promise.all([
		readHelp(locale, p),
		readShell(locale),
	]);
	const t = contentCopy[locale];
	return (
		<PublicShell locale={locale} shell={shell}>
			<h1>{t.help}</h1>
			{failure ? (
				<>
					<p role="alert">{t.outage}</p>
					<Retry locale={locale} />
				</>
			) : !data?.count ? (
				<p>{t.noArticles}</p>
			) : (
				<>
					<div className="grid gap-5 desktop:grid-cols-2">
						{data.results.map((article) => (
							<article
								key={article.key}
								className="space-y-3 rounded-card border border-border bg-surface p-5"
								lang={article.content_locale}
								dir={direction(article.content_locale as typeof locale)}
							>
								{article.fallback && <p>{t.fallback}</p>}
								{article.payload.group && (
									<p className="text-muted">{article.payload.group}</p>
								)}
								<h2 className="text-2xl">
									<Link href={`/${locale}/help/${article.key}`}>
										{article.payload.title}
									</Link>
								</h2>
								<p>{article.payload.description}</p>
							</article>
						))}
					</div>
					<nav aria-label={t.help} className="flex gap-6">
						{p > 1 && (
							<Link href={`/${locale}/help?page=${p - 1}`}>{t.previous}</Link>
						)}
						{data.count > p * 12 && (
							<Link href={`/${locale}/help?page=${p + 1}`}>{t.next}</Link>
						)}
					</nav>
				</>
			)}
		</PublicShell>
	);
}
