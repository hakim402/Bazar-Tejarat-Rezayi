import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { OrdersWorkspace } from "../../../../../../../../features/orders/components/orders";
import { BuyerFrame } from "../../../components/buyer-ui";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return (
		<BuyerFrame>
			<OrdersWorkspace
				locale={locale}
				context="buyer"
				mode="invoices"
				id={id}
			/>
		</BuyerFrame>
	);
}
