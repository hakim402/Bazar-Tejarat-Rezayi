import Link from "next/link";
import { SellerAccount } from "./seller-account";
import type { ReactNode } from "react";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { InvitationReturn } from "../../../../../../features/organizations/components/invitation-entry";
import { NavigationGuard } from "../../../../../../components/layout/navigation-guard";
import { SellerNavigation } from "./seller-navigation";
import { BrandLogo } from "../../../../../../components/brand/brand-logo";
import { SkipLink } from "../../../../../../components/ui/skip-link";
import { messages } from "../../../../../../lib/i18n/messages";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { Preferences } from "../../../../../../components/layout/preferences";
export function SellerShell({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	const t = inventoryCopy[locale];
	return (
		<NavigationGuard guardHistory>
			<div className="min-h-screen bg-page text-foreground">
				<SkipLink label={messages[locale].skip} />
				<header className="border-b border-border bg-surface">
					<div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-4 desktop:px-8">
						<Link href={`/${locale}`} className="shrink-0">
							<BrandLogo locale={locale} className="w-32 desktop:w-40" />
						</Link>
						<div className="flex flex-wrap items-center gap-3">
							<Link href={`/${locale}`} className="text-sm">
								{t.market}
							</Link>
							<Preferences locale={locale} />
							<SellerAccount locale={locale} />
						</div>
					</div>
				</header>
				<div className="mx-auto grid max-w-page min-w-0 gap-5 p-4 desktop:grid-cols-[14rem_minmax(0,1fr)] desktop:p-8">
					<SellerNavigation locale={locale} />
					<main id="main" tabIndex={-1} className="min-w-0 space-y-6">
						<InvitationReturn locale={locale} />
						{children}
					</main>
				</div>
			</div>
		</NavigationGuard>
	);
}
