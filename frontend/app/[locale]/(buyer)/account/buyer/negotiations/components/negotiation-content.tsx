import { NegotiationWorkspace } from "../../../../../../../features/negotiations/components/workspace";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { BuyerFrame } from "../../components/buyer-ui";
export function NegotiationContent({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	return (
		<BuyerFrame>
			<NegotiationWorkspace locale={locale} context="buyer" id={id} />
		</BuyerFrame>
	);
}
