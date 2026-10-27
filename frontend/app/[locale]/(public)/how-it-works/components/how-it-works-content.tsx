import type { Locale } from "../../../../../lib/i18n/locales";
import { PublicDocument } from "../../components/public-document";
export function HowItWorksContent({ locale }: { locale: Locale }) {
	return <PublicDocument locale={locale} page="how-it-works" />;
}
