import { NegotiationWorkspace } from "../../../../../../../../features/negotiations/components/workspace";
import { AccountShell } from "../../../../../../../../components/layout/account-shell";
import { negotiationCopy } from "../../../../../../../../features/negotiations/copy";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function NegotiationContent({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={negotiationCopy[locale].title}
			privateScreen
		>
			<NegotiationWorkspace locale={locale} context="buyer" id={id} builder />
		</AccountShell>
	);
}
