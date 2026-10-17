import { headers } from "next/headers";
import { defaultLocale, isLocale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
export default async function Loading() {
	const value = (await headers()).get("x-rezayi-locale") ?? defaultLocale;
	const t = messages[isLocale(value) ? value : defaultLocale];
	return (
		<main className="container empty-page" role="status">
			{t.loading}
		</main>
	);
}
