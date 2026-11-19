"use client";

import Link from "next/link";
import {
	ArrowUpRight,
	Package,
	ShoppingBag,
	Truck,
	TriangleAlert,
	Warehouse,
} from "lucide-react";
import { Button } from "../../../../../../components/shadcn/button";
import { Card } from "../../../../../../components/shadcn/card";
import { Badge } from "../../../../../../components/shadcn/badge";
import type { StockOverview } from "../../../../../../features/inventory/api/inventory";
import { orderListCopy } from "../../../../../../features/orders/list-copy";
import { reportCopy } from "../../../../../../features/reports/copy";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";
import { uuidPattern } from "../../../../../../lib/routes/account-routes";
import {
	RecentMessages,
	RecentOrders,
	useSellerActivity,
} from "./seller-activity";
import { useSellerNavigation } from "./seller-navigation";

const surface =
	"min-w-0 gap-0 rounded-2xl border border-solid border-border bg-surface/50 py-0 shadow-none";

export function SellerOverview({
	locale,
	seller,
	overview,
	href,
}: {
	locale: Locale;
	seller: string;
	overview: Pick<StockOverview, "counts" | "catalogue_count" | "capabilities">;
	href: (route: string, changes?: Record<string, string>) => string;
}) {
	const t = inventoryCopy[locale],
		copy = sellerShellCopy[locale],
		reports = reportCopy[locale];
	const destinations = useSellerNavigation();
	const activity = useSellerActivity(seller, locale);
	const canOpen = (route: string) =>
		Boolean(destinations?.some((page) => page.route === route));
	const canInventory = overview.capabilities.read && canOpen("inventory");
	const canMessages = canOpen("messages") && uuidPattern.test(seller);
	const number = new Intl.NumberFormat(locale);
	const counts = overview.counts;
	const summary = activity.state === "ready" ? activity.summary : null;
	const accepted = summary?.orders?.reduce(
		(total, row) => total + row.accepted,
		0,
	);
	const alerts = (counts.zero ?? 0) + (counts.low ?? 0) + (counts.expired ?? 0);
	const inventoryHref = href("inventory", { state: "", page: "1" });
	const metrics = [
		{
			label: reports.ordersTitle,
			value: accepted,
			help: reports.last30,
			Icon: ShoppingBag,
			tone: "bg-info/50",
			iconTone: "bg-info text-action",
			to: canOpen("orders") ? href("orders") : undefined,
		},
		{
			label: reports.queues.awaiting_dispatch,
			value: summary?.queues.awaiting_dispatch,
			help: copy.currentQueue,
			Icon: Truck,
			tone: "bg-surface/50",
			iconTone: "bg-success-surface text-success",
			to: canOpen("fulfilment") ? href("fulfilment") : undefined,
		},
		{
			label: copy.stockAlerts,
			value: alerts,
			help: t.attentionHint,
			Icon: TriangleAlert,
			tone: "bg-warning-surface/50",
			iconTone: "bg-warning-surface text-warning",
			to: canInventory ? inventoryHref : undefined,
		},
	];
	const categories = [
		{ key: "zero", label: copy.glanceZero, color: "bg-danger" },
		{ key: "low", label: copy.glanceLow, color: "bg-warning" },
		{ key: "expired", label: copy.glanceExpired, color: "bg-danger" },
		{ key: "expiring", label: copy.glanceExpiring, color: "bg-action" },
		{ key: "unconfigured", label: copy.glanceSetup, color: "bg-muted" },
	];
	const scale = Math.max(1, ...categories.map((item) => counts[item.key] ?? 0));
	const actions = [
		{
			route: "catalogue",
			label: t.viewAllProducts,
			Icon: Package,
			show: overview.capabilities.write && canOpen("catalogue"),
		},
		{
			route: "inventory",
			label: t.viewInventory,
			Icon: Warehouse,
			show: canInventory,
		},
		{
			route: "orders",
			label: t.viewOrders,
			Icon: ShoppingBag,
			show: canOpen("orders"),
		},
	].filter((item) => item.show);
	const viewAll = (route: string, label: string = t.viewAll) =>
		canOpen(route) ? (
			<Button
				asChild
				variant="ghost"
				size="sm"
				className="shrink-0 gap-1 text-action"
			>
				<Link href={href(route)}>
					{label}
					<ArrowUpRight
						className="size-4 rtl:-scale-x-100"
						aria-hidden="true"
					/>
				</Link>
			</Button>
		) : null;
	return (
		<div className="min-w-0 space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<nav aria-label={t.quickActions} className="flex flex-wrap gap-2">
					{actions.map(({ route, label, Icon }) => (
						<Button
							key={route}
							asChild
							variant="outline"
							size="sm"
							className="bg-surface/50"
						>
							<Link href={route === "inventory" ? inventoryHref : href(route)}>
								<Icon className="size-4" aria-hidden="true" />
								{label}
							</Link>
						</Button>
					))}
				</nav>
				{viewAll("reports", reports.openReports)}
			</div>
			<section aria-label={t.overview} className="grid gap-3 sm:grid-cols-3">
				{metrics.map((metric) => (
					<Card key={metric.label} className={`${surface} ${metric.tone}`}>
						<div className="flex items-start justify-between gap-3 p-4">
							<div className="min-w-0 space-y-1">
								<h2 className="m-0 text-sm font-medium text-muted">
									{metric.label}
								</h2>
								<p
									className="m-0 text-3xl font-semibold tracking-tight tabular-nums"
									aria-busy={
										metric.value === undefined && activity.state === "loading"
									}
								>
									{metric.value === undefined ? (
										<span
											aria-label={
												activity.state === "loading"
													? t.loading
													: orderListCopy[locale].unknown
											}
										>
											—
										</span>
									) : (
										number.format(metric.value)
									)}
								</p>
								<p className="m-0 text-xs leading-5 text-muted">
									{metric.help}
								</p>
							</div>
							<span
								className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${metric.iconTone}`}
							>
								<metric.Icon className="size-5" aria-hidden="true" />
							</span>
						</div>
						{metric.to && (
							<Button
								asChild
								variant="ghost"
								size="sm"
								className="h-9 justify-between rounded-t-none border-0 border-t border-solid border-border px-4 text-xs text-muted"
							>
								<Link href={metric.to}>
									{metric.label}
									<ArrowUpRight
										className="size-3.5 rtl:-scale-x-100"
										aria-hidden="true"
									/>
								</Link>
							</Button>
						)}
					</Card>
				))}
			</section>
			{activity.state === "failed" && (
				<p role="alert" className="m-0 text-sm text-muted">
					{copy.overviewLoadFailed}
				</p>
			)}
			<Card className={surface}>
				<div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
					<h2 className="m-0 text-base font-semibold">{t.recentOrders}</h2>
					{viewAll("orders")}
				</div>
				<RecentOrders
					locale={locale}
					seller={seller}
					activity={activity}
					fallback={
						<p className="m-0 px-5 py-6 text-sm text-muted">
							{copy.ordersUnavailableHint}
						</p>
					}
				/>
			</Card>
			<div className="grid gap-4 lg:grid-cols-2">
				<Card className={`${surface} h-112 overflow-hidden`}>
					<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
						<h2 className="m-0 text-base font-semibold">
							{t.inventoryAtGlance}
						</h2>
						{canInventory && viewAll("inventory")}
					</div>
					<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted">
							<Badge
								variant="secondary"
								className="border-0 bg-info text-action"
							>
								{number.format(counts.variants ?? 0)}
							</Badge>
							{t.totalInventory}
							<span aria-hidden="true">·</span>
							{number.format(overview.catalogue_count)} {t.productsInCatalogue}
						</div>
						<ul
							className="m-0 list-none space-y-3 p-0"
							aria-label={t.inventoryAtGlance}
						>
							{categories.map((item) => {
								const count = counts[item.key] ?? 0;
								const content = (
									<>
										<span className="flex items-center justify-between gap-3 text-sm">
											<span>{item.label}</span>
											<span className="font-semibold tabular-nums">
												{number.format(count)}
											</span>
										</span>
										<span
											aria-hidden="true"
											className="mt-2 block h-2 overflow-hidden rounded-full bg-border/40"
										>
											<span
												className={`block h-full rounded-full ${item.color}`}
												style={{ width: `${(count / scale) * 100}%` }}
											/>
										</span>
									</>
								);
								return (
									<li key={item.key}>
										{canInventory ? (
											<Link
												href={href("inventory", { state: item.key, page: "1" })}
												className="block rounded-lg py-1 text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-action hover:text-action"
											>
												{content}
											</Link>
										) : (
											<div className="py-1">{content}</div>
										)}
									</li>
								);
							})}
						</ul>
						<p className="m-0 text-xs leading-5 text-muted">
							{copy.stockChartHelp}
						</p>
					</div>
				</Card>
				<Card className={`${surface} h-112 overflow-hidden`}>
					<div className="flex shrink-0 items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
						<h2 className="m-0 text-base font-semibold">{t.recentMessages}</h2>
						{canMessages && viewAll("messages")}
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-5">
						{canMessages ? (
							<RecentMessages
								key={`${seller}:${locale}`}
								locale={locale}
								seller={seller}
							/>
						) : (
							<p className="py-4 text-sm text-muted">{copy.messagesDenied}</p>
						)}
					</div>
				</Card>
			</div>
		</div>
	);
}
