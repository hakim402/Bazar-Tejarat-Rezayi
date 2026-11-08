"use client";
import { SellerBusinessBoundary } from "../../../../../../../../features/organizations/components/seller-business-ui";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../../../../features/organizations/components/organization-workspace";
export function PageContent({ locale, id }: { locale: Locale; id: string }) {
	return (
		<SellerBusinessBoundary locale={locale} profileId={id}>
			{(emailVerified) => (
				<OrganizationWorkspace
					locale={locale}
					context="seller"
					profileId={id}
					sellerBusiness
					emailVerified={emailVerified}
				/>
			)}
		</SellerBusinessBoundary>
	);
}
