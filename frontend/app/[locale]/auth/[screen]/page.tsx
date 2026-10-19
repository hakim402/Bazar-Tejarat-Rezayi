import { notFound } from "next/navigation";
import { AuthForm } from "../../../../features/identity/components/auth-form";
import {
	screenTitle,
	authScreens,
	type AuthScreen,
} from "../../../../lib/i18n/auth-screens";
import { AccountShell } from "../../../../components/layout/account-shell";
import { isLocale } from "../../../../lib/i18n/locales";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; screen: string }>;
}) {
	const { locale, screen } = await params;
	if (!isLocale(locale) || !authScreens.includes(screen as AuthScreen))
		notFound();
	return (
		<AccountShell
			locale={locale}
			title={screenTitle(locale, screen as AuthScreen)}
		>
			<AuthForm locale={locale} screen={screen as AuthScreen} />
		</AccountShell>
	);
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string; screen: string }>;
}) {
	const { locale, screen } = await params;
	if (!isLocale(locale) || !authScreens.includes(screen as AuthScreen))
		return {};
	return {
		title: `${screenTitle(locale, screen as AuthScreen)} | Bazar Rezayi`,
		robots: { index: false, follow: false },
	};
}
