import { notFound } from "next/navigation";
import { isLocale } from "../../../../lib/i18n/locales";
import { ContentPage } from "../../../../features/content/components/content-page";
import { readContent } from "../../../../features/content/api/server";
import { contentMetadata } from "../../../../features/content/metadata";
export const dynamic = "force-dynamic";
export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string; topic: string }>;
}) {
	const { locale, topic } = await params;
	if (!isLocale(locale)) return {};
	const { data, failure } = await readContent(locale, topic);
	if (!failure && data?.kind !== "article") notFound();
	return contentMetadata(locale, topic, `/help/${topic}`);
}
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; topic: string }>;
}) {
	const { locale, topic } = await params;
	if (!isLocale(locale) || !/^[a-z][a-z0-9-]{0,79}$/.test(topic)) notFound();
	const { data, failure } = await readContent(locale, topic);
	if (!failure && data?.kind !== "article") notFound();
	return <ContentPage locale={locale} contentKey={topic} />;
}
