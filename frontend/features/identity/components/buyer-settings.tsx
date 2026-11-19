"use client";
import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { accountSettingsCopy } from "../../../lib/i18n/account-settings";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { EmailPreference } from "../../notifications/components/email-preference";
import { CloseAccount } from "../../../components/accounts/close-account";

export function BuyerSettings({ locale }: { locale: Locale }) {
	const t = accountSettingsCopy[locale];
	return (
		<div className="space-y-6" data-testid="account-settings">
			<div>
				<h1 className="m-0 text-xl font-semibold tracking-tight">{t.title}</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.subtitle}</p>
			</div>
			<EmailPreference key={locale} locale={locale} context="buyer" />
			<CloseAccount locale={locale} context="buyer" flat />
			<Link
				href={`/${locale}/privacy`}
				className="inline-flex text-sm font-medium text-action no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
			>
				{sellerSettingsCopy[locale].policy}
			</Link>
		</div>
	);
}
