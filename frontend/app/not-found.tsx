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
			<section className="empty-page">
				<h1>{t.notFound}</h1>
				<Link className="button" href={`/${locale}`}>
					{t.back}
				</Link>
			</section>
		</Shell>
	);
}
