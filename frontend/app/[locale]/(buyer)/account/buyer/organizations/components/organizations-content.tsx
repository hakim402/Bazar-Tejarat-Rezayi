import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerOrganizations } from "../../../../../../../features/organizations/components/buyer-organizations";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<BuyerOrganizations locale={locale} />
		</BuyerFrame>
	);
}
