import type { Locale } from "../../../../lib/i18n/locales";
import { PublicShell } from "../../../../components/layout/public-shell";
import { readSite } from "../../../../features/site/server";
import { HomeShowcase } from "./home-showcase";
import { bundledSite } from "../../../../features/site/contract";
export async function HomeContent({ locale }: { locale: Locale }) {
	const site = await readSite(locale);
	return (
		<PublicShell
			locale={locale}
			site={site}
			hero={
				<HomeShowcase
					locale={locale}
					hero={(site ?? bundledSite(locale)).hero}
				/>
			}
		>
			{null}
		</PublicShell>
	);
}
