import type { Locale } from "../../../../../../../lib/i18n/locales";
import { SettingsPage } from "../../../../../../../components/accounts/seller-settings-ui";
import { SettingsHub } from "./settings-hub";

export function PageContent({ locale }: { locale: Locale }) {
	return (
		<SettingsPage locale={locale} page="settings">
			<SettingsHub locale={locale} />
		</SettingsPage>
	);
}
