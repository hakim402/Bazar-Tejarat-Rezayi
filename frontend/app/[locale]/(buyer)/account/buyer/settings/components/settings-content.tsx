import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountSettings } from "../../../../../../../components/accounts/account-settings";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<AccountSettings locale={locale} context="buyer" />
		</BuyerFrame>
	);
}
