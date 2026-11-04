import { PaymentWorkspace } from "../../../../../../../../features/payments/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function PaymentContent({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	return <PaymentWorkspace locale={locale} context="seller" id={id} />;
}
