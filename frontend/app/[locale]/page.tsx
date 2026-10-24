import { notFound } from "next/navigation";
import { isLocale } from "../../lib/i18n/locales";
import { StaticPage } from "../../features/pages/components/static-page";
import { pageMetadata } from "../../features/pages/metadata";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
	const { locale } = await params;
	const key = "home";
	if (!isLocale(locale) || !key) notFound();
	return pageMetadata(locale, key);
}
export default async function Page({ params }: Props) {
	const { locale } = await params;
	const key = "home";
	if (!isLocale(locale) || !key) notFound();
	return <StaticPage locale={locale} page={key} />;
}
