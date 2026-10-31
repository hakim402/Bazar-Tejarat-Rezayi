import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AccountSettings } from "../../../../../../../components/accounts/account-settings";
import { marketplaceCopy } from "../../../../../../../features/marketplace/copy";
import Link from "next/link";
import { CheckoutTermsEntry } from "./checkout-terms-entry";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<>
			<AccountSettings locale={locale} context="seller" />
			<Link
				className="mt-6 inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-5 font-bold"
				href={`/${locale}/account/seller/settings/store`}
			>
				{marketplaceCopy[locale].storeSettings}
			</Link>
			<CheckoutTermsEntry locale={locale} />
		</>
	);
}
