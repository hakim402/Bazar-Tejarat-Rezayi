"use client";
import Link from "next/link";
import {
	createContext,
	useContext,
	useState,
	useEffect,
	useRef,
	useId,
	type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { accessCopy } from "../../../../../../lib/i18n/access";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { accountSettingsCopy } from "../../../../../../lib/i18n/account-settings";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";
import { sellerHref } from "../../../../../../lib/routes/account-routes";
import { Icon } from "../../../../../../components/ui/icon";
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
	const name = session?.identity.display_name.trim() ?? "";
	const parts = name.split(/\s+/);
	const initials = name
		? (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts)
				.map((part) => Array.from(part)[0])
				.join("")
				.toLocaleUpperCase(locale)
		: Array.from(session?.identity.email ?? "")[0]?.toLocaleUpperCase(locale);
	return (
		<span
			aria-hidden="true"
			className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info text-caption font-semibold text-action"
		>
			{initials ? <bdi>{initials}</bdi> : <Icon name="user-circle" />}
		</span>
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
		<div className="border-t border-border p-3">
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
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="size-5"
						>
							<path d="M9 5H4v14h5 M9 12h12 m-4-4 4 4-4 4" />
						</svg>
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

export function SellerAccount({ locale }: { locale: Locale }) {
	const { session, busy, error, signOut } = useSellerAccount();
	const active = !!session;
	const t = inventoryCopy[locale];
	const copy = sellerShellCopy[locale];
	const seller = useSearchParams().get("seller");
	const [open, setOpen] = useState(false);
	const container = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const panelId = useId();
	const displayName = session?.identity.display_name.trim() ?? "";
	const email = session?.identity.email ?? "";

	useEffect(() => {
		if (!open) return;
		const outside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!container.current?.contains(event.target)
			)
				setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setOpen(false);
				trigger.current?.focus();
			}
		};
		const closeOnFocusLeave = (event: FocusEvent) => {
			if (
				event.target instanceof Node &&
				!container.current?.contains(event.target)
			)
				setOpen(false);
		};
		document.addEventListener("focusin", closeOnFocusLeave);
		document.addEventListener("pointerdown", outside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("focusin", closeOnFocusLeave);
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	return (
		<div ref={container} className="relative min-w-0 shrink-0 text-sm">
			{active ? (
				<>
					<button
						ref={trigger}
						type="button"
						aria-label={
							displayName
								? `${copy.accountMenu}: ${displayName}`
								: copy.accountMenu
						}
						aria-expanded={open}
						aria-controls={panelId}
						className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 text-foreground shadow-sm no-underline transition-colors hover:bg-info motion-reduce:transition-none"
						onClick={() => setOpen(!open)}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown" || event.key === "ArrowUp") {
								event.preventDefault();
								setOpen(true);
								const last = event.key === "ArrowUp";
								requestAnimationFrame(() => {
									const items = panel.current?.querySelectorAll<HTMLElement>(
										"a,button:not(:disabled)",
									);
									items?.[last ? items.length - 1 : 0]?.focus();
								});
							}
						}}
					>
						<AccountBadge locale={locale} />
						<Icon
							name="chevron-down"
							className="hidden size-3.5 text-muted lg:block"
						/>
					</button>
					{open && (
						<div
							ref={panel}
							id={panelId}
							className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-2 shadow-lifted"
						>
							<div className="border-b border-border px-3 py-3">
								{displayName && (
									<p className="break-words font-semibold">
										<bdi>{displayName}</bdi>
									</p>
								)}
								{email && (
									<p className="mt-1 break-words text-caption text-muted">
										<bdi>{email}</bdi>
									</p>
								)}
							</div>
							<nav aria-label={copy.accountMenu} className="py-1">
								<Link
									href={sellerHref(locale, "profile", seller)}
									className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-foreground no-underline hover:bg-info"
								>
									<Icon name="user-circle" />
									{t.profile}
								</Link>
								<Link
									href={sellerHref(locale, "settings", seller)}
									className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-foreground no-underline hover:bg-info"
								>
									<Icon name="gear" />
									{accountSettingsCopy[locale].title}
								</Link>
								<Link
									href={sellerHref(locale, "password", seller)}
									className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-foreground no-underline hover:bg-info"
								>
									<Icon name="shield-lock" />
									{t.password}
								</Link>
							</nav>
							<div className="border-t border-border pt-1">
								<button
									type="button"
									disabled={busy}
									className="flex min-h-11 w-full items-center rounded-control border-0 bg-transparent px-3 py-2 text-start font-medium text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-65"
									onClick={signOut}
									aria-busy={busy}
								>
									{t.logout}
								</button>
							</div>
						</div>
					)}
				</>
			) : (
				<Link
					href={`/${locale}/auth/seller-sign-in`}
					className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-2 text-foreground shadow-sm no-underline transition-colors hover:bg-info motion-reduce:transition-none"
					aria-label={accessCopy[locale].login}
				>
					<Icon name="user-circle" className="size-9 text-muted" />
					<span className="hidden sm:inline">{accessCopy[locale].login}</span>
				</Link>
			)}
			{error && (
				<span
					role="alert"
					className="absolute end-0 top-full z-50 mt-2 w-72 rounded-control border border-danger bg-surface p-3 text-danger"
				>
					{copy.signOutError}
				</span>
			)}
		</div>
	);
}
