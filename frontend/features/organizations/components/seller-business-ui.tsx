"use client";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { sellerBusinessCopy } from "../../../lib/i18n/seller-business";
import { authHref } from "../../../lib/routes/auth-routes";
import { sellerHref } from "../../../lib/routes/account-routes";
import { settingsSecondary } from "../../../components/accounts/seller-settings-ui";
import { useSellerAccount } from "../../../app/[locale]/(seller)/account/seller/components/seller-account";
import { ACCOUNT_SESSION_CHANGED } from "../../identity/api/accounts";
import { organizationCopy } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { uuidPattern } from "../../../lib/routes/account-routes";
import { useSettingsGuard } from "../../../components/accounts/seller-settings-ui";
import type { SellerWorkflowOptions } from "./workflow-state";

export type SellerBusinessOptions = SellerWorkflowOptions & {
	onDirtyChange: (dirty: boolean) => void;
	choose: (next: () => void) => void;
};

// Shares the shell's session owner; no second authentication fetch.
export function SellerBusinessBoundary({
	locale,
	profileId,
	children,
}: {
	locale: Locale;
	profileId?: string;
	children: (emailVerified: boolean) => ReactNode;
}) {
	const { session } = useSellerAccount();
	const current = useRef(session);
	current.current = session;
	const [revocation, setRevocation] = useState<{
		session: typeof session;
		epoch: number;
	} | null>(null);
	useEffect(() => {
		const revoke = () =>
			setRevocation((previous) => ({
				session: current.current,
				epoch: (previous?.epoch ?? 0) + 1,
			}));
		window.addEventListener(ACCOUNT_SESSION_CHANGED, revoke);
		return () => window.removeEventListener(ACCOUNT_SESSION_CHANGED, revoke);
	}, []);
	const query = useSearchParams().get("seller");
	const context =
		!profileId && query && uuidPattern.test(query) ? query : "directory";
	if (!session) {
		const copy = sellerBusinessCopy[locale];
		const destination = sellerHref(
			locale,
			profileId ? `organizations/${profileId}` : "organizations",
			profileId ?? (context === "directory" ? null : context),
		);
		return (
			<div className="min-w-0 space-y-6">
				<header className="space-y-3">
					<h1 className="text-page-title font-bold">{copy.title}</h1>
					<p className="max-w-3xl text-muted leading-relaxed">{copy.help}</p>
				</header>
				<section className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
					<p>{copy.signInHelp}</p>
					<Link
						className={settingsSecondary}
						href={authHref(
							locale,
							"seller-sign-in",
							new URLSearchParams({ return: destination }),
						)}
					>
						{copy.signIn}
					</Link>
				</section>
			</div>
		);
	}
	if (revocation?.session === session)
		return <p role="status">{organizationCopy[locale].loading}</p>;
	return (
		<div
			key={`${session.identity.id}:${session.accounts[0]?.id}:seller:${locale}:${profileId ?? context}:${revocation?.epoch ?? 0}`}
			className="contents"
		>
			{children(session.identity.email_verified)}
		</div>
	);
}

export function useSellerBusinessGuard(locale: Locale) {
	const [drafts, setDrafts] = useState<Record<string, boolean>>({});
	const lock = useRef(false);
	const report = useCallback((key: string, dirty: boolean) => {
		setDrafts((current) =>
			current[key] === dirty ? current : { ...current, [key]: dirty },
		);
	}, []);
	const profileDirty = useCallback(
		(dirty: boolean) => report("profile", dirty),
		[report],
	);
	const applicationDirty = useCallback(
		(dirty: boolean) => report("application", dirty),
		[report],
	);
	const teamDirty = useCallback(
		(dirty: boolean) => report("team", dirty),
		[report],
	);
	const guard = useSettingsGuard(locale, Object.values(drafts).some(Boolean));
	const choose = (next: () => void) => {
		if (!lock.current) guard.choose(next);
	};
	return { ...guard, choose, lock, profileDirty, applicationDirty, teamDirty };
}
