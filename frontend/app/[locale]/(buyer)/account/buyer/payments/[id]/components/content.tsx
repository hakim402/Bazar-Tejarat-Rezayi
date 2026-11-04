import { AccountShell } from "../../../../../../../../components/layout/account-shell";
import { paymentCopy } from "../../../../../../../../features/payments/copy";
import { PaymentWorkspace } from "../../../../../../../../features/payments/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function PaymentContent({
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
			title={paymentCopy[locale].title}
			privateScreen
		>
			<PaymentWorkspace locale={locale} context="buyer" id={id} />
		</AccountShell>
	);
}
