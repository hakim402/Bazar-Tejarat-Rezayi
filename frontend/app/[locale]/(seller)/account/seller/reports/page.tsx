import { notFound } from "next/navigation";
import { ReportsWorkspace } from "../../../../../../features/reports/workspace";
import { isLocale } from "../../../../../../lib/i18n/locales";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <ReportsWorkspace locale={locale} context="seller" />;
}
