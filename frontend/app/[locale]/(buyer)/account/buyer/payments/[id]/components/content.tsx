import { PaymentWorkspace } from "../../../../../../../../features/payments/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { BuyerFrame } from "../../../components/buyer-ui";
export function PaymentContent({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	return (
		<BuyerFrame>
			<PaymentWorkspace locale={locale} context="buyer" id={id} />
		</BuyerFrame>
	);
}
