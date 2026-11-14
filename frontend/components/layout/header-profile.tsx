"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Locale } from "../../lib/i18n/locales";
import { accessCopy } from "../../lib/i18n/access";
import { authCopy } from "../../lib/i18n/auth";
import { buyerShellCopy } from "../../lib/i18n/buyer-shell";
import { inventoryCopy } from "../../lib/i18n/inventory";
import { headerCopy } from "../../lib/i18n/header";
import { sellerHref } from "../../lib/routes/account-routes";
import { authMutation } from "../../features/identity/api/accounts";
import { commerceCopy } from "../../features/orders/copy";
import { communicationCopy } from "../../features/messaging/copy";
import { fulfilmentCopy } from "../../features/fulfilment/copy";
import { paymentCopy } from "../../features/payments/copy";
import { AccessLink } from "../authentication/access-provider";
import { Icon, type IconName } from "../ui/icon";
import { useNavigation } from "./navigation-guard";
import { HeaderMenu } from "./header-menu";
import { useHeaderSession, type HeaderRole } from "./header-session";

type Tile = [route: string, label: string, icon: IconName];

/** Only the routes a signed-in user reaches for daily, per role. */
function tiles(locale: Locale, role: HeaderRole): Tile[] {
	return [
		[
			"",
			role === "buyer"
				? buyerShellCopy[locale].overview
				: inventoryCopy[locale].overview,
			"home",
		],
		["orders", commerceCopy[locale].orders, "shopping-bag"],
		["payments", paymentCopy[locale].title, "wallet"],
		[
			role === "buyer" ? "deliveries" : "fulfilment",
			role === "buyer"
				? fulfilmentCopy[locale].buyerTitle
				: fulfilmentCopy[locale].sellerTitle,
			"truck",
		],
		["messages", communicationCopy[locale].messages, "mail"],
	];
}

export function HeaderProfile({ locale }: { locale: Locale }) {
	const t = accessCopy[locale];
	const h = headerCopy[locale];
	const { buyer, seller, loading, unavailable } = useHeaderSession();
	const path = usePathname();
	const search = useSearchParams();
	const navigate = useNavigation();
	const [choice, setChoice] = useState<HeaderRole | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		void path;
		void buyer?.identity.id;
		void seller?.identity.id;
		setChoice(null);
	}, [path, buyer?.identity.id, seller?.identity.id]);
	if (loading)
		return (
			<span
				role="status"
				className="flex size-10 shrink-0 items-center justify-center text-muted"
			>
				<span className="sr-only">{t.checking}</span>
				<Icon
					name="user"
					className="size-5 animate-pulse motion-reduce:animate-none"
				/>
			</span>
		);
	if (!buyer && !seller)
		return (
			<>
				<AccessLink
					locale={locale}
					screen="buyer-sign-in"
					className="inline-flex min-h-10 shrink-0 items-center rounded-control px-3 text-sm font-semibold text-action no-underline hover:bg-info"
				>
					{t.login}
				</AccessLink>
				{unavailable && (
					<span role="status" className="sr-only">
						{t.unknown}
					</span>
				)}
			</>
		);
	const preferred: HeaderRole =
		path.includes("/account/seller") || path.endsWith("/sell")
			? "seller"
			: "buyer";
	const available: HeaderRole[] = [
		...(buyer ? (["buyer"] as const) : []),
		...(seller ? (["seller"] as const) : []),
	];
	const role: HeaderRole =
		choice && available.includes(choice)
			? choice
			: available.includes(preferred)
				? preferred
				: available[0];
	const session = role === "buyer" ? buyer : seller;
	if (!session) return null;
	const sellerParam =
		role === "seller" && path.includes("/account/seller")
			? (search.get("seller") ?? "")
			: "";
	const base = (route: string) =>
		`/${locale}/account/${role}${route ? `/${route}` : ""}`;
	const href = (route: string) =>
		role === "buyer" ? base(route) : sellerHref(locale, route, sellerParam);
	const signOut = () => {
		if (busy) return;
		navigate(() => {
			setBusy(true);
			void authMutation(`${role}/logout/`)
				.then(() => location.assign(`/${locale}`))
				.catch(() => {
					setBusy(false);
					toast.error(buyerShellCopy[locale].signOutError);
				});
		});
	};
	const name = session.identity.display_name.trim();
	const rowClass = (active: boolean) =>
		`flex min-h-12 items-center gap-3 rounded-control px-3 py-2.5 text-body font-medium text-foreground no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${
			active ? "bg-page font-semibold" : "hover:bg-page"
		}`;
	return (
		<HeaderMenu
			icon="user"
			label={t.account}
			triggerClassName="size-10 text-action"
			panelClassName="flex max-h-[min(32rem,calc(100dvh-7rem))] w-88 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-3"
			panelLabel={buyerShellCopy[locale].accountMenu}
		>
			{(close) => (
				<>
					<div className="shrink-0 rounded-control border border-border bg-surface p-4">
						<div className="flex items-center justify-between gap-3">
							<span className="min-w-0 flex-1">
								<span
									dir="auto"
									className="block truncate text-xl font-bold text-foreground"
								>
									{name || <bdi>{session.identity.email}</bdi>}
								</span>
								{name && (
									<span className="mt-1 block truncate text-sm text-muted">
										<bdi>{session.identity.email}</bdi>
									</span>
								)}
							</span>
							<span
								aria-hidden="true"
								className="flex size-12 shrink-0 items-center justify-center rounded-full bg-foreground text-surface"
							>
								<Icon name="user" className="size-6" />
							</span>
						</div>
					</div>
					{available.length > 1 && (
						<fieldset className="m-0 mt-3 flex min-w-0 shrink-0 rounded-control border-0 bg-page p-1">
							<legend className="sr-only">{t.account}</legend>
							{available.map((value) => (
								<button
									key={value}
									type="button"
									aria-pressed={role === value}
									onClick={() => setChoice(value)}
									className={`flex min-h-9 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[0.4rem] border-0 px-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${
										role === value
											? "bg-surface text-action shadow-sm"
											: "bg-transparent text-muted hover:text-foreground"
									}`}
								>
									<Icon
										name={value === "buyer" ? "shopping-bag" : "store"}
										className="size-3.5"
									/>
									{value === "buyer" ? h.buyerRole : h.sellerRole}
								</button>
							))}
						</fieldset>
					)}
					<nav
						aria-label={buyerShellCopy[locale].accountMenu}
						className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
					>
						<ul className="space-y-1">
							{tiles(locale, role).map(([route, label, icon]) => {
								const target = base(route);
								const active =
									route === ""
										? path === target
										: path === target || path.startsWith(`${target}/`);
								return (
									<li key={route || "overview"}>
										<Link
											prefetch={false}
											href={href(route)}
											aria-current={active ? "page" : undefined}
											onClick={() => close()}
											className={rowClass(active)}
										>
											<Icon name={icon} className="size-5 shrink-0" />
											<span className="min-w-0 break-words">{label}</span>
										</Link>
									</li>
								);
							})}
						</ul>
					</nav>
					<div className="mt-2 shrink-0 border-t border-border pt-2">
						<button
							type="button"
							disabled={busy}
							aria-busy={busy}
							onClick={signOut}
							className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-control border-0 bg-transparent px-3 py-2.5 text-body font-medium text-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:opacity-60 motion-reduce:transition-none"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="size-5 shrink-0 rtl:-scale-x-100"
							>
								<path d="M9 5H4v14h5 M9 12h12 m-4-4 4 4-4 4" />
							</svg>
							{authCopy[locale].logout}
						</button>
					</div>
				</>
			)}
		</HeaderMenu>
	);
}
