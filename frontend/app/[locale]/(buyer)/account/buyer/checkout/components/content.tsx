import type { Locale } from "../../../../../../../lib/i18n/locales";
import { CheckoutWorkspace } from "../../../../../../../features/orders/components/checkout";
import { AccountShell } from "../../../../../../../components/layout/account-shell";
import { commerceCopy } from "../../../../../../../features/orders/copy";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={commerceCopy[locale].checkout}
			privateScreen
		>
			<CheckoutWorkspace locale={locale} />
		</AccountShell>
	);
}
