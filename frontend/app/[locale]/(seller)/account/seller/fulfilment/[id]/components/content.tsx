import { FulfilmentWorkspace } from "../../../../../../../../features/fulfilment/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function Content({ locale, id }: { locale: Locale; id?: string }) {
	return <FulfilmentWorkspace locale={locale} context="seller" id={id} />;
}
