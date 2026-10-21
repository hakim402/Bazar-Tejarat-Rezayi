import { notFound } from "next/navigation";
import { AccountShell } from "../../../components/layout/account-shell";
import { InvitationEntry } from "../../../features/organizations/components/invitation-entry";
import { isLocale } from "../../../lib/i18n/locales";
import { organizationCopy } from "../../../lib/i18n/organizations";
export const dynamic = "force-dynamic";
export const metadata = {
	referrer: "no-referrer",
	robots: { index: false, follow: false },
};
export default async function Page({
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
