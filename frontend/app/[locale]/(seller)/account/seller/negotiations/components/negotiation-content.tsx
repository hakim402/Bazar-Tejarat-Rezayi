import { SellerNegotiationWorkspace } from "../../../../../../../features/negotiations/components/seller-workspace";
import type { Locale } from "../../../../../../../lib/i18n/locales";
export function NegotiationContent({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	return <SellerNegotiationWorkspace locale={locale} id={id} />;
}
