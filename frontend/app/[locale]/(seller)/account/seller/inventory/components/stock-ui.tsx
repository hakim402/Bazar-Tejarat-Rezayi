import Link from "next/link";
import { DashboardCard } from "../../../../../../../components/ui/dashboard-card";
import { Icon } from "../../../../../../../components/ui/icon";
import type { StockOverview } from "../../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../../lib/i18n/locales";
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
) {
	if (!path.startsWith("inventory")) return sellerHref(locale, path, seller);
	const next = new URLSearchParams({ seller });
	const movement = path === "inventory/movements";
	for (const key of movement ? historyKeys : inventoryKeys) {
		const value = params?.get(
			movement && params.get("history") === "1" ? `history_${key}` : key,
		);
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
