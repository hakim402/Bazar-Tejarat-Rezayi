"use client";
import Link from "next/link";
import { useId } from "react";
import { Icon } from "../../../../../../../components/ui/icon";
import { Pagination } from "../../../../../../../features/inventory/components/pagination";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import {
	sellerHref,
	type QueryReader,
	type InventoryScreen,
} from "../../../../../../../lib/routes/account-routes";
import type {
	StockOverview,
	StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { panel, linkClass } from "./stock-parts";
import { SellerOverview } from "../../components/seller-overview";
import { SellerSelect } from "../../components/seller-select";
import { StockGlance, stockHref } from "./stock-ui";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { StatusBadge } from "../../../../../../../components/ui/status-badge";
import {
	DataTable,
	type Column,
} from "../../../../../../../components/ui/data-table";
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
		"held",
	] as const;
	const stateVariants = {
		unconfigured: "info",
		inactive: "neutral",
		zero: "danger",
		low: "warning",
		available: "success",
		expired: "danger",
		held: "info",
	} as const;
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
	const canClear = Boolean(
		query || appliedQuery || state || sort !== "sku" || overview.page > 1,
	);
	const clearFilters = () => {
		setQuery("");
		change({ q: "", state: "", sort: "", page: "1" });
	};
	const actionClass = `${linkClass} min-w-11 gap-2 text-center wrap-anywhere transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none`;
	const stockBadge = (position: StockPosition) => {
		const value = states.find((item) => item === position.state);
		return (
			<StatusBadge variant={value ? stateVariants[value] : "neutral"}>
				{value ? t[value] : position.state}
			</StatusBadge>
		);
	};
	const quantity = (position: StockPosition, value: string | null) => (
		<span className="tabular-nums wrap-anywhere">
			<bdi dir={value === null ? "auto" : "ltr"}>{value ?? t.unknown}</bdi>{" "}
			<span className="font-normal">
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
	const stockAction = (position: StockPosition) =>
		overview.capabilities.write && position.capabilities.write ? (
			<Link
				className={actionClass}
				href={href(
					`inventory/${position.id}/${position.configured ? "receipts/new" : "settings"}`,
				)}
			>
				<Icon
					name={position.configured ? "box" : "sliders"}
					className="size-4 shrink-0"
				/>
				{position.configured ? t.receipt : t.settings}
			</Link>
		) : null;
	const columns: Column<StockPosition>[] = [
		{
			header: t.products,
			ariaSort: !sort.includes("available")
				? sort.startsWith("-")
					? "descending"
					: "ascending"
				: undefined,
			render: (r) => (
				<>
					<Link
						href={href(`inventory/${r.id}`)}
						className="rounded-sm font-semibold text-action hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
					>
						<bdi>{r.title}</bdi>
					</Link>
					<p className="mt-1 text-caption text-muted">
						<bdi>{r.sku}</bdi>
					</p>
				</>
			),
		},
		{
			header: t.filter,
			render: stockBadge,
		},
		{
			header: t.available,
			ariaSort: sort.includes("available")
				? sort.startsWith("-")
					? "descending"
					: "ascending"
				: undefined,
			render: (r) => quantity(r, r.available),
		},
		{ header: t.held, render: (r) => quantity(r, r.held) },
		{ header: t.expired, render: (r) => quantity(r, r.expired) },
		{
			header: t.tracking,
			render: tracking,
		},
		...(overview.capabilities.write
			? [
					{
						header: t.action,
						render: stockAction,
					},
				]
			: []),
	];
	const noOptions = overview.counts.variants === 0 && !appliedQuery.trim();
	return (
		<>
			{screen === "overview" && (
				<SellerOverview locale={locale} overview={overview} href={href} />
			)}
			{screen === "inventory" && (
				<>
					<div className="space-y-5">
						<StockGlance locale={locale} counts={overview.counts} href={href} />
						<p className="text-caption leading-relaxed text-muted">{t.scope}</p>
					</div>
					<section className={panel}>
						<form
							aria-label={t.filters}
							onSubmit={(event) => {
								event.preventDefault();
								change({ q: query, page: "1" });
							}}
							className="min-w-0 space-y-4"
						>
							<div className="grid min-w-0 grid-cols-1 items-start gap-4 desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
								<div className="min-w-0 space-y-2">
									<label
										htmlFor={`${filterId}-q`}
										className="block text-sm font-semibold text-foreground"
									>
										{t.search}
									</label>
									<div className="relative min-w-0">
										<Icon
											name="search"
											className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
										/>
										<input
											id={`${filterId}-q`}
											name="q"
											type="search"
											value={query}
											maxLength={100}
											aria-describedby={`${filterId}-hint`}
											onChange={(event) => setQuery(event.target.value)}
											className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface py-2 pe-3 ps-10 text-base text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
										/>
									</div>
									<p
										id={`${filterId}-hint`}
										className="text-xs leading-relaxed text-muted wrap-anywhere"
									>
										{copy.searchHint}
									</p>
								</div>
								<div className="min-w-0 space-y-2">
									<label
										htmlFor={`${filterId}-state`}
										className="block text-sm font-semibold text-foreground"
									>
										{t.filter}
									</label>
									<SellerSelect
										id={`${filterId}-state`}
										label={t.filter}
										icon="sliders"
										value={state}
										options={[
											{ value: "", label: t.all },
											...states.map((value) => ({ value, label: t[value] })),
										]}
										onChange={(value) => change({ state: value, page: "1" })}
									/>
								</div>
								<div className="min-w-0 space-y-2">
									<label
										htmlFor={`${filterId}-sort`}
										className="block text-sm font-semibold text-foreground"
									>
										{t.sort}
									</label>
									<SellerSelect
										id={`${filterId}-sort`}
										label={t.sort}
										value={sort}
										options={sortOptions}
										onChange={(value) => change({ sort: value, page: "1" })}
									/>
								</div>
							</div>
							<div className="grid min-w-0 grid-cols-1 gap-3 sm:flex sm:flex-wrap">
								<button
									type="submit"
									className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-sm font-bold text-on-primary wrap-anywhere transition-colors duration-150 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
								>
									<Icon name="search" className="size-4 shrink-0" />
									{t.filters}
								</button>
								<button
									type="button"
									onClick={clearFilters}
									disabled={!canClear}
									className={`${actionClass} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
								>
									{copy.clear}
								</button>
							</div>
						</form>
						<div className="mt-6 min-w-0 border-t border-border pt-5">
							<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
								<h2 className="text-lg font-semibold text-foreground">
									{copy.options}
								</h2>
								<p
									aria-live="polite"
									aria-atomic="true"
									className="text-sm text-muted"
								>
									{copy.results}:{" "}
									<bdi className="font-semibold tabular-nums text-foreground">
										{new Intl.NumberFormat(locale).format(overview.count)}
									</bdi>
								</p>
							</div>
							<dl className="m-0 mt-3 flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm">
								<div className="flex min-w-0 flex-wrap gap-x-2">
									<dt className="text-muted">{t.filter}:</dt>
									<dd className="m-0 min-w-0 font-medium text-foreground wrap-anywhere">
										{activeState ? t[activeState] : state || t.all}
									</dd>
								</div>
								<div className="flex min-w-0 flex-wrap gap-x-2">
									<dt className="text-muted">{t.sort}:</dt>
									<dd className="m-0 min-w-0 font-medium text-foreground wrap-anywhere">
										{sortOptions.find((option) => option.value === sort)
											?.label ?? sort}
									</dd>
								</div>
								{appliedQuery && (
									<div className="flex min-w-0 flex-wrap gap-x-2">
										<dt className="text-muted">{t.search}:</dt>
										<dd className="m-0 min-w-0 font-medium text-foreground wrap-anywhere">
											<bdi>{appliedQuery}</bdi>
										</dd>
									</div>
								)}
							</dl>
							<p className="mt-3 text-caption leading-relaxed text-muted">
								{t.stockMeaning}
							</p>
							{!overview.results.length ? (
								<EmptyState
									borderless
									icon={noOptions ? "warehouse" : "search"}
									title={noOptions ? copy.noOptions : copy.noMatches}
									description={
										noOptions
											? overview.capabilities.write
												? copy.noOptionsHelp
												: t.readOnly
											: copy.noMatchesHelp
									}
									action={
										noOptions ? (
											overview.capabilities.write ? (
												<Link className={actionClass} href={href("catalogue")}>
													{t.products}
												</Link>
											) : undefined
										) : (
											<button
												type="button"
												onClick={clearFilters}
												className={`${actionClass} cursor-pointer`}
											>
												{copy.clear}
											</button>
										)
									}
								/>
							) : (
								<>
									<DataTable
										className="mt-5 hidden desktop:block"
										caption={t.inventory}
										columns={columns}
										rows={overview.results}
									/>
									<ul className="m-0 mt-5 min-w-0 list-none space-y-4 p-0 desktop:hidden">
										{overview.results.map((position) => (
											<li
												key={position.id}
												className="min-w-0 rounded-xl border border-border bg-surface p-4"
											>
												<h3 className="min-w-0 text-base font-semibold leading-relaxed wrap-anywhere">
													<Link
														href={href(`inventory/${position.id}`)}
														className="rounded-sm text-action hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
													>
														<bdi>{position.title}</bdi>
													</Link>
												</h3>
												<p className="mt-1 text-sm text-muted wrap-anywhere">
													{t.sku}:{" "}
													<bdi className="text-foreground">{position.sku}</bdi>
												</p>
												<div className="mt-3">{stockBadge(position)}</div>
												<dl className="m-0 mt-4 grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
													<div className="min-w-0">
														<dt className="text-xs text-muted">{t.unit}</dt>
														<dd className="m-0 mt-1 text-foreground wrap-anywhere">
															{position.unit_labels[locale] ?? position.unit}
														</dd>
													</div>
													<div className="min-w-0">
														<dt className="text-xs text-muted">{t.tracking}</dt>
														<dd className="m-0 mt-1 text-foreground wrap-anywhere">
															{tracking(position)}
														</dd>
													</div>
												</dl>
												<dl className="m-0 mt-4 grid min-w-0 grid-cols-2 gap-3">
													<div className="col-span-2 min-w-0 rounded-xl bg-info p-3">
														<dt className="text-sm text-muted wrap-anywhere">
															{t.available}
														</dt>
														<dd className="m-0 mt-1 text-lg font-semibold text-foreground">
															{quantity(position, position.available)}
														</dd>
													</div>
													{[
														{ label: t.held, value: position.held },
														{ label: t.expired, value: position.expired },
													].map((balance) => (
														<div
															key={balance.label}
															className="min-w-0 rounded-xl bg-page p-3"
														>
															<dt className="text-xs text-muted wrap-anywhere">
																{balance.label}
															</dt>
															<dd className="m-0 mt-1 text-sm font-semibold text-foreground">
																{quantity(position, balance.value)}
															</dd>
														</div>
													))}
												</dl>
												<div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
													<Link
														className={actionClass}
														href={href(`inventory/${position.id}`)}
													>
														<Icon name="eye" className="size-4 shrink-0" />
														{copy.view}
													</Link>
													{stockAction(position)}
												</div>
											</li>
										))}
									</ul>
								</>
							)}
						</div>
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
