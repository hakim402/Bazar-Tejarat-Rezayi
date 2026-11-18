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
import { useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { accessCopy } from "../../../../../../lib/i18n/access";
import { authCopy } from "../../../../../../lib/i18n/auth";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";
import { sellerHref } from "../../../../../../lib/routes/account-routes";
import { AccountAvatar } from "../../../../../../components/ui/account-avatar";
import { Icon } from "../../../../../../components/ui/icon";
import type { ProfileIdentity } from "../../../../../../features/identity/api/profile";
import {
	authMutation,
	accountSession,
	ACCOUNT_SESSION_CHANGED,
	type SessionData,
} from "../../../../../../features/identity/api/accounts";
import { useNavigation } from "../../../../../../components/layout/navigation-guard";

const SellerAccountContext = createContext<{
	session: SessionData | null;
	busy: boolean;
	error: boolean;
	signOut: () => void;
} | null>(null);

export function useSellerAccount() {
	const account = useContext(SellerAccountContext);
	if (!account) throw new Error("SellerAccountProvider is required");
	return account;
}

export function SellerAccountProvider({
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
			void accountSession("seller")
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
			void authMutation("seller/logout/")
				.then(() => location.assign(`/${locale}`))
				.catch(() => {
					setError(true);
					setBusy(false);
					toast.error(authCopy[locale].signOutFailed);
				});
		});
	};
	return (
		<SellerAccountContext.Provider value={{ session, busy, error, signOut }}>
			{children}
		</SellerAccountContext.Provider>
	);
}

function AccountBadge({ locale }: { locale: Locale }) {
	const { session } = useSellerAccount();
	return (
		<AccountAvatar
			identity={session?.identity as ProfileIdentity | undefined}
			locale={locale}
		/>
	);
}

export function SellerSidebarAccount({
	locale,
	collapsed = false,
}: {
	locale: Locale;
	collapsed?: boolean;
}) {
	const { session, busy, error, signOut } = useSellerAccount();
	const seller = useSearchParams().get("seller");
	const t = inventoryCopy[locale];
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
							? sellerHref(locale, "profile", seller)
							: `/${locale}/auth/seller-sign-in`
					}
					aria-label={
						session
							? `${t.profile}${name ? `: ${name}` : ""}`
							: accessCopy[locale].login
					}
					title={collapsed ? name || t.profile : undefined}
					className={`flex min-h-11 min-w-11 items-center gap-2 rounded-control text-foreground no-underline hover:bg-info ${collapsed ? "justify-center" : "min-w-0 flex-1"}`}
				>
					<AccountBadge locale={locale} />
					{!collapsed && (
						<span className="min-w-0 text-sm font-medium wrap-anywhere">
							<bdi>
								{session ? name || t.profile : accessCopy[locale].login}
							</bdi>
						</span>
					)}
				</Link>
				{session && (
					<button
						type="button"
						onClick={signOut}
						disabled={busy}
						aria-busy={busy}
						aria-label={t.logout}
						title={t.logout}
						className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Icon name="logout" className="size-5" />
					</button>
				)}
			</div>
			{error && (
				<p role="alert" className="mt-2 text-caption text-danger">
					{sellerShellCopy[locale].signOutError}
				</p>
			)}
		</div>
	);
}
