import { AccountOnboarding } from "@/features/identity/components/account-onboarding";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { InventoryWorkspace } from "../inventory/components/inventory-workspace";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<div className="space-y-5">
			<AccountOnboarding locale={locale} context="seller" />
			<InventoryWorkspace locale={locale} screen="overview" />
		</div>
	);
}
