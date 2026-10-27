import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../../../features/organizations/components/organization-workspace";
import { organizationCopy } from "../../../../../../../lib/i18n/organizations";
import { AccountShell } from "../../../../../../../components/layout/account-shell";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={organizationCopy[locale].title}
			privateScreen
		>
			<OrganizationWorkspace locale={locale} context="buyer" />
		</AccountShell>
	);
}
