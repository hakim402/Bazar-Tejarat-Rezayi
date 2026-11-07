"use client";
import { Pagination } from "../../../../../../../features/inventory/components/pagination";
import Link from "next/link";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import {
	Field,
	Input,
	Select,
} from "../../../../../../../components/ui/form-field";
import { Button } from "../../../../../../../components/ui/button";
import {
	sellerHref,
	type QueryReader,
	type InventoryScreen,
} from "../../../../../../../lib/routes/account-routes";
import type { StockOverview } from "../../../../../../../features/inventory/api/inventory";
import { MovementTable, panel, linkClass } from "./stock-parts";
import { StatCard } from "../../../../../../../components/ui/stat-card";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { PageHeader } from "../../../../../../../components/ui/page-header";
import { SectionCard } from "../../../../../../../components/ui/section-card";
import { Icon } from "../../../../../../../components/ui/icon";
export function StockList({
	locale,
	seller,
	screen,
	overview,
	params,
	query,
	setQuery,
	change,
}: {
	locale: Locale;
	seller: string;
	screen: InventoryScreen;
	overview: StockOverview;
	params: QueryReader;
	query: string;
	setQuery: (value: string) => void;
	change: (values: Record<string, string>) => void;
}) {
	const t = inventoryCopy[locale],
		href = (route: string, changes: Record<string, string> = {}) =>
			sellerHref(locale, route, seller, params, changes);
	const states = [
		"unconfigured",
		"inactive",
		"zero",
		"low",
		"available",
		"expired",
		"held",
	] as const;

	const kpiCards = [
		{ key: "variants", label: t.count, icon: "box" as const, chip: "info" as const },
		{ key: "unconfigured", label: t.unconfigured, icon: "help" as const, chip: "neutral" as const },
		{ key: "zero", label: t.zero, icon: "close" as const, chip: "danger" as const },
		{ key: "low", label: t.low, icon: "trending-down" as const, chip: "warning" as const },
		{ key: "expired", label: t.expired, icon: "clock" as const, chip: "danger" as const },
		{ key: "held", label: t.held, icon: "lock" as const, chip: "info" as const },
		{ key: "inactive", label: t.inactive, icon: "eye" as const, chip: "neutral" as const },
	];

	return (
		<>
			{screen === "overview" && (
				<>
					{/* KPI Grid */}
					<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{kpiCards.map(({ key, label, icon, chip }) => (
							<StatCard
								key={key}
								icon={icon}
								chip={chip}
								label={label}
								value={overview.counts[key] ?? 0}
								href={href("inventory", {
									state: key === "variants" ? "" : key,
									page: "1",
								})}
							/>
						))}
					</section>

					{/* Catalogue + Recent Movements + Quick Actions */}
					<div className="grid gap-6 lg:grid-cols-3">
						{/* Catalogue Products */}
						<SectionCard title={t.catalogueProducts} className="lg:col-span-1">
							<div className="flex items-center justify-between">
								<p className="text-kpi font-bold tabular-nums">
									<bdi>{overview.catalogue_count}</bdi>
								</p>
								{overview.capabilities.write && (
									<Link
										href={href("catalogue")}
										className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-caption font-semibold text-action no-underline transition-colors hover:bg-info"
									>
										<Icon name="plus" className="size-4" />
										{t.addProduct}
									</Link>
								)}
							</div>
							{overview.catalogue_count === 0 && (
								<p className="mt-3 text-caption text-muted">
									{t.emptyProductsDesc}
								</p>
							)}
						</SectionCard>

						{/* Recent Movements */}
						<SectionCard title={t.recentMovements} className="lg:col-span-2">
							{overview.recent.length > 0 ? (
								<MovementTable
									locale={locale}
									seller={seller}
									rows={overview.recent}
								/>
							) : (
								<EmptyState
									icon="clock"
									title={t.emptyMovements}
									description={t.emptyMovementsDesc}
									action={
										<Link
											href={href("inventory")}
											className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 py-2 text-body font-semibold text-on-primary no-underline transition-colors hover:brightness-95"
										>
											{t.viewInventory}
										</Link>
									}
								/>
							)}
						</SectionCard>
					</div>
				</>
			)}

			{screen === "inventory" && (
				<>
					<PageHeader title={t.inventory} description={t.scope} />
					<section className={panel}>
						<form
							className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4"
							onSubmit={(e) => {
								e.preventDefault();
								change({ q: query, page: "1" });
							}}
						>
							<Field name="q" label={t.search}>
								<Input
									name="q"
									type="search"
									value={query}
									maxLength={100}
									onChange={(e) => setQuery(e.target.value)}
								/>
							</Field>
							<Field name="state" label={t.filter}>
								<Select
									name="state"
									value={params.get("state") ?? ""}
									onChange={(e) => change({ state: e.target.value, page: "1" })}
								>
									<option value="">{t.all}</option>
									{states.map((x) => (
										<option key={x} value={x}>
											{t[x]}
										</option>
									))}
								</Select>
							</Field>
							<Field name="sort" label={t.sort}>
								<Select
									name="sort"
									value={params.get("sort") ?? "sku"}
									onChange={(e) => change({ sort: e.target.value, page: "1" })}
								>
									<option value="sku">{t.sku} ↑</option>
									<option value="-sku">{t.sku} ↓</option>
									<option value="available">{t.available} ↑</option>
									<option value="-available">{t.available} ↓</option>
								</Select>
							</Field>
							<Button type="submit">{t.filters}</Button>
						</form>
						<p className="mt-4 text-xs text-muted desktop:hidden">
							{t.tableHint}
						</p>
						<section
							aria-label={t.inventory}
							tabIndex={0}
							className="mt-5 overflow-x-auto"
						>
							<table className="w-full min-w-[38rem] text-start text-sm">
								<caption className="sr-only">{t.inventory}</caption>
								<thead>
									<tr>
										{[
											t.products,
											t.filter,
											t.available,
											t.held,
											t.expired,
											t.tracking,
											...(overview.capabilities.write ? [t.action] : []),
										].map((label) => (
											<th
												scope="col"
												aria-sort={
													label ===
													((params.get("sort") ?? "sku").includes("available")
														? t.available
														: t.products)
														? (params.get("sort") ?? "sku").startsWith("-")
															? "descending"
															: "ascending"
														: undefined
												}
												className="border-b border-border p-3 text-start"
												key={label}
											>
												{label}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{overview.results.map((r) => (
										<tr key={r.id} className="border-b border-border last:border-0">
											<td className="max-w-64 border-b border-border p-3 wrap-anywhere">
												<Link href={href(`inventory/${r.id}`)}>{r.title}</Link>
												<p className="mt-1 text-xs text-muted">
													<bdi>{r.sku}</bdi>
												</p>
											</td>
											<td className="border-b border-border p-3">
												{t[r.state as (typeof states)[number]] ?? r.state}
											</td>
											<td className="border-b border-border p-3">
												<bdi>{r.available ?? t.unknown}</bdi>{" "}
												{r.unit_labels[locale] ?? r.unit}
											</td>
											<td className="border-b border-border p-3">
												<bdi>{r.held}</bdi>
											</td>
											<td className="border-b border-border p-3">
												<bdi>{r.expired}</bdi>
											</td>
											<td className="border-b border-border p-3">
												{r.tracking
													? r.tracking === "batch"
														? t.batchMode
														: t.plain
													: t.unconfigured}
											</td>
											{r.capabilities.write && (
												<td className="border-b border-border p-3">
													<Link
														className={linkClass}
														href={href(
															`inventory/${r.id}/${r.configured ? "receipts/new" : "settings"}`,
														)}
													>
														{r.configured ? t.receipt : t.settings}
													</Link>
												</td>
											)}
										</tr>
									))}
								</tbody>
							</table>
						</section>
						{!overview.results.length && (
							<EmptyState
								icon="inbox"
								title={t.emptyInventory}
								description={t.emptyInventoryDesc}
								action={
									overview.capabilities.write ? (
										<Link
											href={href("catalogue")}
											className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 py-2 text-body font-semibold text-on-primary no-underline transition-colors hover:brightness-95"
										>
											{t.configureInventory}
										</Link>
									) : undefined
								}
							/>
						)}
						<Pagination
							locale={locale}
							page={overview.page}
							count={overview.count}
							size={overview.page_size}
							onPage={(page) => change({ page: String(page) })}
						/>
					</section>
				</>
			)}
		</>
	);
}
