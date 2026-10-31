import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrdersWorkspace } from "../../../../../../../features/orders/components/orders";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return <OrdersWorkspace locale={locale} context="seller" mode="invoices" />;
}
