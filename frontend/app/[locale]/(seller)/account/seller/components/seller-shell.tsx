import Link from "next/link";
import { SellerAccount, SellerAccountProvider } from "./seller-account";
import { SellerNotifications } from "./seller-notifications";
import type { CSSProperties, ReactNode } from "react";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { InvitationReturn } from "../../../../../../features/organizations/components/invitation-entry";
import { NavigationGuard } from "../../../../../../components/layout/navigation-guard";
import { SellerNavigation } from "./seller-navigation";
import { BrandLogo } from "../../../../../../components/brand/brand-logo";
import { SkipLink } from "../../../../../../components/ui/skip-link";
import { messages } from "../../../../../../lib/i18n/messages";
import { SellerPreferences } from "./seller-preferences";

export function SellerShell({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	return (
		<NavigationGuard guardHistory>
			<SellerAccountProvider locale={locale}>
				<div
					className="min-h-screen bg-page text-foreground"
					style={
						{
							"--bg": "var(--workspace-page)",
							"--surface": "var(--workspace-surface)",
							"--line": "var(--workspace-border)",
						} as CSSProperties
					}
				>
					<SkipLink label={messages[locale].skip} />
					<header className="sticky top-0 z-30 border-b border-border bg-surface">
						<div className="grid min-h-20 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:px-8">
							<Link
								href={`/${locale}`}
								className="flex min-h-11 w-fit shrink-0 items-center rounded-lg no-underline"
							>
								<BrandLogo locale={locale} className="w-24 sm:w-32" />
							</Link>
							<div
								id="seller-jump-to-page"
								className="flex min-w-11 justify-end lg:justify-center"
							/>
							<div className="flex min-w-0 shrink-0 items-center gap-2">
								<SellerNotifications locale={locale} />
								<div className="hidden shrink-0 sm:block">
									<SellerPreferences locale={locale} />
								</div>
								<SellerAccount locale={locale} />
							</div>
						</div>
					</header>
					<SellerNavigation locale={locale}>
						<main
							id="main"
							tabIndex={-1}
							className="mx-auto w-full max-w-page min-w-0 space-y-6 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-8 lg:px-8"
						>
							<InvitationReturn locale={locale} />
							{children}
						</main>
					</SellerNavigation>
				</div>
			</SellerAccountProvider>
		</NavigationGuard>
	);
}
