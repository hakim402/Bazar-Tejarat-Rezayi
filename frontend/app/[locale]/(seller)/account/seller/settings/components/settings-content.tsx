import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountSettings } from "../../../../../../../components/accounts/account-settings";
export function PageContent({ locale }: { locale: Locale }) {
	return <AccountSettings locale={locale} context="seller" />;
}
