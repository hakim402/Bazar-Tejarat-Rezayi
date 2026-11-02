import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../../lib/i18n/locales";
import { InvoicePrint } from "../../../../../../../../../features/orders/components/invoice-print";
import { AccountShell } from "../../../../../../../../../components/layout/account-shell";
import { commerceCopy } from "../../../../../../../../../features/orders/copy";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return (
		<AccountShell
			locale={locale}
			context="buyer"
			title={commerceCopy[locale].invoices}
			privateScreen
		>
			<InvoicePrint locale={locale} context="buyer" id={id} />
		</AccountShell>
	);
}
