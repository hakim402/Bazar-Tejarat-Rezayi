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
	return (
		<>
			<section className={panel}>
				<h1 className="text-2xl font-bold">{t[screen]}</h1>
				<p className="mt-3 max-w-3xl text-sm text-muted">{t.scope}</p>
				<div className="mt-4 flex flex-wrap gap-3">
					<Link
						className={linkClass}
						href={href("inventory", { state: "", page: "1" })}
					>
						{t.inventory}
					</Link>
					{overview.capabilities.write && (
						<Link className={linkClass} href={href("catalogue")}>
							{t.products}
						</Link>
					)}
					<Link
						className={linkClass}
						href={sellerHref(locale, "inventory/movements", seller)}
					>
						{t.movements}
					</Link>
				</div>
			</section>
			<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{[
					["variants", t.count],
					["unconfigured", t.unconfigured],
					["zero", t.zero],
					["low", t.low],
					["expired", t.expired],
					["held", t.held],
					["inactive", t.inactive],
				].map(([key, label]) => (
					<Link
						key={key}
						className={`${panel} text-foreground no-underline hover:border-action`}
						href={href("inventory", {
							state: key === "variants" ? "" : key,
							page: "1",
						})}
					>
						<h2 className="text-sm text-muted">{label}</h2>
						<p className="mt-2 text-3xl font-bold">
							<bdi>{overview.counts[key] ?? 0}</bdi>
						</p>
					</Link>
				))}
			</section>
			{screen === "inventory" && (
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
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard scrolling for stock table.
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
									<tr key={r.id}>
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
						<p className="py-5 text-muted">{t.empty}</p>
					)}
					<Pagination
						locale={locale}
						page={overview.page}
						count={overview.count}
						size={overview.page_size}
						onPage={(page) => change({ page: String(page) })}
					/>
				</section>
			)}
			{screen === "overview" && (
				<section className={panel}>
					<h2 className="text-lg font-bold">
						{t.catalogue}: <bdi>{overview.catalogue_count}</bdi>
					</h2>
					<h2 className="mt-5 text-lg font-bold">{t.recent}</h2>
					<MovementTable
						locale={locale}
						seller={seller}
						rows={overview.recent}
					/>
				</section>
			)}
		</>
	);
}
