import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { SellerInvoices } from "../../../../../../../../features/orders/components/seller-invoices";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return <SellerInvoices locale={locale} id={id} />;
}
