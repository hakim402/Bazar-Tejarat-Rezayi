import { AccessProvider } from "../../features/identity/components/access-provider";
import { AuthPresentation } from "../../features/identity/components/auth-presentation";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locales";
import type { AccountContext } from "../../features/identity/api/accounts";
import { InvitationReturn } from "../../features/organizations/components/invitation-entry";
import { authCopy } from "../../lib/i18n/auth";
import { messages } from "../../lib/i18n/messages";
import { interfaceCopy } from "../../lib/i18n/interface";
import { SkipLink } from "../ui/skip-link";
import { BrandLogo } from "../brand/brand-logo";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { WorkspaceNavigation } from "./workspace-navigation";
import { NavigationGuard } from "./navigation-guard";
export function AccountShell({
	locale,
	title,
	children,
	privateScreen = false,
	context = "buyer",
	splitAuth,
}: {
	locale: Locale;
	title: string;
	children: ReactNode;
	privateScreen?: boolean;
	context?: AccountContext;
	splitAuth?: boolean;
}) {
	const t = authCopy[locale],
		ui = interfaceCopy[locale];
	return (
		<NavigationGuard>
			<AccessProvider locale={locale}>
				<div className="account-shell flex min-h-screen flex-col">
					<SkipLink label={messages[locale].skip} />
					<SiteHeader locale={locale} />
					<main
						id="main"
						tabIndex={-1}
						className="mx-auto w-full max-w-page flex-1 px-4 py-6 desktop:px-8 desktop:py-8"
					>
						<nav
							aria-label={t.home}
							className="account-breadcrumb mb-5 flex flex-wrap items-center gap-3 text-sm text-muted"
						>
							<Link href={`/${locale}`}>{t.home}</Link>
							<span aria-hidden="true">/</span>
							<span>{title}</span>
						</nav>
						{privateScreen ? (
							<div className="grid min-w-0 items-start gap-5 desktop:grid-cols-[14rem_minmax(0,1fr)]">
								<aside className="min-w-0 space-y-5">
									<div className="hidden rounded-card border border-border bg-surface p-5 desktop:block">
										<BrandLogo locale={locale} className="w-40" />
										<p className="mt-4 text-sm text-muted">{ui.workspace}</p>
										<strong>{t[context]}</strong>
									</div>
									<WorkspaceNavigation locale={locale} context={context} />
								</aside>
								<section
									aria-label={title}
									className="account-card min-w-0 rounded-card border border-border bg-surface p-5 shadow-card desktop:p-7"
								>
									<InvitationReturn locale={locale} />
									{children}
								</section>
							</div>
						) : (
							<div className="mx-auto max-w-4xl">
								<AuthPresentation
									locale={locale}
									seller={context === "seller"}
									split={splitAuth}
								>
									<InvitationReturn locale={locale} />
									{children}
								</AuthPresentation>
							</div>
						)}
					</main>
					<SiteFooter locale={locale} />
				</div>
			</AccessProvider>
		</NavigationGuard>
	);
}
