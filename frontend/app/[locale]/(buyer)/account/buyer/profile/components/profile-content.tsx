import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerProfile } from "../../../../../../../features/identity/components/buyer-profile";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<BuyerProfile locale={locale} />
		</BuyerFrame>
	);
}
