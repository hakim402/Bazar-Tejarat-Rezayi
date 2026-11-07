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
import { JumpToPage } from "./jump-to-page";
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
					<div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3 desktop:px-8">
						<Link href={`/${locale}`} className="shrink-0">
							<BrandLogo locale={locale} className="w-28 desktop:w-36" />
						</Link>
						<div className="flex flex-wrap items-center gap-2">
							<JumpToPage locale={locale} />
							<Link
								href={`/${locale}/account/seller/notifications`}
								className="flex min-h-10 w-10 items-center justify-center rounded-sm text-muted transition-colors hover:bg-info hover:text-foreground"
								aria-label={t.notifications}
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.7"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="size-5"
									aria-hidden="true"
								>
									<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4" />
								</svg>
							</Link>
							<Preferences locale={locale} />
							<SellerAccount locale={locale} />
						</div>
					</div>
				</header>
				<div className="mx-auto grid max-w-page min-w-0 gap-5 p-4 desktop:grid-cols-[16rem_minmax(0,1fr)] desktop:p-6">
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
