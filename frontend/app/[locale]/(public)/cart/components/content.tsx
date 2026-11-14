import type { Locale } from "../../../../../lib/i18n/locales";
import { MarketplaceShell } from "../../../../../features/marketplace/server";
import { CartWorkspace } from "../../../../../features/cart/components/cart";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<MarketplaceShell locale={locale}>
			<CartWorkspace locale={locale} />
		</MarketplaceShell>
	);
}
