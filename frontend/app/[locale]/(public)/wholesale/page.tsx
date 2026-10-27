import { notFound } from "next/navigation";
import { isLocale } from "../../../../lib/i18n/locales";
import { pageMetadata } from "../../../../features/pages/metadata";
import { WholesaleContent } from "./components/wholesale-content";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return pageMetadata(locale, "wholesale");
}
export default async function Page({ params }: Props) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <WholesaleContent locale={locale} />;
}
