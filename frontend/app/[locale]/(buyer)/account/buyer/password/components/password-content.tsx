import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerPassword } from "../../../../../../../features/identity/components/buyer-password";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<BuyerPassword locale={locale} />
		</BuyerFrame>
	);
}
