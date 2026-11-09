import type { Locale } from "../../../../../../../lib/i18n/locales";
import { CommunicationWorkspace } from "../../../../../../../features/messaging/components/workspace";
import { BuyerFrame } from "../../components/buyer-ui";
export function PageContent({
	locale,
	conversation,
}: {
	locale: Locale;
	conversation?: string;
}) {
	return (
		<BuyerFrame>
			<CommunicationWorkspace
				locale={locale}
				context="buyer"
				conversation={conversation}
				mode="messages"
			/>
		</BuyerFrame>
	);
}
