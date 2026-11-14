import { notFound } from "next/navigation";
import { isLocale } from "../../../../../lib/i18n/locales";
import { PublicPage } from "../../../../../features/pages/components/public-page";
import { cmsMetadata } from "../../../../../features/pages/metadata";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; article: string }> };
export async function generateMetadata({ params }: Props) {
	const { locale, article } = await params;
	if (!isLocale(locale)) notFound();
	return cmsMetadata(locale, article);
}
export default async function Page({ params }: Props) {
	const { locale, article } = await params;
	if (!isLocale(locale)) notFound();
	return <PublicPage locale={locale} slug={article} expect="article" />;
}
