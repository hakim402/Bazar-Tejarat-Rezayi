import { aftercareCopy } from "../../../../../../../features/aftercare/copy";
import { AftercareWorkspace } from "../../../../../../../features/aftercare/workspace";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerFrame } from "../../components/buyer-ui";
export function AftercareContent({ locale }: { locale: Locale }) {
	return (
		<BuyerFrame>
			<AftercareWorkspace locale={locale} context="buyer" />
		</BuyerFrame>
	);
}
