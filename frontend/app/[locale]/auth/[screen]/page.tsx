import { ModalEntry } from "./components/modal-entry";
import { notFound } from "next/navigation";
import {
	screenTitle,
	authScreens,
	type AuthScreen,
} from "../../../../lib/i18n/auth-screens";
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
	return <ModalEntry locale={locale} screen={screen as AuthScreen} />;
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
