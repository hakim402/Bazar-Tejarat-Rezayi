"use client";
import { fulfilmentCopy } from "../../../../../../features/fulfilment/copy";
import { paymentCopy } from "../../../../../../features/payments/copy";
import { aftercareCopy } from "../../../../../../features/aftercare/copy";
import { negotiationCopy } from "../../../../../../features/negotiations/copy";
import Link from "next/link";
import { commerceCopy } from "../../../../../../features/orders/copy";
import { communicationCopy } from "../../../../../../features/messaging/copy";
import { accountSettingsCopy } from "../../../../../../lib/i18n/account-settings";
import { organizationCopy } from "../../../../../../lib/i18n/organizations";
import { authCopy } from "../../../../../../lib/i18n/auth";
import {
	createContext,
	useContext,
	useState,
	useEffect,
	useId,
	useRef,
	type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { buyerShellCopy } from "../../../../../../lib/i18n/buyer-shell";
import { Icon, type IconName } from "../../../../../../components/ui/icon";
import { BuyerPreferences } from "./buyer-preferences";
import { BuyerSidebarAccount } from "./buyer-account";
import {
	JumpToPage,
	type BuyerDestination,
	type BuyerNavigationGroup,
} from "./buyer-jump-to-page";

interface NavGroup {
	key: string;
	label: string;
	icon: IconName;
	collapsible?: boolean;
	links: [string, string, IconName][];
}

interface NavigationGroup extends BuyerNavigationGroup {
	key: string;
	icon: IconName;
	collapsible?: boolean;
}

function buyerRoute(locale: Locale, route: string) {
	if (route === "") return `/${locale}/account/buyer`;
	if (route === "cart") return `/${locale}/cart`;
	return `/${locale}/account/buyer/${route}`;
}

function NavigationTree({
	groups,
	pathname,
	onNavigate,
	collapsed = false,
	onExpand,
}: {
	groups: NavigationGroup[];
	pathname: string;
	onNavigate: () => void;
	collapsed?: boolean;
	onExpand?: () => void;
}) {
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const id = useId();
	useEffect(() => {
		void pathname;
		setExpanded({});
	}, [pathname]);
	const linkClass =
		"flex min-h-11 min-w-0 items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium text-muted no-underline transition-colors hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action aria-[current=page]:bg-info aria-[current=page]:font-semibold aria-[current=page]:text-action motion-reduce:transition-none";

	return groups.map((group) => {
		const active = group.links.some((page) => page.active);
		const open = expanded[group.key] ?? active;
		const groupId = `${id}-${group.key}`;
		if (!group.collapsible) {
			return group.links.map((page) => (
				<Link
					key={page.route}
					href={page.href}
					aria-current={page.active ? "page" : undefined}
					onNavigate={onNavigate}
					className={`${linkClass} ${collapsed ? "justify-center px-0!" : ""}`}
					title={collapsed ? page.label : undefined}
				>
					<Icon name={page.icon} className="size-5" />
					<span
						className={collapsed ? "sr-only" : "min-w-0 flex-1 wrap-anywhere"}
					>
						{page.label}
					</span>
				</Link>
			));
		}
		return (
			<div key={group.key}>
				<button
					type="button"
					aria-expanded={!collapsed && open}
					aria-controls={groupId}
					title={collapsed ? group.label : undefined}
					onClick={() => {
						if (collapsed) onExpand?.();
						setExpanded((value) => ({
							...value,
							[group.key]: collapsed || !open,
						}));
					}}
					className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-control border-0 px-3 py-2.5 text-start text-sm font-medium transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${collapsed ? "justify-center px-0!" : ""} ${active ? "bg-info text-action" : "bg-transparent text-muted hover:text-foreground"}`}
				>
					<Icon name={group.icon} className="size-5" />
					<span
						className={collapsed ? "sr-only" : "min-w-0 flex-1 wrap-anywhere"}
					>
						{group.label}
					</span>
					{!collapsed && (
						<Icon
							name="chevron-down"
							className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
						/>
					)}
				</button>
				<div
					id={groupId}
					hidden={collapsed || !open}
					className="ms-5 mt-1 space-y-1 border-s border-border ps-3"
				>
					{group.links.map((page) => (
						<Link
							key={page.route}
							href={page.href}
							aria-current={page.active ? "page" : undefined}
							onNavigate={onNavigate}
							className={linkClass}
						>
							<span className="min-w-0 flex-1 wrap-anywhere">{page.label}</span>
							{page.active && (
								<span
									aria-hidden="true"
									className="size-1.5 shrink-0 rounded-full bg-action"
								/>
							)}
						</Link>
					))}
				</div>
			</div>
		);
	});
}

const BuyerNavigationContext = createContext<readonly BuyerDestination[] | null>(
	null,
);

export function useBuyerNavigation() {
	return useContext(BuyerNavigationContext);
}

export function BuyerNavigation({
	locale,
	children,
}: {
	locale: Locale;
	children?: ReactNode;
}) {
	const copy = buyerShellCopy[locale];
	const drawer = useRef<HTMLDialogElement>(null);
	const moreButton = useRef<HTMLButtonElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);
	const drawerId = useId();
	const drawerTitleId = useId();
	const [moreOpen, setMoreOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const sidebarId = useId();
	const path = usePathname();

	const groups: NavGroup[] = [
		{
			key: "overview",
			label: copy.overview,
			icon: "home",
			links: [["", copy.overview, "home"]],
		},
		{
			key: "shopping",
			label: copy.shopping,
			icon: "cart",
			collapsible: true,
			links: [
				["cart", commerceCopy[locale].cart, "cart"],
				["checkouts", commerceCopy[locale].history, "history"],
			],
		},
		{
			key: "ordersDelivery",
			label: copy.ordersDelivery,
			icon: "shopping-bag",
			collapsible: true,
			links: [
				["orders", commerceCopy[locale].orders, "shopping-bag"],
				["deliveries", fulfilmentCopy[locale].buyerTitle, "truck"],
				["cancellations", aftercareCopy[locale].buyerTitle, "return"],
			],
		},
		{
			key: "paymentsAgreements",
			label: copy.paymentsAgreements,
			icon: "wallet",
			collapsible: true,
			links: [
				["payments", paymentCopy[locale].title, "wallet"],
				["invoices", commerceCopy[locale].invoices, "receipt"],
				["negotiations", negotiationCopy[locale].title, "handshake"],
			],
		},
		{
			key: "messages",
			label: communicationCopy[locale].messages,
			icon: "mail",
			links: [["messages", communicationCopy[locale].messages, "mail"]],
		},
		{
			key: "notifications",
			label: copy.notifications,
			icon: "bell",
			links: [["notifications", copy.notifications, "bell"]],
		},
		{
			key: "business",
			label: copy.business,
			icon: "team",
			collapsible: true,
			links: [["organizations", organizationCopy[locale].title, "team"]],
		},
		{
			key: "settings",
			label: copy.settingsSecurity,
			icon: "gear",
			collapsible: true,
			links: [
				["settings", accountSettingsCopy[locale].title, "gear"],
				["profile", authCopy[locale].profile, "user-circle"],
				["password", authCopy[locale].password, "shield-lock"],
				["link", copy.sellerAccess, "link"],
			],
		},
	];

	const isActive = (route: string) => {
		const href = buyerRoute(locale, route);
		if (route === "") return path === href;
		if (route === "cart") return path === href;
		return path === href || path.startsWith(`${href}/`);
	};

	const visibleGroups: NavigationGroup[] = groups.map((group) => ({
		key: group.key,
		label: group.label,
		icon: group.icon,
		collapsible: group.collapsible,
		links: group.links.map(([route, label, icon]) => ({
			route,
			label,
			icon,
			href: buyerRoute(locale, route),
			active: isActive(route),
		})),
	}));
	const destinations = visibleGroups.flatMap((group) => group.links);

	const navigation = (
		<nav aria-label={copy.navigation} className="space-y-1.5 px-3 py-5">
			<NavigationTree
				groups={visibleGroups}
				pathname={path}
				onNavigate={() => drawer.current?.close()}
			/>
		</nav>
	);

	const mobileRoutes = ["", "orders", "cart", "messages"];
	const moreActive = destinations.some(
		(page) => page.active && !mobileRoutes.includes(page.route),
	);

	return (
		<BuyerNavigationContext.Provider value={destinations}>
			<JumpToPage locale={locale} groups={visibleGroups} />
			<div dir={direction(locale)} className="flex min-w-0">
				<aside
					dir={direction(locale)}
					className={`sticky top-20 hidden h-[calc(100dvh-80px)] shrink-0 flex-col self-start border-e border-border bg-surface sm:flex ${collapsed ? "w-18" : "w-48 lg:w-60"}`}
				>
					<div
						className={`flex min-h-16 shrink-0 items-center gap-2 px-3 ${collapsed ? "justify-center" : "justify-between"}`}
					>
						{!collapsed && (
							<span
								dir={direction(locale)}
								className="text-xs font-semibold text-muted"
							>
								{copy.navigation}
							</span>
						)}
						<button
							type="button"
							aria-label={collapsed ? copy.expandSidebar : copy.collapseSidebar}
							title={collapsed ? copy.expandSidebar : copy.collapseSidebar}
							aria-expanded={!collapsed}
							aria-controls={sidebarId}
							onClick={() => setCollapsed((value) => !value)}
							className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-info hover:text-foreground"
						>
							<Icon name="menu" />
						</button>
					</div>
					<nav
						id={sidebarId}
						aria-label={copy.navigation}
						className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 pb-5 [scrollbar-width:thin]"
					>
						<NavigationTree
							groups={visibleGroups}
							pathname={path}
							collapsed={collapsed}
							onExpand={() => setCollapsed(false)}
							onNavigate={() => drawer.current?.close()}
						/>
					</nav>
					<BuyerSidebarAccount locale={locale} collapsed={collapsed} />
				</aside>
				<div dir={direction(locale)} className="min-w-0 flex-1">
					{children}
				</div>
			</div>
			<nav
				aria-label={copy.navigation}
				className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t border-border bg-surface pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] sm:hidden"
			>
				{mobileRoutes.map((route) => {
					const configured = groups
						.flatMap((group) => group.links)
						.find(([key]) => key === route);
					if (!configured) return null;
					const [, label, icon] = configured;
					const page = destinations.find(
						(destination) => destination.route === route,
					);
					const content = (
						<>
							<Icon name={icon} className="size-5" />
							<span className="max-w-full truncate text-xs font-medium">
								{label}
							</span>
						</>
					);
					const className =
						"flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-control px-1 py-2 text-muted no-underline hover:bg-info aria-[current=page]:bg-info aria-[current=page]:text-action";
					return page ? (
						<Link
							key={route}
							href={page.href}
							aria-current={page.active ? "page" : undefined}
							className={className}
						>
							{content}
						</Link>
					) : (
						<span
							key={route}
							aria-disabled="true"
							className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-muted opacity-60"
						>
							{content}
						</span>
					);
				})}
				<button
					ref={moreButton}
					type="button"
					aria-haspopup="dialog"
					aria-controls={drawerId}
					aria-expanded={moreOpen}
					data-active={moreActive || moreOpen ? "true" : undefined}
					onClick={() => {
						if (!drawer.current || drawer.current.open) return;
						drawer.current.showModal();
						setMoreOpen(true);
						closeButton.current?.focus();
					}}
					className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-control border-0 bg-transparent px-1 py-2 text-muted hover:bg-info data-[active=true]:bg-info data-[active=true]:text-action"
				>
					<Icon name="more" className="size-5" />
					<span className="max-w-full truncate text-xs font-medium">
						{copy.more}
					</span>
				</button>
			</nav>
			<dialog
				ref={drawer}
				id={drawerId}
				dir={direction(locale)}
				tabIndex={-1}
				aria-labelledby={drawerTitleId}
				onCancel={(event) => {
					event.preventDefault();
					event.currentTarget.close();
				}}
				onClose={(event) => {
					if (event.currentTarget.open) return;
					setMoreOpen(false);
					if (moreButton.current?.getClientRects().length)
						moreButton.current.focus();
				}}
				onClick={(event) => {
					if (event.target !== event.currentTarget) return;
					const rect = event.currentTarget.getBoundingClientRect();
					if (
						event.clientX < rect.left ||
						event.clientX > rect.right ||
						event.clientY < rect.top ||
						event.clientY > rect.bottom
					)
						event.currentTarget.close();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Tab") return;
					const controls = Array.from(
						event.currentTarget.querySelectorAll<HTMLElement>(
							"button, a[href], select",
						),
					);
					const visibleControls = controls.filter(
						(control) =>
							control.tabIndex >= 0 && control.getClientRects().length,
					);
					const first = visibleControls[0],
						last = visibleControls[visibleControls.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}}
				className="fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-[min(22rem,calc(100vw-3rem))] max-w-none overflow-hidden border-0 border-e border-border bg-surface p-0 text-foreground shadow-lifted backdrop:bg-overlay"
			>
				<div className="flex h-full flex-col">
					<div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
						<h2 id={drawerTitleId} className="text-body font-semibold">
							{copy.navigation}
						</h2>
						<button
							ref={closeButton}
							type="button"
							aria-label={copy.close}
							onClick={() => drawer.current?.close()}
							className="flex min-h-11 min-w-11 items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-info hover:text-foreground"
						>
							<Icon name="close" />
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{navigation}
					</div>
					<BuyerSidebarAccount locale={locale} />
					<div className="shrink-0 border-t border-border px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
						<BuyerPreferences locale={locale} drawer />
					</div>
				</div>
			</dialog>
		</BuyerNavigationContext.Provider>
	);
}
