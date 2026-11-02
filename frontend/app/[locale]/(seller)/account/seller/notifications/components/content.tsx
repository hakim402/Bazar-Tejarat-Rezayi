import type { Locale } from "../../../../../../../lib/i18n/locales";
import { CommunicationWorkspace } from "../../../../../../../features/messaging/components/workspace";

export function PageContent({
	locale,
	conversation,
}: {
	locale: Locale;
	conversation?: string;
}) {
	return (
		<CommunicationWorkspace
			locale={locale}
			context="seller"
			conversation={conversation}
			mode="notifications"
		/>
	);
}
