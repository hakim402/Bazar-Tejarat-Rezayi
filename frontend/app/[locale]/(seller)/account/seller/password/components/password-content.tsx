import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountPanel } from "../../../../../../../components/accounts/account-panel";
export function PageContent({ locale }: { locale: Locale }) {
	return <AccountPanel locale={locale} context="seller" screen="password" />;
}
