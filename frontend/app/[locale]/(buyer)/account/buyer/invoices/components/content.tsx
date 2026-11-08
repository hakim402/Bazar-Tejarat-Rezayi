import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrdersWorkspace } from "../../../../../../../features/orders/components/orders";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return (
		<BuyerFrame>
			<OrdersWorkspace locale={locale} context="buyer" mode="invoices" />
		</BuyerFrame>
	);
}
