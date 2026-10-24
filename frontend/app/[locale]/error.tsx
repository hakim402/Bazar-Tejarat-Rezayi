"use client";
import { useParams } from "next/navigation";
import { defaultLocale, isLocale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { Button } from "../../components/ui/button";
import { Alert } from "../../components/ui/alert";
export default function ErrorPage({ reset }: { reset: () => void }) {
	const { locale } = useParams<{ locale: string }>();
	const t = messages[isLocale(locale) ? locale : defaultLocale];
	return (
		<main className="mx-auto my-12 max-w-2xl space-y-6 rounded-card border border-border bg-surface p-6">
			<h1>{t.errorTitle}</h1>
			<Alert role="alert">{t.unavailable}</Alert>
			<Button onClick={reset}>{t.retry}</Button>
		</main>
	);
}
