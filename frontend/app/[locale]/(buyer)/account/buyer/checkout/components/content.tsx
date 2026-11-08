import type { Locale } from "../../../../../../../lib/i18n/locales";
import { CheckoutWorkspace } from "../../../../../../../features/orders/components/checkout";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return (
		<BuyerFrame>
			<CheckoutWorkspace locale={locale} />
		</BuyerFrame>
	);
}
