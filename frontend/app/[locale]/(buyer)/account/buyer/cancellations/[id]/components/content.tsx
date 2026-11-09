import { AftercareWorkspace } from "../../../../../../../../features/aftercare/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { BuyerFrame } from "../../../components/buyer-ui";
export function AftercareContent({ locale, orderId }: { locale: Locale; orderId: string }) {
	return (
		<BuyerFrame>
			<AftercareWorkspace locale={locale} context="buyer" orderId={orderId} />
		</BuyerFrame>
	);
}
