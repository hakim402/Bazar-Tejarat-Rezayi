import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../../../features/organizations/components/organization-workspace";
export function PageContent({ locale }: { locale: Locale }) {
	return <OrganizationWorkspace locale={locale} context="seller" />;
}
