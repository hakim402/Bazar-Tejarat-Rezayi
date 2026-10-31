import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../../lib/i18n/locales";
import { InvoicePrint } from "../../../../../../../../../features/orders/components/invoice-print";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return <InvoicePrint locale={locale} context="seller" id={id} />;
}
