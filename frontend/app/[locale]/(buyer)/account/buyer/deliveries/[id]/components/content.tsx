import { AccountShell } from "../../../../../../../../components/layout/account-shell";
import { fulfilmentCopy } from "../../../../../../../../features/fulfilment/copy";
import { FulfilmentWorkspace } from "../../../../../../../../features/fulfilment/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function Content({ locale, id }: { locale: Locale; id?: string }) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={fulfilmentCopy[locale].buyerTitle}
			privateScreen
		>
			<FulfilmentWorkspace locale={locale} context="buyer" id={id} />
		</AccountShell>
	);
}
