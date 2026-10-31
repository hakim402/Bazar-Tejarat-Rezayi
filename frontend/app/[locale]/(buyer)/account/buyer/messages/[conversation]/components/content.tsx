import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { CommunicationWorkspace } from "../../../../../../../../features/messaging/components/workspace";
import { AccountShell } from "../../../../../../../../components/layout/account-shell";
import { communicationCopy } from "../../../../../../../../features/messaging/copy";
export function PageContent({
	locale,
	conversation,
}: {
	locale: Locale;
	conversation?: string;
}) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={communicationCopy[locale].messages}
			privateScreen
		>
			<CommunicationWorkspace
				locale={locale}
				context="buyer"
				conversation={conversation}
				mode="messages"
			/>
		</AccountShell>
	);
}
