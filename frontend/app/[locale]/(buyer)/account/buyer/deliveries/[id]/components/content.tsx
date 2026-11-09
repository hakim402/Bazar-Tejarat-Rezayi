import { FulfilmentWorkspace } from "../../../../../../../../features/fulfilment/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { BuyerFrame } from "../../../components/buyer-ui";
export function Content({ locale, id }: { locale: Locale; id?: string }) {
	return (
		<BuyerFrame>
			<FulfilmentWorkspace locale={locale} context="buyer" id={id} />
		</BuyerFrame>
	);
}
