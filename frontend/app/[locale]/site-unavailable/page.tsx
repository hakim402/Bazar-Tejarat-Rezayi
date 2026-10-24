import { notFound } from "next/navigation";
import { isLocale, direction } from "../../../lib/i18n/locales";
import { heroUI } from "../../../features/site/ui";
import { readSite } from "../../../features/site/server";
import { BrandLogo } from "../../../components/brand/brand-logo";
import { authCopy } from "../../../lib/i18n/auth";
import { siteCopy } from "../../../lib/i18n/site";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Unavailable({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	const site = await readSite(locale),
		notice = site?.maintenance,
		t = heroUI[locale];
	return (
		<main
			id="main"
			className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-7 px-6 py-16"
		>
			<BrandLogo locale={locale} />
			<section
				className="space-y-5 rounded-card border border-border bg-surface p-7 shadow-card"
				lang={notice?.enabled ? notice.content_locale : locale}
				dir={direction(notice?.enabled ? notice.content_locale : locale)}
			>
				{notice?.enabled && notice.fallback && (
					<p lang={locale}>{siteCopy[locale].fallback}</p>
				)}
				<h1>{notice?.enabled ? notice.title : t.maintenance}</h1>
				<p>{notice?.enabled ? notice.text : t.unavailable}</p>
				<a
					className="inline-flex min-h-11 items-center font-bold"
					href={`/${locale}/auth/buyer-sign-in`}
				>
					{authCopy[locale].signin}
				</a>
			</section>
		</main>
	);
}
