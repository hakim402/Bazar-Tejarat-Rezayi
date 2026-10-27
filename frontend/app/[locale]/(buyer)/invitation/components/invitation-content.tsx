import { notFound } from "next/navigation";
import { AccountShell } from "../../../../../components/layout/account-shell";
import { InvitationEntry } from "../../../../../features/organizations/components/invitation-entry";
import { isLocale } from "../../../../../lib/i18n/locales";
import { organizationCopy } from "../../../../../lib/i18n/organizations";
export default async function InvitationContent({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return (
		<AccountShell
			locale={locale}
			title={organizationCopy[locale].invitationTitle}
		>
			<InvitationEntry locale={locale} />
		</AccountShell>
	);
}
