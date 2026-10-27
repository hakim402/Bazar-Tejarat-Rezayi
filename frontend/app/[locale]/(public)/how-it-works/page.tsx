import { notFound } from "next/navigation";
import { isLocale } from "../../../../lib/i18n/locales";
import { pageMetadata } from "../../../../features/pages/metadata";
import { HowItWorksContent } from "./components/how-it-works-content";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return pageMetadata(locale, "how-it-works");
}
export default async function Page({ params }: Props) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <HowItWorksContent locale={locale} />;
}
