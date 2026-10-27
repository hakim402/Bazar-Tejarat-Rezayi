import type { Locale } from "../../../../../../../../../../lib/i18n/locales";
import { InventoryWorkspace } from "../../../../components/inventory-workspace";
export function PageContent({
	locale,
	variant,
	batch,
}: {
	locale: Locale;
	variant: string;
	batch: string;
}) {
	return (
		<InventoryWorkspace
			locale={locale}
			screen="batch"
			variant={variant}
			batch={batch}
		/>
	);
}
