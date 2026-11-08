"use client";

import Link from "next/link";
import { DashboardCard } from "../../../../../../components/ui/dashboard-card";
import { EmptyState } from "../../../../../../components/ui/empty-state";
import { Icon } from "../../../../../../components/ui/icon";
import { RecentMessagesList } from "../../../../../../components/ui/recent-messages-list";
import { RecentOrdersList } from "../../../../../../components/ui/recent-orders-list";
import { StatCard } from "../../../../../../components/ui/stat-card";
import { TopProductsList } from "../../../../../../components/ui/top-products-list";
import { ViewAllLink } from "../../../../../../components/ui/view-all-link";
import type { StockOverview } from "../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";
import { CatalogueCard } from "../inventory/components/catalogue-card";
import { StockGlance } from "../inventory/components/stock-ui";
import { useSellerNavigation } from "./seller-navigation";

const metricCardClassName =
	"border-border! [&>div]:flex-col [&>div]:gap-3 [&>div>div:last-child]:w-full";
const dashboardCardClassName = "h-full border-border!";

export function SellerOverview({
	locale,
	overview,
	href,
}: {
	locale: Locale;
	overview: Pick<StockOverview, "counts" | "catalogue_count" | "capabilities">;
	href: (route: string, changes?: Record<string, string>) => string;
}) {
	const t = inventoryCopy[locale];
	const copy = sellerShellCopy[locale];
	const destinations = useSellerNavigation();
	const canOpen = (route: string) =>
		Boolean(destinations?.some((page) => page.route === route));
	const canViewCatalogue = overview.capabilities.write && canOpen("catalogue");
	const counts = overview.counts;
	// Attention categories overlap; this sum is not a unique-product count.
	const needsAttention =
		(counts.zero ?? 0) + (counts.low ?? 0) + (counts.expired ?? 0);
	const activeVariants =
		(counts.variants ?? 0) -
		(counts.unconfigured ?? 0) -
		(counts.inactive ?? 0);
	const inventoryHref = href("inventory", { state: "", page: "1" });
	const quickActions = [
		{
			route: "catalogue",
			title: t.addProduct,
			description: t.addProductHelp,
			icon: "plus" as const,
			tone: "bg-on-primary/15 text-on-primary",
			primary: true,
			visible: canViewCatalogue,
		},
		{
			route: "inventory",
			title: t.viewInventory,
			description: t.viewInventoryHelp,
			icon: "warehouse" as const,
			tone: "bg-chip-success-bg text-chip-success",
			primary: false,
			visible: overview.capabilities.read && canOpen("inventory"),
		},
		{
			route: "orders",
			title: t.viewOrders,
			description: t.viewOrdersHelp,
			icon: "shopping-bag" as const,
			tone: "bg-chip-warning-bg text-chip-warning-icon",
			primary: false,
			visible: canOpen("orders"),
		},
		{
			route: "organizations",
			title: t.organization,
			description: t.businessTeamHelp,
			icon: "team" as const,
			tone: "bg-chip-neutral-bg text-chip-neutral",
			primary: false,
			visible: canOpen("organizations"),
		},
	].filter((item) => item.visible);

	return (
		<div className="min-w-0 space-y-5 lg:space-y-6">
			<section
				aria-label={t.overview}
				className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5"
			>
				<CatalogueCard
					locale={locale}
					count={overview.catalogue_count}
					href={canViewCatalogue ? href("catalogue") : undefined}
					className={metricCardClassName}
				/>
				<StatCard
					className={metricCardClassName}
					locale={locale}
					icon="warehouse"
					chip="success"
					label={t.totalInventory}
					value={counts.variants ?? 0}
					hint={
						<span className="text-sm leading-relaxed">
							{t.totalInventoryHint}
						</span>
					}
					href={inventoryHref}
				/>
				<StatCard
					className={metricCardClassName}
					locale={locale}
					icon="alert-triangle"
					chip="warning"
					label={t.needsAttention}
					value={needsAttention}
					hint={
						<span className="text-sm leading-relaxed">
							{copy.attentionCategoriesHint}
						</span>
					}
					href={inventoryHref}
				/>
				<StatCard
					className={metricCardClassName}
					locale={locale}
					icon="check-circle"
					chip="info"
					label={t.activeVariants}
					value={activeVariants}
					hint={<span className="text-sm leading-relaxed">{t.activeHint}</span>}
					href={inventoryHref}
				/>
			</section>
			<div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
				<DashboardCard
					className={dashboardCardClassName}
					title={t.salesOverview}
					action={
						canOpen("orders") ? (
							<ViewAllLink href={href("orders")} label={t.viewAll} />
						) : undefined
					}
				>
					<EmptyState
						borderless
						icon="trending-up"
						title={copy.salesUnavailable}
						description={copy.salesUnavailableHint}
					/>
				</DashboardCard>
				<DashboardCard
					className={dashboardCardClassName}
					title={t.recentOrders}
					action={
						canOpen("orders") ? (
							<ViewAllLink href={href("orders")} label={t.viewAll} />
						) : undefined
					}
				>
					<RecentOrdersList
						orders={[]}
						locale={locale}
						statusLabels={{
							delivered: t.orderDelivered,
							pending: t.orderPending,
							shipped: t.orderShipped,
							cancelled: t.orderCancelled,
						}}
						emptyTitle={copy.ordersUnavailable}
						emptyDescription={copy.ordersUnavailableHint}
					/>
				</DashboardCard>
			</div>
			<div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
				<DashboardCard
					className={dashboardCardClassName}
					title={t.topProducts}
					action={
						canViewCatalogue ? (
							<ViewAllLink href={href("catalogue")} label={t.viewAll} />
						) : undefined
					}
				>
					<TopProductsList
						products={[]}
						locale={locale}
						emptyTitle={copy.productsUnavailable}
						emptyDescription={copy.productsUnavailableHint}
					/>
				</DashboardCard>
				<DashboardCard
					className={dashboardCardClassName}
					title={t.recentMessages}
					action={
						canOpen("messages") ? (
							<ViewAllLink href={href("messages")} label={t.viewAll} />
						) : undefined
					}
				>
					<RecentMessagesList
						messages={[]}
						locale={locale}
						unreadLabel={t.unread}
						emptyTitle={copy.messagesUnavailable}
						emptyDescription={copy.messagesUnavailableHint}
					/>
				</DashboardCard>
				<DashboardCard
					className={dashboardCardClassName}
					title={t.quickActions}
				>
					<div className="space-y-2">
						{quickActions.map((item) => (
							<Link
								key={item.route}
								href={href(item.route)}
								className={`flex min-h-16 min-w-0 items-center gap-2 rounded-xl px-2 py-3 no-underline transition-colors duration-150 motion-reduce:transition-none xl:gap-3 xl:px-3 ${
									item.primary
										? "bg-primary text-on-primary hover:brightness-95"
										: "text-foreground hover:bg-info"
								}`}
							>
								<span
									aria-hidden="true"
									className={`flex size-9 shrink-0 items-center justify-center rounded-xl xl:size-11 ${item.tone}`}
								>
									<Icon name={item.icon} className="size-5" />
								</span>
								<span className="min-w-0 flex-1 wrap-anywhere">
									<span className="block text-sm font-semibold leading-snug">
										{item.title}
									</span>
									<span
										className={`mt-1 block text-sm leading-relaxed ${item.primary ? "text-on-primary" : "text-muted"}`}
									>
										{item.description}
									</span>
								</span>
								<Icon
									name="chevron"
									className={`size-4 shrink-0 ${item.primary ? "text-on-primary" : "text-muted"}`}
								/>
							</Link>
						))}
					</div>
				</DashboardCard>
			</div>
			<StockGlance
				locale={locale}
				counts={counts}
				href={href}
				className={dashboardCardClassName}
			/>
			<p className="text-caption leading-relaxed text-muted">
				{t.overviewScope}
			</p>
		</div>
	);
}
