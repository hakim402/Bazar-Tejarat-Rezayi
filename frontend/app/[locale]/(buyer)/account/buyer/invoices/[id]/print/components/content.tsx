import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../../lib/i18n/locales";
import { InvoicePrint } from "../../../../../../../../../features/orders/components/invoice-print";
import { BuyerFrame } from "../../../../components/buyer-ui";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return (
		<BuyerFrame>
			<InvoicePrint locale={locale} context="buyer" id={id} />
		</BuyerFrame>
	);
}
