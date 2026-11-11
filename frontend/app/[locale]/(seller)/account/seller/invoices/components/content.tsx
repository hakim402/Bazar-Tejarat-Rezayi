import type { Locale } from "../../../../../../../lib/i18n/locales";
import { SellerInvoices } from "../../../../../../../features/orders/components/seller-invoices";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return <SellerInvoices locale={locale} />;
}
