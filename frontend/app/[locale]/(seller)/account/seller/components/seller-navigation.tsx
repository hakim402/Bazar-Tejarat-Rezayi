"use client";
import { fulfilment } from "../../../../../../features/fulfilment/api";
import { fulfilmentCopy } from "../../../../../../features/fulfilment/copy";
import { paymentCopy } from "../../../../../../features/payments/copy";
import { reportCopy } from "../../../../../../features/reports/copy";
import { aftercareCopy } from "../../../../../../features/aftercare/copy";
import { negotiationCopy } from "../../../../../../features/negotiations/copy";
import Link from "next/link";
import { commerce, type Profile } from "../../../../../../features/orders/api";
import { ACCOUNT_SESSION_CHANGED } from "../../../../../../features/identity/api/accounts";
import { commerceCopy } from "../../../../../../features/orders/copy";
import { communicationCopy } from "../../../../../../features/messaging/copy";
import { sellerSalesCopy } from "../../../../../../lib/i18n/seller-sales";
import { sellerSettingsCopy } from "../../../../../../lib/i18n/seller-settings";
import { sellerProductsCopy } from "../../../../../../lib/i18n/seller-products";
import { settingsDestinations } from "../../../../../../components/accounts/seller-settings-ui";
import {
	createContext,
	useContext,
	useState,
	useEffect,
	useId,
	useRef,
	type ReactNode,
} from "react";
import {
	inventoryRequest,
	type StockProfiles,
} from "../../../../../../features/inventory/api/inventory";
import { usePathname, useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";
import { sellerHref } from "../../../../../../lib/routes/account-routes";
import { Icon, type IconName } from "../../../../../../components/ui/icon";
import { SellerPreferences } from "./seller-preferences";
import { SellerSidebarAccount } from "./seller-account";
import {
	JumpToPage,
	type SellerDestination,
	type SellerNavigationGroup,
} from "./jump-to-page";

interface NavGroup {
	key: string;
	label: string;
	icon: IconName;
	collapsible?: boolean;
	links: [string, string, IconName, boolean?][];
}

interface NavigationGroup extends SellerNavigationGroup {
	key: string;
	icon: IconName;
	collapsible?: boolean;
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
		"flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted no-underline transition-colors hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action aria-[current=page]:bg-info aria-[current=page]:font-semibold aria-[current=page]:text-action motion-reduce:transition-none";

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
					className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border-0 px-3 py-2.5 text-start text-sm font-medium transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${collapsed ? "justify-center px-0!" : ""} ${active ? "bg-info text-action" : "bg-transparent text-muted hover:text-foreground"}`}
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

const SellerNavigationContext = createContext<
	readonly SellerDestination[] | null
>(null);

// Authorized workspace destinations include actions grouped under the compact sidebar.
// Presentation hints only; every API still checks current permissions.
export function useSellerNavigation() {
	return useContext(SellerNavigationContext);
}

export function SellerNavigation({
	locale,
	children,
}: {
	locale: Locale;
	children?: ReactNode;
}) {
	const copy = sellerShellCopy[locale];
	const drawer = useRef<HTMLDialogElement>(null);
	const moreButton = useRef<HTMLButtonElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);
	const drawerId = useId();
	const drawerTitleId = useId();
	const [moreOpen, setMoreOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const sidebarId = useId();
	const t = inventoryCopy[locale],
		path = usePathname(),
		seller = useSearchParams().get("seller");
	const [caps, setCaps] = useState<{ read: boolean; write: boolean } | null>(
		null,
	);
	const [delivery, setDelivery] = useState<boolean | null>(null);
	const [orderCaps, setOrderCaps] = useState<{
		orders: boolean;
		invoices: boolean;
	} | null>(null);
	useEffect(() => {
		let current = true,
			generation = 0;
		setCaps(null);
		const refresh = () => {
			const mine = ++generation;
			setCaps(null);
			setOrderCaps(null);
			setDelivery(null);
			void fulfilment<{ count: number }>(
				"seller",
				`profiles/${seller ? `?seller=${seller}` : ""}`,
			)
				.then((value) => {
					if (current && mine === generation) setDelivery(value.count > 0);
				})
				.catch(() => {
					if (current && mine === generation) setDelivery(null);
				});
			void commerce<{ results: Profile[] }>("orders/seller/profiles/")
				.then((value) => {
					if (!current || mine !== generation) return;
					const rows = seller
						? value.results.filter((p) => p.id === seller)
						: value.results;
					setOrderCaps({
						orders: rows.some((p) => p.orders),
						invoices: rows.some((p) => p.invoices),
					});
				})
				.catch(() => {
					if (current && mine === generation) setOrderCaps(null);
				});
			void inventoryRequest<StockProfiles>("seller/profiles/")
				.then((value) => {
					if (!current || mine !== generation) return;
					const profile = seller
						? value.profiles.find((p) => p.id === seller)
						: value.profiles[0];
					setCaps(profile?.capabilities ?? null);
				})
				.catch(() => {
					if (current && mine === generation) setCaps(null);
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
	}, [seller]);

	useEffect(() => {
		void path;
		void seller;
		drawer.current?.close();
	}, [path, seller]);

	useEffect(() => {
		const desktop = window.matchMedia("(min-width: 640px)");
		const closeOnDesktop = () => {
			if (desktop.matches) drawer.current?.close();
		};
		desktop.addEventListener("change", closeOnDesktop);
		return () => desktop.removeEventListener("change", closeOnDesktop);
	}, []);

	const groups: NavGroup[] = [
		{
			key: "overview",
			label: t.overview,
			icon: "home",
			links: [["", t.overview, "home"]],
		},
		{
			key: "reports",
			label: reportCopy[locale].sellerTitle,
			icon: "trending-up",
			links: [
				[
					"reports",
					reportCopy[locale].sellerTitle,
					"trending-up",
					!!(orderCaps?.orders || orderCaps?.invoices || delivery),
				],
			],
		},
		{
			key: "products",
			label: t.products,
			icon: "box",
			links: [["catalogue", sellerProductsCopy[locale].title, "box"]],
		},
		{
			key: "inventory",
			label: t.inventory,
			icon: "warehouse",
			links: [["inventory", t.inventory, "warehouse", !!caps?.read]],
		},
		{
			key: "sales",
			label: copy.sales,
			icon: "shopping-bag",
			collapsible: true,
			links: [
				[
					"orders",
					commerceCopy[locale].orders,
					"shopping-bag",
					!!orderCaps?.orders,
				],
				[
					"negotiations",
					negotiationCopy[locale].title,
					"handshake",
					!!orderCaps?.orders,
				],
				["fulfilment", fulfilmentCopy[locale].sellerTitle, "truck", !!delivery],
				["aftercare", aftercareCopy[locale].sellerTitle, "return"],
				[
					"disputes",
					aftercareCopy[locale].disputes,
					"shield",
					!!orderCaps?.orders,
				],
				[
					"invoices",
					commerceCopy[locale].invoices,
					"receipt",
					!!orderCaps?.invoices,
				],
				[
					"payments",
					paymentCopy[locale].title,
					"wallet",
					!!orderCaps?.invoices,
				],
			],
		},
		{
			key: "messages",
			label: communicationCopy[locale].messages,
			icon: "mail",
			links: [["messages", communicationCopy[locale].messages, "mail"]],
		},
		{
			key: "business",
			label: copy.business,
			icon: "team",
			collapsible: true,
			links: [["organizations", t.organization, "team"]],
		},
		{
			key: "notifications",
			label: copy.notifications,
			icon: "bell",
			links: [["notifications", copy.notifications, "bell"]],
		},
		{
			key: "settings",
			label: copy.settingsSecurity,
			icon: "gear",
			collapsible: true,
			links: settingsDestinations.map((item) => [
				item.path,
				sellerSettingsCopy[locale][item.key],
				item.icon,
			]),
		},
	];

	const isActive = (route: string) =>
		path === sellerHref(locale, route) ||
		([
			"catalogue",
			"organizations",
			"messages",
			"negotiations",
			"orders",
			"invoices",
			"payments",
			"fulfilment",
			"aftercare",
			"disputes",
		].includes(route) &&
			path.startsWith(`${sellerHref(locale, route)}/`)) ||
		(route === "inventory" &&
			path.includes("/inventory/") &&
			!path.endsWith("/movements"));

	const authorizedGroups: NavigationGroup[] = groups
		.map((group) => ({
			key: group.key,
			label: group.label,
			icon: group.icon,
			collapsible: group.collapsible,
			links: group.links
				.filter(([, , , condition]) => condition !== false)
				.map(([route, label, icon]) => ({
					route,
					label,
					icon,
					href: sellerHref(locale, route, seller),
					active: isActive(route),
				})),
		}))
		.filter((group) => group.links.length > 0);
	const availableDestinations = authorizedGroups.flatMap(
		(group) => group.links,
	);
	const labels = sellerSalesCopy[locale];
	const visibleGroups = authorizedGroups.map((group) => {
		if (group.key !== "sales") return group;
		const canonical = [
			{ routes: ["orders", "fulfilment"], label: labels.orders },
			{ routes: ["negotiations"], label: labels.negotiations },
			{ routes: ["payments", "invoices"], label: labels.finance },
			{ routes: ["aftercare", "disputes"], label: labels.issues },
		];
		return {
			...group,
			links: canonical.flatMap((item) => {
				const destination = item.routes
					.map((route) => group.links.find((link) => link.route === route))
					.find(Boolean);
				return destination
					? [
							{
								...destination,
								label: item.label,
								active: group.links.some(
									(link) => item.routes.includes(link.route) && link.active,
								),
							},
						]
					: [];
			}),
		};
	});
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

	const mobileRoutes = ["", "catalogue", "orders", "messages"];
	const moreActive = destinations.some(
		(page) =>
			page.active &&
			!mobileRoutes.includes(page.route) &&
			page.route !== "catalogue/new",
	);

	return (
		<SellerNavigationContext.Provider value={availableDestinations}>
			<JumpToPage locale={locale} groups={visibleGroups} scope={seller} />
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
					<SellerSidebarAccount locale={locale} collapsed={collapsed} />
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
							aria-current={
								page.active ||
								(route === "catalogue" &&
									path === sellerHref(locale, "catalogue/new"))
									? "page"
									: undefined
							}
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
					<SellerSidebarAccount locale={locale} />
					<div className="shrink-0 border-t border-border px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
						<SellerPreferences locale={locale} drawer />
					</div>
				</div>
			</dialog>
		</SellerNavigationContext.Provider>
	);
}
