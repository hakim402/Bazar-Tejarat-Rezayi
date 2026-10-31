import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { OrdersWorkspace } from "../../../../../../../../features/orders/components/orders";
import { AccountShell } from "../../../../../../../../components/layout/account-shell";
import { commerceCopy } from "../../../../../../../../features/orders/copy";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={commerceCopy[locale].orders}
			privateScreen
		>
			<OrdersWorkspace locale={locale} context="buyer" mode="orders" id={id} />
		</AccountShell>
	);
}
