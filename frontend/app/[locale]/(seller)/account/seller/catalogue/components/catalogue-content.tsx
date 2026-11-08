"use client";
import { useSearchParams } from "next/navigation";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { catalogueCopy } from "../../../../../../../lib/i18n/catalogue";
import { CatalogueWorkspace } from "../../../../../../../features/catalogue/components/catalogue-workspace";
import { CatalogueCreate } from "../../../../../../../features/catalogue/components/catalogue-create";
import { useSellerAccount } from "../../components/seller-account";
export function PageContent({
	locale,
	id,
	creating = false,
}: {
	locale: Locale;
	id?: string;
	creating?: boolean;
}) {
	const { session, error } = useSellerAccount();
	const seller = useSearchParams().get("seller");
	if (!session)
		return error ? (
			<p role="alert">{catalogueCopy[locale].unavailable}</p>
		) : (
			<p role="status">{catalogueCopy[locale].loading}</p>
		);
	const identity = `${session.identity.id}:${session.accounts[0].id}`;
	const key = `${identity}:${seller ?? ""}:${locale}:${id ?? ""}`;
	return creating ? (
		<CatalogueCreate key={key} locale={locale} identity={identity} />
	) : (
		<CatalogueWorkspace
			key={key}
			locale={locale}
			context="seller"
			id={id}
			identity={identity}
		/>
	);
}
