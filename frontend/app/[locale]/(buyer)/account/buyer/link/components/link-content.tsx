import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerLinkPanel } from "../../../../../../../features/identity/components/buyer-link";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<BuyerLinkPanel locale={locale} />
		</BuyerFrame>
	);
}
