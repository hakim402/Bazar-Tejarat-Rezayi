import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "../../lib/i18n/locales";
import { AccessProvider } from "../../components/authentication/access-provider";
export default async function Layout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return (
		<Suspense>
			<AccessProvider locale={locale}>{children}</AccessProvider>
		</Suspense>
	);
}
