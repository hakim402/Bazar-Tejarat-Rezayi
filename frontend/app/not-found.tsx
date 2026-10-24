import Link from "next/link";
import { headers } from "next/headers";
import { defaultLocale, isLocale } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
import { Shell } from "../components/shell";
export default async function NotFound() {
	const value = (await headers()).get("x-rezayi-locale") ?? defaultLocale;
	const locale = isLocale(value) ? value : defaultLocale;
	const t = messages[locale];
	return (
		<Shell locale={locale}>
			<section className="space-y-6 rounded-card border border-border bg-surface px-6 py-12 text-center">
				<h1>{t.notFound}</h1>
				<Link
					className="inline-flex min-h-12 items-center rounded-control bg-primary px-5 py-3 font-bold text-on-primary no-underline"
					href={`/${locale}`}
				>
					{t.back}
				</Link>
			</section>
		</Shell>
	);
}
