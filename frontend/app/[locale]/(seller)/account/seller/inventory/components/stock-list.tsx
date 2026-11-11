"use client";
import { History, Info, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "../../../../../../../components/shadcn/button";
import { Card } from "../../../../../../../components/shadcn/card";
import { Input } from "../../../../../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../../../../../components/shadcn/native-select";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import type {
	StockOverview,
	StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import {
	sellerHref,
	type QueryReader,
	type InventoryScreen,
} from "../../../../../../../lib/routes/account-routes";
import { SellerOverview } from "../../components/seller-overview";
import { StockBadge, StockRowActions } from "./stock-parts";
import { StockPagination, StockSummary, stockHref } from "./stock-ui";
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
	const t = inventoryCopy[locale];
	const copy = sellerInventoryCopy[locale];
	const filterId = useId();
	const href = (route: string, changes: Record<string, string> = {}) =>
		screen === "overview"
			? sellerHref(locale, route, seller, params, changes)
			: stockHref(locale, route, seller, params, changes);
	const states = [
		"unconfigured",
		"inactive",
		"zero",
		"low",
		"available",
		"expired",
		"expiring",
		"held",
	] as const;
	const state = params.get("state") ?? "";
	const sort = params.get("sort") ?? "sku";
	const appliedQuery = params.get("q") ?? "";
	const sortOptions = [
		{ value: "sku", label: `${t.sku} ↑` },
		{ value: "-sku", label: `${t.sku} ↓` },
		{ value: "available", label: `${t.available} ↑` },
		{ value: "-available", label: `${t.available} ↓` },
	];
	const activeState = states.find((value) => value === state);
	const numberFormat = new Intl.NumberFormat(locale);
	const write = overview.capabilities.write;
	const tabStates = ["", "low", "zero", "expiring"];
	const [showFilters, setShowFilters] = useState(
		Boolean(
			(activeState && !tabStates.includes(activeState)) || sort !== "sku",
		),
	);
	const clearFilters = () => {
		setQuery("");
		change({ q: "", state: "", sort: "", page: "1" });
	};
	const tabs: { value: string; label: string; count?: number }[] = [
		{ value: "", label: copy.tabAll, count: overview.counts.variants },
		{ value: "low", label: t.statLow, count: overview.counts.low },
		{ value: "zero", label: t.statZero, count: overview.counts.zero },
		{
			value: "expiring",
			label: t.statExpiring,
			count: overview.counts.expiring,
		},
	];
	if (activeState && !tabStates.includes(activeState))
		tabs.push({
			value: activeState,
			label: t[activeState],
			count: overview.counts[activeState],
		});
	const quantity = (
		position: StockPosition,
		value: string | null,
		strong = false,
	) => (
		<span
			className={`tabular-nums wrap-anywhere ${strong ? "font-semibold text-foreground" : "text-muted"}`}
		>
			<bdi dir={value === null ? "auto" : "ltr"}>{value ?? t.unknown}</bdi>{" "}
			<span className="text-xs font-normal text-muted">
				{position.unit_labels[locale] ?? position.unit}
			</span>
		</span>
	);
	const tracking = (position: StockPosition) =>
		position.tracking
			? position.tracking === "batch"
				? t.batchMode
				: t.plain
			: t.unconfigured;
	const filtersActive = Boolean(appliedQuery || activeState || sort !== "sku");
	const th =
		"border-b border-border px-4 py-3 text-start text-xs font-semibold text-muted wrap-anywhere";
	const noOptions = overview.counts.variants === 0 && !appliedQuery.trim();
	const pageOutOfRange = overview.count > 0 && overview.results.length === 0;
	return (
		<>
			{screen === "overview" && (
				<SellerOverview
					locale={locale}
					seller={seller}
					overview={overview}
					href={href}
				/>
			)}
			{screen === "inventory" && (
				<>
					<div className="space-y-3">
						<StockSummary
							locale={locale}
							counts={overview.counts}
							href={href}
						/>
						<p className="m-0 text-caption leading-relaxed text-muted">
							{t.scope}
						</p>
					</div>
					<Card className="gap-0 overflow-hidden rounded-2xl border-border bg-surface py-0 shadow-xs">
						<div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-5 desktop:px-6">
							<div className="min-w-0">
								<h2 className="m-0 text-base font-semibold text-foreground">
									{copy.stockWorkspace}
								</h2>
								<p className="m-0 mt-1 text-xs text-muted">
									{copy.stockWorkspaceHelp}
								</p>
							</div>
							<Button
								asChild
								variant="outline"
								size="sm"
								className="h-9 rounded-lg text-xs font-semibold"
							>
								<Link href={href("inventory/movements")}>
									<History className="size-4" aria-hidden="true" />
									{t.movements}
								</Link>
							</Button>
						</div>
						<div className="mt-4 flex flex-col gap-3 border-b border-border px-4 pb-4 desktop:flex-row desktop:items-center desktop:justify-between desktop:px-6">
							<nav
								aria-label={t.filter}
								className="flex flex-wrap items-center gap-1"
							>
								{tabs.map((tab) => {
									const selected = state === tab.value;
									return (
										<Link
											key={tab.value || "all"}
											href={href("inventory", { state: tab.value, page: "1" })}
											aria-current={selected ? "page" : undefined}
											className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs no-underline transition-colors duration-150 motion-reduce:transition-none ${selected ? "bg-info font-semibold text-action" : "font-medium text-muted hover:bg-page hover:text-foreground"}`}
										>
											{tab.label}
											{typeof tab.count === "number" && (
												<bdi className="text-[10px] tabular-nums opacity-70">
													{numberFormat.format(tab.count)}
												</bdi>
											)}
										</Link>
									);
								})}
							</nav>
							<div className="flex items-center gap-2">
								<form
									aria-label={t.search}
									onSubmit={(event) => {
										event.preventDefault();
										change({ q: query, page: "1" });
									}}
									className="relative min-w-0 flex-1 desktop:w-60 desktop:flex-none"
								>
									<label htmlFor={`${filterId}-q`} className="sr-only">
										{t.search}
									</label>
									<Search
										className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
										aria-hidden="true"
									/>
									<Input
										id={`${filterId}-q`}
										name="q"
										type="search"
										value={query}
										maxLength={100}
										placeholder={t.search}
										onChange={(event) => setQuery(event.target.value)}
										className="h-9 rounded-lg ps-9 text-sm"
									/>
									<button type="submit" className="sr-only">
										{t.filters}
									</button>
								</form>
								<Button
									type="button"
									variant="outline"
									size="sm"
									aria-expanded={showFilters}
									aria-controls={`${filterId}-advanced`}
									aria-label={copy.advancedFilters}
									title={copy.advancedFilters}
									onClick={() => setShowFilters((value) => !value)}
									className={`h-9 shrink-0 rounded-lg text-xs font-semibold ${showFilters ? "bg-info text-action" : ""}`}
								>
									<SlidersHorizontal className="size-4" aria-hidden="true" />
									<span className="hidden sm:inline">
										{copy.advancedFilters}
									</span>
								</Button>
							</div>
						</div>
						{showFilters && (
							<div
								id={`${filterId}-advanced`}
								className="grid gap-3 border-b border-border bg-page/60 px-4 py-4 desktop:grid-cols-2 desktop:px-6"
							>
								<div className="min-w-0 space-y-1.5">
									<label
										htmlFor={`${filterId}-state`}
										className="block text-xs font-medium text-muted"
									>
										{t.filter}
									</label>
									<NativeSelect
										id={`${filterId}-state`}
										name="state"
										value={state}
										onChange={(event) =>
											change({ state: event.target.value, page: "1" })
										}
										className="rounded-lg"
									>
										<NativeSelectOption value="">{t.all}</NativeSelectOption>
										{states.map((value) => (
											<NativeSelectOption key={value} value={value}>
												{t[value]}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</div>
								<div className="min-w-0 space-y-1.5">
									<label
										htmlFor={`${filterId}-sort`}
										className="block text-xs font-medium text-muted"
									>
										{t.sort}
									</label>
									<NativeSelect
										id={`${filterId}-sort`}
										name="sort"
										value={sort}
										onChange={(event) =>
											change({ sort: event.target.value, page: "1" })
										}
										className="rounded-lg"
									>
										{sortOptions.map((option) => (
											<NativeSelectOption
												key={option.value}
												value={option.value}
											>
												{option.label}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</div>
							</div>
						)}
						{filtersActive && (
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5 text-xs text-muted desktop:px-6">
								<span aria-live="polite" aria-atomic="true">
									{copy.results}:{" "}
									<bdi className="font-semibold tabular-nums text-foreground">
										{numberFormat.format(overview.count)}
									</bdi>
								</span>
								{activeState && (
									<span>
										{t.filter}:{" "}
										<span className="font-medium text-foreground">
											{t[activeState]}
										</span>
									</span>
								)}
								{sort !== "sku" && (
									<span>
										{t.sort}:{" "}
										<span className="font-medium text-foreground">
											{sortOptions.find((option) => option.value === sort)
												?.label ?? sort}
										</span>
									</span>
								)}
								{appliedQuery && (
									<span className="min-w-0 wrap-anywhere">
										{t.search}:{" "}
										<bdi className="font-medium text-foreground">
											{appliedQuery}
										</bdi>
									</span>
								)}
								<button
									type="button"
									onClick={clearFilters}
									className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-action hover:underline"
								>
									{copy.clear}
								</button>
							</div>
						)}
						{!overview.results.length ? (
							<div className="px-4 py-6 desktop:px-6">
								<EmptyState
									borderless
									icon={noOptions ? "warehouse" : "search"}
									title={
										pageOutOfRange
											? copy.pageOutOfRange
											: noOptions
												? copy.noOptions
												: copy.noMatches
									}
									description={
										pageOutOfRange
											? copy.pageOutOfRangeHelp
											: noOptions
												? write
													? copy.noOptionsHelp
													: t.readOnly
												: copy.noMatchesHelp
									}
									action={
										pageOutOfRange ? (
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => change({ page: "1" })}
												className="h-9 rounded-lg text-xs font-semibold"
											>
												{copy.firstPage}
											</Button>
										) : noOptions ? (
											write ? (
												<Button
													asChild
													variant="outline"
													size="sm"
													className="h-9 rounded-lg text-xs font-semibold"
												>
													<Link href={href("catalogue")}>{t.products}</Link>
												</Button>
											) : undefined
										) : (
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={clearFilters}
												className="h-9 rounded-lg text-xs font-semibold"
											>
												{copy.clear}
											</Button>
										)
									}
								/>
							</div>
						) : (
							<>
								<section
									// biome-ignore lint/a11y/noNoninteractiveTabindex: Named overflow region allows keyboard access to every stock column.
									tabIndex={0}
									aria-label={t.inventory}
									className="hidden min-w-0 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary desktop:block"
								>
									<table className="w-full min-w-[52rem] border-collapse text-start text-sm">
										<caption className="sr-only">{t.inventory}</caption>
										<thead>
											<tr className="bg-page">
												<th
													scope="col"
													aria-sort={
														!sort.includes("available")
															? sort.startsWith("-")
																? "descending"
																: "ascending"
															: undefined
													}
													className={`${th} ps-6`}
												>
													{copy.options}
												</th>
												<th
													scope="col"
													aria-sort={
														sort.includes("available")
															? sort.startsWith("-")
																? "descending"
																: "ascending"
															: undefined
													}
													className={th}
												>
													<span className="inline-flex items-center gap-1">
														{t.available}
														<span title={t.availableHelp}>
															<Info
																className="size-3.5 text-muted"
																aria-hidden="true"
															/>
														</span>
													</span>
												</th>
												<th scope="col" className={th}>
													{t.held}
												</th>
												<th scope="col" className={th}>
													{t.totalStock}
												</th>
												<th scope="col" className={th}>
													{t.filter}
												</th>
												<th scope="col" className={`${th} pe-6 text-end`}>
													{t.action}
												</th>
											</tr>
										</thead>
										<tbody>
											{overview.results.map((position) => (
												<tr
													key={position.id}
													className="border-b border-border transition-colors duration-150 last:border-0 hover:bg-page/60 motion-reduce:transition-none"
												>
													<td className="px-4 py-4 align-middle ps-6">
														<Link
															href={href(`inventory/${position.id}`)}
															className="font-semibold text-foreground no-underline wrap-anywhere hover:text-action"
														>
															<bdi>{position.title}</bdi>
														</Link>
														<p className="m-0 mt-1 text-xs text-muted">
															<bdi>{position.sku}</bdi>
														</p>
													</td>
													<td className="px-4 py-4 align-middle">
														{quantity(position, position.available, true)}
													</td>
													<td className="px-4 py-4 align-middle">
														{quantity(position, position.held)}
													</td>
													<td className="px-4 py-4 align-middle">
														{quantity(position, position.physical)}
													</td>
													<td className="px-4 py-4 align-middle">
														<StockBadge
															locale={locale}
															state={position.state}
														/>
													</td>
													<td className="px-4 py-4 align-middle pe-6">
														<StockRowActions
															locale={locale}
															position={position}
															write={write && position.capabilities.write}
															href={href}
														/>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</section>
								<ul className="m-0 min-w-0 list-none space-y-3 p-4 desktop:hidden">
									{overview.results.map((position) => (
										<li
											key={position.id}
											className="min-w-0 rounded-xl border border-border bg-surface p-4"
										>
											<div className="flex min-w-0 items-start justify-between gap-3">
												<div className="min-w-0">
													<h3 className="m-0 text-sm font-semibold leading-snug wrap-anywhere">
														<Link
															href={href(`inventory/${position.id}`)}
															className="text-foreground no-underline hover:text-action"
														>
															<bdi>{position.title}</bdi>
														</Link>
													</h3>
													<p className="m-0 mt-1 text-xs text-muted wrap-anywhere">
														{t.sku}: <bdi>{position.sku}</bdi>
													</p>
												</div>
												<StockBadge locale={locale} state={position.state} />
											</div>
											<dl className="m-0 mt-3 grid min-w-0 grid-cols-3 gap-2 rounded-xl bg-page p-3">
												{[
													{
														label: t.available,
														value: position.available,
														strong: true,
													},
													{
														label: t.held,
														value: position.held,
														strong: false,
													},
													{
														label: t.totalStock,
														value: position.physical,
														strong: false,
													},
												].map((balance) => (
													<div key={balance.label} className="min-w-0">
														<dt className="text-[11px] text-muted wrap-anywhere">
															{balance.label}
														</dt>
														<dd className="m-0 mt-1 text-sm">
															{quantity(
																position,
																balance.value,
																balance.strong,
															)}
														</dd>
													</div>
												))}
											</dl>
											<div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
												<span className="min-w-0 text-xs text-muted wrap-anywhere">
													{t.unit}:{" "}
													{position.unit_labels[locale] ?? position.unit} ·{" "}
													{tracking(position)}
												</span>
												<StockRowActions
													locale={locale}
													position={position}
													write={write && position.capabilities.write}
													href={href}
												/>
											</div>
										</li>
									))}
								</ul>
							</>
						)}
						{overview.results.length > 0 && (
							<div className="px-4 pb-4 desktop:px-6">
								<StockPagination
									locale={locale}
									page={overview.page}
									count={overview.count}
									size={overview.page_size}
									href={(page) => href("inventory", { page: String(page) })}
									onPage={(page) => change({ page: String(page) })}
								/>
							</div>
						)}
					</Card>
					<p className="m-0 flex items-start gap-2 text-caption leading-relaxed text-muted">
						<Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span>{t.stockMeaning}</span>
					</p>
				</>
			)}
		</>
	);
}
