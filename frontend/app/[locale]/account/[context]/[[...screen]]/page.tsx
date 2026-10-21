import { notFound } from "next/navigation";
import { AccountPanel } from "../../../../../features/identity/components/account-panel";
import { AccountShell } from "../../../../../components/layout/account-shell";
import type { AccountContext } from "../../../../../features/identity/api/accounts";
import { authCopy } from "../../../../../lib/i18n/auth";
import { isLocale } from "../../../../../lib/i18n/locales";
import { OrganizationWorkspace } from "../../../../../features/organizations/components/organization-workspace";
import { ReviewWorkspace } from "../../../../../features/verification/components/review-workspace";
import { organizationCopy } from "../../../../../lib/i18n/organizations";
import { ContentWorkspace } from "../../../../../features/content/components/content-workspace";
import { contentCopy } from "../../../../../lib/i18n/content";
import { CatalogueWorkspace } from "../../../../../features/catalogue/components/catalogue-workspace";
import { catalogueCopy } from "../../../../../lib/i18n/catalogue";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; context: string; screen?: string[] }>;
}) {
	const { locale, context, screen } = await params;
	const action = screen?.[0] ?? "profile";
	const catalogue =
		action === "catalogue" && ["seller", "staff"].includes(context);
	const content = action === "content" && context === "staff";
	const business = action === "organizations" && context !== "staff";
	const review =
		["verification", "transfers"].includes(action) && context === "staff";
	if (
		!isLocale(locale) ||
		!["buyer", "seller", "staff"].includes(context) ||
		!(
			business ||
			review ||
			content ||
			catalogue ||
			["profile", "password", "link", "mfa-reset"].includes(action)
		) ||
		(screen?.length ?? 0) >
			(business || review || content || catalogue ? 2 : 1) ||
		((screen?.length ?? 0) === 2 &&
			!(content ? /^[a-z][a-z0-9-]{0,79}$/ : /^[0-9a-f-]{36}$/).test(
				screen?.[1] ?? "",
			)) ||
		(context === "staff" && action === "link") ||
		(context !== "staff" && action === "mfa-reset")
	)
		notFound();
	if (catalogue)
		return (
			<AccountShell
				locale={locale}
				title={catalogueCopy[locale].title}
				privateScreen
			>
				<CatalogueWorkspace
					locale={locale}
					context={context as "seller" | "staff"}
					id={screen?.[1]}
				/>
			</AccountShell>
		);
	if (content)
		return (
			<AccountShell
				locale={locale}
				title={contentCopy[locale].editor}
				privateScreen
			>
				<ContentWorkspace locale={locale} contentKey={screen?.[1]} />
			</AccountShell>
		);
	if (business || review)
		return (
			<AccountShell
				locale={locale}
				title={organizationCopy[locale].title}
				privateScreen
			>
				{business ? (
					<OrganizationWorkspace
						key={screen?.[1] ?? "list"}
						locale={locale}
						context={context}
						profileId={screen?.[1]}
					/>
				) : (
					<ReviewWorkspace
						key={action + (screen?.[1] ?? "")}
						locale={locale}
						area={action}
						id={screen?.[1]}
					/>
				)}
			</AccountShell>
		);
	return (
		<AccountShell
			locale={locale}
			title={authCopy[locale].profile}
			privateScreen
		>
			<AccountPanel
				locale={locale}
				context={context as AccountContext}
				screen={action}
			/>
		</AccountShell>
	);
}
