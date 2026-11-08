import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { PageContent as CatalogueContent } from "../../components/catalogue-content";
export function PageContent({ locale, id }: { locale: Locale; id: string }) {
	return <CatalogueContent locale={locale} id={id} />;
}
