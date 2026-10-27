import type { Locale } from "../../../../../../lib/i18n/locales";
import { InventoryWorkspace } from "../inventory/components/inventory-workspace";
export function PageContent({ locale }: { locale: Locale }) {
	return <InventoryWorkspace locale={locale} screen="overview" />;
}
