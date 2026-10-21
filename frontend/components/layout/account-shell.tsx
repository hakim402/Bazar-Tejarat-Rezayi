import { SkipLink } from "../ui/skip-link";
import Image from "next/image";
import { InvitationReturn } from "../../features/organizations/components/invitation-entry";
import Link from "next/link";
import type { ReactNode } from "react";
import { authCopy } from "../../lib/i18n/auth";
import type { Locale } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { SiteHeader } from "./site-header";
import { Card } from "../ui/card";

export function AccountShell({
	locale,
	title,
	children,
	privateScreen = false,
}: {
	locale: Locale;
	title: string;
	children: ReactNode;
	privateScreen?: boolean;
}) {
	const t = authCopy[locale];
	return (
		<div className="account-shell flex min-h-screen flex-col">
			<SkipLink label={messages[locale].skip} />
			<SiteHeader locale={locale} />
			<main
				className="page-container account-main flex-1 pt-5 pb-8 desktop:pt-6 desktop:pb-12"
				id="main"
				tabIndex={-1}
			>
				<nav
					className="account-breadcrumb mb-5 flex flex-wrap gap-3 text-base text-muted desktop:mb-6"
					aria-label={t.home}
				>
					<Link href={`/${locale}`}>{t.home}</Link>
					<span aria-hidden="true">›</span>
					<span>{title}</span>
				</nav>
				<div
					className={
						privateScreen
							? "account-grid private-grid mx-auto block max-w-account"
							: "account-grid grid grid-cols-1 items-start gap-0 desktop:grid-cols-(--account-columns) desktop:gap-account-gap"
					}
				>
					<Card className="account-card" aria-label={title}>
						<InvitationReturn locale={locale} />
						{children}
					</Card>
					{!privateScreen && (
						<aside className="account-aside hidden desktop:block">
							<Image
								className="aspect-video h-auto w-full rounded-card object-cover"
								src="/account-welcome.png"
								alt=""
								width={1152}
								height={656}
								priority
							/>
							<h2 className="mt-8 mb-4 text-3xl">{t.separation}</h2>
							<p className="mt-3 mb-5 leading-loose text-muted">
								{t.separationBody}
							</p>
						</aside>
					)}
				</div>
			</main>
			<footer className="page-container account-footer flex flex-wrap items-start justify-between gap-3 border-t border-border py-6 text-base desktop:gap-5">
				<strong>{messages[locale].brand}</strong>
				<Link href={`/${locale}`}>{t.home}</Link>
				<details className="basis-full desktop:basis-auto">
					<summary className="min-h-11 cursor-pointer">{t.authLinks}</summary>
					<nav className="flex flex-col gap-4 pt-3">
						<Link href={`/${locale}/auth/buyer-sign-in`}>{t.buyerSignin}</Link>
						<Link href={`/${locale}/auth/seller-sign-in`}>
							{t.sellerSignin}
						</Link>
						<Link href={`/${locale}/auth/staff-sign-in`}>{t.staffSignin}</Link>
						<Link href={`/${locale}/auth/policy-draft`}>{t.policyTitle}</Link>
					</nav>
				</details>
			</footer>
		</div>
	);
}
