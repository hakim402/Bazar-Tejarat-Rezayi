import type { Locale } from "../../../../../../../../../../lib/i18n/locales";
import { InventoryWorkspace } from "../../../../components/inventory-workspace";
export function PageContent({
	locale,
	variant,
}: {
	locale: Locale;
	variant: string;
}) {
	return (
		<InventoryWorkspace locale={locale} screen="receipt" variant={variant} />
	);
}
