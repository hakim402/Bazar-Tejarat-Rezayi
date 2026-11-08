import type { Locale } from "../../../../../../lib/i18n/locales";
import { BuyerFrame } from "../components/buyer-ui";
import { BuyerOverview } from "../components/buyer-overview";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<BuyerOverview locale={locale} />
		</BuyerFrame>
	);
}
