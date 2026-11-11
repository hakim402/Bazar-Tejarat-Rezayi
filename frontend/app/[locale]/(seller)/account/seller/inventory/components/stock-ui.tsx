"use client";

import {
	AlertTriangle,
	ChevronLeft,
	ChevronRight,
	Clock,
	Ellipsis,
	Package,
	PackageX,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { Card } from "../../../../../../../components/shadcn/card";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
} from "../../../../../../../components/shadcn/pagination";
import { DashboardCard } from "../../../../../../../components/ui/dashboard-card";
import { Icon } from "../../../../../../../components/ui/icon";
import type { StockOverview } from "../../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import { sellerShellCopy } from "../../../../../../../lib/i18n/seller-shell";
import {
	sellerHref,
	type QueryReader,
} from "../../../../../../../lib/routes/account-routes";

const inventoryKeys = ["q", "state", "sort", "page"] as const;
const historyKeys = ["q", "action", "variant", "batch", "page"] as const;

export function stockHref(
	locale: Locale,
	path: string,
	seller: string,
	params?: QueryReader,
	changes: Record<string, string> = {},
	fromMovement = false,
) {
	if (!path.startsWith("inventory")) return sellerHref(locale, path, seller);
	const next = new URLSearchParams({ seller });
	const movement = path === "inventory/movements";
	for (const key of movement ? historyKeys : inventoryKeys) {
		// Inventory searches match product titles; movement searches match SKU/reason.
		// Only carry filters into history when returning to an existing history view.
		const value =
			movement && params?.get("history") === "1"
				? params.get(`history_${key}`)
				: movement && !fromMovement
					? null
					: params?.get(key);
		if (value) next.set(key, value);
	}
	if (!movement && path.includes("/batches/")) {
		next.set(
			"stock_page",
			params?.get("stock_page") ?? params?.get("page") ?? "1",
		);
		next.set(
			"page",
			params?.get("stock_page") ? (params.get("page") ?? "1") : "1",
		);
	} else if (!movement && params?.get("stock_page")) {
		next.set("page", params.get("stock_page") ?? "1");
	}
	if (!movement && params?.get("history") === "1") {
		next.set("history", "1");
		for (const key of historyKeys) {
			const value = params.get(`history_${key}`);
			if (value) next.set(`history_${key}`, value);
		}
	}
	for (const [key, value] of Object.entries(changes)) {
		if (value) next.set(key, value);
		else next.delete(key);
	}
	return `${sellerHref(locale, path)}?${next}`;
}

export function movementStockHref(
	locale: Locale,
	path: string,
	seller: string,
	params?: QueryReader,
) {
	const context = new URLSearchParams({ history: "1" });
	for (const key of historyKeys) {
		const value = params?.get(key);
		if (value) context.set(`history_${key}`, value);
	}
	return stockHref(locale, path, seller, context);
}

export function StockGlance({
	locale,
	counts,
	href,
	className = "h-full border-border!",
}: {
	locale: Locale;
	counts: StockOverview["counts"];
	href: (route: string, changes?: Record<string, string>) => string;
	className?: string;
}) {
	const t = inventoryCopy[locale],
		copy = sellerShellCopy[locale];
	const glance = [
		{
			key: "variants",
			label: copy.glanceTotal,
			accessibleLabel: t.totalInventory,
			state: "",
			icon: "warehouse",
			tone: "",
		},
		{
			key: "unconfigured",
			label: copy.glanceSetup,
			accessibleLabel: t.unconfigured,
			state: "unconfigured",
			icon: "sliders",
			tone: "",
		},
		{
			key: "inactive",
			label: copy.glanceInactive,
			accessibleLabel: t.inactive,
			state: "inactive",
			icon: "eye",
			tone: "",
		},
		{
			key: "zero",
			label: copy.glanceZero,
			accessibleLabel: t.zero,
			state: "zero",
			icon: "box",
			tone: "danger",
		},
		{
			key: "low",
			label: copy.glanceLow,
			accessibleLabel: t.low,
			state: "low",
			icon: "alert-triangle",
			tone: "warning",
		},
		{
			key: "expired",
			label: copy.glanceExpired,
			accessibleLabel: t.expired,
			state: "expired",
			icon: "clock",
			tone: "danger",
		},
		{
			key: "expiring",
			label: copy.glanceExpiring,
			accessibleLabel: t.expiring,
			state: "expiring",
			icon: "clock",
			tone: "warning",
		},
		{
			key: "held",
			label: copy.glanceHeld,
			accessibleLabel: t.held,
			state: "held",
			icon: "lock",
			tone: "",
		},
	] as const;
	const numberFormat = new Intl.NumberFormat(locale);
	return (
		<DashboardCard className={className} title={t.inventoryAtGlance}>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-3">
				{glance.map((item) => {
					const value = counts[item.key] ?? 0,
						formattedValue = numberFormat.format(value),
						alert = value > 0 && item.tone;
					return (
						<Link
							key={item.key}
							href={href("inventory", { state: item.state, page: "1" })}
							aria-label={`${item.accessibleLabel}: ${formattedValue} (${item.label})`}
							className="flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-border px-3 py-3 text-center no-underline transition-colors duration-150 hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
						>
							<span
								className={`flex items-center justify-center gap-2 ${alert === "danger" ? "text-danger" : alert === "warning" ? "text-warning" : "text-foreground"}`}
							>
								<Icon
									name={item.icon}
									className={`size-4 ${alert ? "" : "text-muted"}`}
								/>
								<bdi className="text-xl font-semibold tabular-nums">
									{formattedValue}
								</bdi>
							</span>
							<span
								className={`text-sm font-medium leading-snug wrap-anywhere ${alert === "danger" ? "text-danger" : alert === "warning" ? "text-warning" : "text-muted"}`}
							>
								{item.label}
							</span>
						</Link>
					);
				})}
			</div>
		</DashboardCard>
	);
}

export function StockPagination({
	locale,
	page,
	count,
	size,
	href,
	onPage,
}: {
	locale: Locale;
	page: number;
	count: number;
	size: number;
	href: (page: number) => string;
	onPage: (page: number) => void;
}) {
	if (count <= 0) return null;
	const t = inventoryCopy[locale],
		copy = sellerInventoryCopy[locale],
		last = Math.min(10000, Math.max(1, Math.ceil(count / size))),
		current = Math.min(page, last),
		pages = [
			...new Set([
				1,
				...[current - 1, current, current + 1].filter(
					(n) => n > 0 && n <= last,
				),
				last,
			]),
		].sort((a, b) => a - b),
		numberFormat = new Intl.NumberFormat(locale),
		start = (current - 1) * size + 1,
		end = Math.min(count, current * size);
	const go = (n: number) => (event: MouseEvent<HTMLAnchorElement>) => {
		event.preventDefault();
		onPage(n);
	};
	const step = (
		n: number,
		label: string,
		icon: "back" | "next",
		off: boolean,
	) => (
		<PaginationLink
			href={off ? undefined : href(n)}
			aria-label={label}
			aria-disabled={off || undefined}
			tabIndex={off ? -1 : undefined}
			title={label}
			className={`size-10 rounded-xl border-border ${off ? "pointer-events-none opacity-35" : "cursor-pointer"}`}
			onClick={(event) => {
				event.preventDefault();
				if (!off) onPage(n);
			}}
		>
			{icon === "back" ? (
				<ChevronLeft className="size-4 rtl:rotate-180" />
			) : (
				<ChevronRight className="size-4 rtl:rotate-180" />
			)}
		</PaginationLink>
	);
	return (
		<div className="mt-5 flex flex-col items-center justify-between gap-3 border-t border-border pt-4 desktop:flex-row">
			<p className="m-0 shrink-0 text-xs text-muted">
				{copy.showing
					.replace("{start}", numberFormat.format(start))
					.replace("{end}", numberFormat.format(end))
					.replace("{total}", numberFormat.format(count))}
			</p>
			<Pagination aria-label={t.page} className="mx-0 w-auto">
				<PaginationContent className="m-0 list-none p-0">
					<PaginationItem>
						{step(Math.max(1, current - 1), t.previous, "back", current <= 1)}
					</PaginationItem>
					{pages.map((n, index) => (
						<PaginationItem key={n} className="flex items-center gap-1">
							{index > 0 && n - pages[index - 1] > 1 && (
								<span
									aria-hidden="true"
									className="flex size-6 items-center justify-center text-muted"
								>
									<Ellipsis className="size-4" />
								</span>
							)}
							<PaginationLink
								href={href(n)}
								isActive={n === current}
								aria-label={`${t.page} ${numberFormat.format(n)}`}
								className={`size-10 rounded-xl border-border ${n === current ? "bg-action text-on-primary hover:bg-action hover:text-on-primary" : ""}`}
								onClick={go(n)}
							>
								{numberFormat.format(n)}
							</PaginationLink>
						</PaginationItem>
					))}
					<PaginationItem>
						{step(Math.min(last, current + 1), t.next, "next", current >= last)}
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}

export function StockSummary({
	locale,
	counts,
	href,
}: {
	locale: Locale;
	counts: StockOverview["counts"];
	href: (route: string, changes?: Record<string, string>) => string;
}) {
	const t = inventoryCopy[locale],
		numberFormat = new Intl.NumberFormat(locale),
		items = [
			{
				key: "variants",
				state: "",
				label: t.statOptions,
				hint: t.statOptionsHint,
				Icon: Package,
				chip: "bg-info text-action",
			},
			{
				key: "low",
				state: "low",
				label: t.statLow,
				hint: t.statLowHint,
				Icon: AlertTriangle,
				chip: "bg-warning-surface text-warning",
			},
			{
				key: "zero",
				state: "zero",
				label: t.statZero,
				hint: t.statZeroHint,
				Icon: PackageX,
				chip: "bg-danger-surface text-danger",
			},
			{
				key: "expiring",
				state: "expiring",
				label: t.statExpiring,
				hint: t.statExpiringHint,
				Icon: Clock,
				chip: "bg-chip-accent-bg text-chip-accent",
			},
		] as const;
	return (
		<div className="grid grid-cols-2 gap-3 desktop:grid-cols-4 desktop:gap-4">
			{items.map(({ key, state, label, Icon: ItemIcon, chip }) => (
				<Link
					key={key}
					href={href("inventory", { state, page: "1" })}
					className="group min-w-0 rounded-2xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
				>
					<Card className="h-full gap-0 rounded-2xl border-border bg-surface p-4 shadow-xs transition-shadow duration-150 group-hover:shadow-md motion-reduce:transition-none desktop:p-5">
						<div className="flex items-start justify-between gap-2">
							<span className="text-xs font-medium text-muted">{label}</span>
							<span
								className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${chip}`}
							>
								<ItemIcon className="size-4" aria-hidden="true" />
							</span>
						</div>
						<bdi className="mt-2 text-kpi font-bold tabular-nums text-foreground">
							{numberFormat.format(counts[key] ?? 0)}
						</bdi>
					</Card>
				</Link>
			))}
		</div>
	);
}
