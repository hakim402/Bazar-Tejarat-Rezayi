import { NegotiationWorkspace } from "../../../../../../../../features/negotiations/components/workspace";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
export function NegotiationContent({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	return <NegotiationWorkspace locale={locale} context="seller" id={id} />;
}
