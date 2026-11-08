import { notFound } from "next/navigation";
import { isLocale } from "../../../../../../../lib/i18n/locales";
import { uuidPattern } from "../../../../../../../lib/routes/account-routes";
import { AftercareContent } from "./components/content";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
	const { locale, id } = await params;
	if (!isLocale(locale) || !uuidPattern.test(id)) notFound();
	return <AftercareContent locale={locale} orderId={id} />;
}
