import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { CheckoutSettings } from "../../../../../../../../features/orders/components/checkout-settings";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return <CheckoutSettings locale={locale} />;
}
