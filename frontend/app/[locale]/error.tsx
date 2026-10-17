"use client";
import { useParams } from "next/navigation";
import { defaultLocale, isLocale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { Button, Notice } from "../../components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
	const { locale } = useParams<{ locale: string }>();
	const t = messages[isLocale(locale) ? locale : defaultLocale];
	return (
		<main className="container empty-page">
			<h1>{t.errorTitle}</h1>
			<Notice error>{t.unavailable}</Notice>
			<Button onClick={reset}>{t.retry}</Button>
		</main>
	);
}
