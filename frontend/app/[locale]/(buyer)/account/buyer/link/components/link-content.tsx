import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountPanel } from "../../../../../../../components/accounts/account-panel";
import { AccountShell } from "../../../../../../../components/layout/account-shell";
import { authCopy } from "../../../../../../../lib/i18n/auth";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={authCopy[locale].profile}
			privateScreen
		>
			<AccountPanel locale={locale} context="buyer" screen="link" />
		</AccountShell>
	);
}
