import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/i18n/locales";
import { ContentPage } from "../../../features/content/components/content-page";
import { contentMetadata } from "../../../features/content/metadata";
const pages = [
	"how-it-works",
	"wholesale",
	"sell",
	"about",
	"contact",
	"terms",
	"privacy",
];
export const dynamic = "force-dynamic";
export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string; page: string }>;
}) {
	const { locale, page } = await params;
	return isLocale(locale) && pages.includes(page)
		? contentMetadata(locale, page, `/${page}`)
		: {};
}
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; page: string }>;
}) {
	const { locale, page } = await params;
	if (!isLocale(locale) || !pages.includes(page)) notFound();
	return <ContentPage locale={locale} contentKey={page} />;
}
