"use client";
import { SellerBusinessBoundary } from "../../../../../../../features/organizations/components/seller-business-ui";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../../../features/organizations/components/organization-workspace";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<SellerBusinessBoundary locale={locale}>
			{(emailVerified) => (
				<OrganizationWorkspace
					locale={locale}
					context="seller"
					sellerBusiness
					emailVerified={emailVerified}
				/>
			)}
		</SellerBusinessBoundary>
	);
}
