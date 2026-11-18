"use client";
import toast from "react-hot-toast";
import Link from "next/link";
import {
	createContext,
	useContext,
	useState,
	useEffect,
	type ReactNode,
} from "react";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { authCopy } from "../../../../../../lib/i18n/auth";
import { buyerShellCopy } from "../../../../../../lib/i18n/buyer-shell";
import { authHref } from "../../../../../../lib/routes/auth-routes";
import {
	authMutation,
	accountSession,
	ACCOUNT_SESSION_CHANGED,
	type SessionData,
} from "../../../../../../features/identity/api/accounts";
import type { ProfileIdentity } from "../../../../../../features/identity/api/profile";
import { AccountAvatar } from "../../../../../../components/ui/account-avatar";
import { Icon } from "../../../../../../components/ui/icon";
import { useNavigation } from "../../../../../../components/layout/navigation-guard";

const BuyerAccountContext = createContext<{
	session: SessionData | null;
	busy: boolean;
	error: boolean;
	signOut: () => void;
} | null>(null);

export function useBuyerAccount() {
	const account = useContext(BuyerAccountContext);
	if (!account) throw new Error("BuyerAccountProvider is required");
	return account;
}

export function BuyerAccountProvider({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	const [session, setSession] = useState<SessionData | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const navigate = useNavigation();
	useEffect(() => {
		let current = true,
			generation = 0;
		const refresh = () => {
			const mine = ++generation;
			void accountSession("buyer")
				.then((value) => {
					if (current && mine === generation) setSession(value);
				})
				.catch(() => {
					if (current && mine === generation) setSession(null);
				});
		};
		refresh();
		window.addEventListener("focus", refresh);
		window.addEventListener(ACCOUNT_SESSION_CHANGED, refresh);
		return () => {
			current = false;
			window.removeEventListener("focus", refresh);
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, refresh);
		};
	}, []);
	const signOut = () => {
		if (busy) return;
		navigate(() => {
			setBusy(true);
			setError(false);
			void authMutation("buyer/logout/")
				.then(() => location.assign(`/${locale}`))
				.catch(() => {
					setError(true);
					setBusy(false);
					toast.error(authCopy[locale].signOutFailed);
				});
		});
	};
	return (
		<BuyerAccountContext.Provider value={{ session, busy, error, signOut }}>
			{children}
		</BuyerAccountContext.Provider>
	);
}

export function AccountBadge({
	locale,
	className = "size-9 bg-info text-caption text-action",
}: {
	locale: Locale;
	className?: string;
}) {
	const { session } = useBuyerAccount();
	return (
		<AccountAvatar
			identity={session?.identity as ProfileIdentity | undefined}
			locale={locale}
			className={className}
		/>
	);
}

export function BuyerSidebarAccount({
	locale,
	collapsed = false,
}: {
	locale: Locale;
	collapsed?: boolean;
}) {
	const { session, busy, error, signOut } = useBuyerAccount();
	const t = buyerShellCopy[locale];
	const name = session?.identity.display_name.trim() ?? "";
	return (
		<div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
			<div
				dir={direction(locale)}
				className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-center"}`}
			>
				<Link
					dir={direction(locale)}
					href={
						session
							? `/${locale}/account/buyer/profile`
							: authHref(locale, "buyer-sign-in")
					}
					aria-label={
						session
							? `${t.profile}${name ? `: ${name}` : ""}`
							: authCopy[locale].signin
					}
					title={collapsed ? name || t.profile : undefined}
					className={`flex min-h-11 min-w-11 items-center gap-2 rounded-control text-foreground no-underline hover:bg-info ${collapsed ? "justify-center" : "min-w-0 flex-1"}`}
				>
					<AccountBadge locale={locale} />
					{!collapsed && (
						<span className="min-w-0 text-sm font-medium wrap-anywhere">
							<bdi>{session ? name || t.profile : authCopy[locale].signin}</bdi>
						</span>
					)}
				</Link>
				{session && (
					<button
						type="button"
						onClick={signOut}
						disabled={busy}
						aria-busy={busy}
						aria-label={authCopy[locale].logout}
						title={authCopy[locale].logout}
						className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Icon name="logout" className="size-5" />
					</button>
				)}
			</div>
			{error && (
				<p role="alert" className="mt-2 text-caption text-danger">
					{t.signOutError}
				</p>
			)}
		</div>
	);
}
