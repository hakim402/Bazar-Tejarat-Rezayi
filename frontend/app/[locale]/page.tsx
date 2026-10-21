import { notFound } from "next/navigation";
import { isLocale } from "../../lib/i18n/locales";
import { ContentPage } from "../../features/content/components/content-page";
import { contentMetadata } from "../../features/content/metadata";
export const dynamic = "force-dynamic";
export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	return isLocale(locale) ? contentMetadata(locale, "home", "") : {};
}
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <ContentPage locale={locale} contentKey="home" />;
}
