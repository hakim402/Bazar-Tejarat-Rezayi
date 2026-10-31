import type { Locale } from "../../../../lib/i18n/locales";
import { PublicShell } from "../../../../components/layout/public-shell";
import { readSite } from "../../../../features/site/server";
import { HomeShowcase } from "./home-showcase";
import { bundledSite } from "../../../../features/site/contract";
import {
	readMarketplace,
	Feedback,
} from "../../../../features/marketplace/server";
import type { Home } from "../../../../features/marketplace/types";
import { MarketplaceHome } from "./marketplace-home";
export async function HomeContent({ locale }: { locale: Locale }) {
	const site = await readSite(locale);
	const result = await readMarketplace<Home>(locale, "home/");
	return (
		<PublicShell
			locale={locale}
			site={site}
			hero={
				<HomeShowcase
					locale={locale}
					home={result.data}
					hero={(site ?? bundledSite(locale)).hero}
				/>
			}
		>
			{result.data ? (
				<MarketplaceHome locale={locale} home={result.data} />
			) : (
				<Feedback locale={locale} status={result.status} />
			)}
		</PublicShell>
	);
}
