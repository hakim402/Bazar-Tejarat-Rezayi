import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerSettings } from "../../../../../../../features/identity/components/buyer-settings";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<BuyerSettings locale={locale} />
		</BuyerFrame>
	);
}
