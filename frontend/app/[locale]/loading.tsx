import { headers } from "next/headers";
import { defaultLocale, isLocale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
export default async function Loading() {
	const value = (await headers()).get("x-rezayi-locale") ?? defaultLocale;
	const t = messages[isLocale(value) ? value : defaultLocale];
	return (
		<main
			className="mx-auto my-12 max-w-2xl rounded-card border border-border bg-surface p-8 text-muted"
			role="status"
		>
			{t.loading}
		</main>
	);
}
