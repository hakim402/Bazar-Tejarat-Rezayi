import type { Locale } from "../../../../../lib/i18n/locales";
import { PublicShell } from "../../../../../components/layout/public-shell";
import { readPage } from "../../../../../features/pages/api";
import { readSite } from "../../../../../features/site/server";
import { SellerLanding } from "./seller-landing";
export async function SellContent({ locale }: { locale: Locale }) {
	const [site, page] = await Promise.all([
		readSite(locale),
		readPage(locale, "sell"),
	]);
	return (
		<PublicShell locale={locale} site={site}>
			<SellerLanding locale={locale} page={page} site={site} />
		</PublicShell>
	);
}
