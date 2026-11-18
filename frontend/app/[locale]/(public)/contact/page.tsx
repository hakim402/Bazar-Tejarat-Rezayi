import { notFound } from "next/navigation";
import { isLocale } from "../../../../lib/i18n/locales";
import { ContactPage } from "../../../../features/contact/page";
import { contactMetadata } from "../../../../features/contact/metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return contactMetadata(locale);
}

export default async function Page({ params }: Props) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <ContactPage locale={locale} />;
}
