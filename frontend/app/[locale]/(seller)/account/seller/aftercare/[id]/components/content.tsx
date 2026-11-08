import { AftercareWorkspace } from "../../../../../../../../features/aftercare/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function AftercareContent({ locale, orderId }: { locale: Locale; orderId: string }) {
	return <AftercareWorkspace locale={locale} context="seller" orderId={orderId} />;
}
