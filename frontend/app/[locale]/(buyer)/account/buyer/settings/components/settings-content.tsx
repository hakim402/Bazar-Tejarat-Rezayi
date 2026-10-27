import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountSettings } from "../../../../../../../components/accounts/account-settings";
import { AccountShell } from "../../../../../../../components/layout/account-shell";
import { accountSettingsCopy } from "../../../../../../../lib/i18n/account-settings";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={accountSettingsCopy[locale].title}
			privateScreen
		>
			<AccountSettings locale={locale} context="buyer" />
		</AccountShell>
	);
}
