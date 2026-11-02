import { notFound } from "next/navigation";
import { isLocale } from "../../../../../../lib/i18n/locales";
import { NegotiationContent } from "./components/negotiation-content";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; id?: string }>;
}) {
	const { locale, id } = await params;
	if (!isLocale(locale)) notFound();
	return <NegotiationContent locale={locale} id={id} />;
}
