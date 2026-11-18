import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { BuyerOrganizationPage } from "../../../../../../../../features/organizations/components/buyer-organizations";
import { BuyerFrame } from "../../../components/buyer-ui";
export function PageContent({ locale, id }: { locale: Locale; id: string }) {
	return (
		<BuyerFrame>
			<BuyerOrganizationPage locale={locale} id={id} key={id} />
		</BuyerFrame>
	);
}
