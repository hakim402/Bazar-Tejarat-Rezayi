import type { Locale } from "../../../../../lib/i18n/locales";
import { PublicShell } from "../../../../../components/layout/public-shell";
import { readSite } from "../../../../../features/site/server";
import { SellerLanding } from "./seller-landing";
export async function SellContent({ locale }: { locale: Locale }) {
	const site = await readSite(locale);
	return (
		<PublicShell locale={locale} site={site}>
			<SellerLanding locale={locale} />
		</PublicShell>
	);
}
