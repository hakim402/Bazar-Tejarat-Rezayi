import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../../../features/organizations/components/organization-workspace";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<OrganizationWorkspace locale={locale} context="buyer" />
		</BuyerFrame>
	);
}
