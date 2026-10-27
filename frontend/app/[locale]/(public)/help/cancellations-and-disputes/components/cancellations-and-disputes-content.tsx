import type { Locale } from "../../../../../../lib/i18n/locales";
import { PublicDocument } from "../../../components/public-document";
export function HelpCancellationsAndDisputesContent({
	locale,
}: {
	locale: Locale;
}) {
	return <PublicDocument locale={locale} page="cancellations-and-disputes" />;
}
