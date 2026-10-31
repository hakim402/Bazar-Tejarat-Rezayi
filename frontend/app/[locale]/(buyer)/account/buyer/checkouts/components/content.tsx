import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrdersWorkspace } from "../../../../../../../features/orders/components/orders";
import { AccountShell } from "../../../../../../../components/layout/account-shell";
import { commerceCopy } from "../../../../../../../features/orders/copy";
export function PageContent({ locale }: { locale: Locale; id?: string }) {
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={commerceCopy[locale].history}
			privateScreen
		>
			<OrdersWorkspace locale={locale} context="buyer" mode="checkouts" />
		</AccountShell>
	);
}
