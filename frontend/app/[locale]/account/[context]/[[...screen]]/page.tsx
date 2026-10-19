import { notFound } from "next/navigation";
import { AccountPanel } from "../../../../../features/identity/components/account-panel";
import { AccountShell } from "../../../../../components/layout/account-shell";
import type { AccountContext } from "../../../../../features/identity/api/accounts";
import { authCopy } from "../../../../../lib/i18n/auth";
import { isLocale } from "../../../../../lib/i18n/locales";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; context: string; screen?: string[] }>;
}) {
	const { locale, context, screen } = await params;
	const action = screen?.[0] ?? "profile";
	if (
		!isLocale(locale) ||
		!["buyer", "seller", "staff"].includes(context) ||
		!["profile", "password", "link", "mfa-reset"].includes(action) ||
		(screen?.length ?? 0) > 1 ||
		(context === "staff" && action === "link") ||
		(context !== "staff" && action === "mfa-reset")
	)
		notFound();
	return (
		<AccountShell locale={locale} title={authCopy[locale].profile} privateScreen>
			<AccountPanel
				locale={locale}
				context={context as AccountContext}
				screen={action}
			/>
		</AccountShell>
	);
}
