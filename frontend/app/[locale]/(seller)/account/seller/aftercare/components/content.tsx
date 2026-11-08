import { AftercareWorkspace } from "../../../../../../../features/aftercare/workspace";
import type { Locale } from "../../../../../../../lib/i18n/locales";
export function AftercareContent({ locale }: { locale: Locale }) {
	return <AftercareWorkspace locale={locale} context="seller" />;
}
