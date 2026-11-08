import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/i18n/locales";
import { heroUI } from "../../../features/site/ui";
import { readSite } from "../../../features/site/server";
import { UnavailableContent } from "./components/unavailable-content";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Unavailable({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	const site = await readSite(locale),
		notice = site?.maintenance,
		t = heroUI[locale];

	return (
		<UnavailableContent
			locale={locale}
			notice={notice}
			maintenanceTitle={t.maintenance}
			unavailableText={t.unavailable}
		/>
	);
}
