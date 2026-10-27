import type { Locale } from "../../../../../../../lib/i18n/locales";
import { CatalogueWorkspace } from "../../../../../../../features/catalogue/components/catalogue-workspace";
export function PageContent({ locale }: { locale: Locale }) {
	return <CatalogueWorkspace locale={locale} context="seller" />;
}
