import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../../../../features/organizations/components/organization-workspace";
export function PageContent({ locale, id }: { locale: Locale; id: string }) {
	return (
		<OrganizationWorkspace
			locale={locale}
			context="seller"
			profileId={id}
			key={id}
		/>
	);
}
