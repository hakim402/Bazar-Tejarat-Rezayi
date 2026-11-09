import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountPanel } from "../../../../../../../components/accounts/account-panel";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<AccountPanel locale={locale} context="buyer" screen="password" />
		</BuyerFrame>
	);
}
