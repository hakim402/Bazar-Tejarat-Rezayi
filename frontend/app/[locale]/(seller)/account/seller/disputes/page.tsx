import { notFound } from "next/navigation";
import { isLocale } from "../../../../../../lib/i18n/locales";
import { DisputesContent } from "./components/content";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <DisputesContent locale={locale} />;
}
