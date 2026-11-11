"use client";
import {
	ArrowLeft,
	PackagePlus,
	Settings2,
	SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { Button } from "../../../../../../../components/shadcn/button";
import { Alert } from "../../../../../../../components/ui/alert";
import type {
	StockHistory,
	StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { stockFlowCopy } from "../../../../../../../lib/i18n/stock-flow";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import type { QueryReader } from "../../../../../../../lib/routes/account-routes";
import { MovementTable, StockBadge, panel } from "./stock-parts";
import { StockPagination, stockHref } from "./stock-ui";

export function StockDetail({
	locale,
	seller,
	position,
	batch,
	history,
	params,
	onPage,
}: {
	locale: Locale;
	seller: string;
	position: StockPosition;
	batch?: string;
	history: StockHistory | null;
	params: QueryReader;
	onPage: (page: number) => void;
}) {
	const t = inventoryCopy[locale],
		flow = stockFlowCopy[locale];
	const selected = batch
		? position.batches?.find((row) => row.id === batch)
		: null;
	if (batch && !selected) return <Alert>{t.notFound}</Alert>;
	const stock = selected ?? position,
		unit = position.unit_labels[locale] ?? position.unit;
	const href = (path: string, changes: Record<string, string> = {}) =>
		stockHref(locale, path, seller, params, changes);
	const selection = { selected_batch: selected?.id ?? "" };
	const actions = [
		{
			path: position.configured ? "receipts/new" : "settings",
			label: position.configured ? t.receipt : t.setupStock,
			Icon: PackagePlus,
		},
		...(position.configured
			? [
					{
						path: "adjustments/new",
						label: flow.count,
						Icon: SlidersHorizontal,
					},
					{ path: "settings", label: flow.settings, Icon: Settings2 },
				]
			: []),
	];
	const fmt = (value: string | null) =>
		value === null ? "—" : value.replace(/\.000$/, "");
	return (
		<div className="space-y-5">
			<Link
				className="inline-flex items-center gap-2 text-sm text-muted no-underline"
				href={selected ? href(`inventory/${position.id}`) : href("inventory")}
			>
				<ArrowLeft className="size-4 rtl:rotate-180" />
				{selected ? position.title : t.inventory}
			</Link>
			<section className={`${panel} space-y-5`}>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 className="m-0 text-xl font-semibold">
							{selected ? selected.code : position.title}
						</h2>
						<p className="m-0 mt-1 text-sm text-muted">
							<bdi>{position.sku}</bdi> · {unit}
							{selected?.expires_on ? ` · ${selected.expires_on}` : ""}
						</p>
					</div>
					<StockBadge
						locale={locale}
						state={selected?.expired ? "expired" : position.state}
					/>
				</div>
				<dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
					{[
						[flow.inStock, stock.physical],
						[flow.reserved, stock.held],
						[flow.available, stock.available],
					].map(([label, value]) => (
						<div key={label} className="min-w-0 rounded-xl bg-page p-4">
							<dt className="text-xs text-muted">{label}</dt>
							<dd className="m-0 mt-2 text-2xl font-semibold">
								<bdi>{fmt(value)}</bdi>
								<span className="ms-1 text-sm font-normal text-muted">
									{unit}
								</span>
							</dd>
						</div>
					))}
				</dl>
				{!position.eligible && (
					<p className="m-0 rounded-lg bg-info p-3 text-sm text-muted">
						{flow.unpublished}
					</p>
				)}
				{position.capabilities.write && (
					<div className="flex flex-wrap gap-2">
						{actions
							.filter(
								(action) =>
									!(selected?.expired && action.path === "receipts/new"),
							)
							.map(({ path, label, Icon }, i) => (
								<Button
									key={path}
									asChild
									variant={i === 0 ? "default" : "outline"}
									className="rounded-lg"
								>
									<Link
										href={href(`inventory/${position.id}/${path}`, selection)}
									>
										<Icon className="size-4" />
										{label}
									</Link>
								</Button>
							))}
					</div>
				)}
			</section>
			{!!position.batches?.length && !selected && (
				<section className={panel}>
					<h3 className="m-0 mb-4 text-base font-semibold">
						{flow.existingDelivery}
					</h3>
					<div className="divide-y divide-border">
						{position.batches.map((row) => (
							<Link
								key={row.id}
								href={href(`inventory/${position.id}/batches/${row.id}`, {
									page: "1",
								})}
								className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-foreground no-underline hover:text-action"
							>
								<span>
									<bdi>{row.code}</bdi>
									{row.expires_on && (
										<span className="ms-3 text-xs text-muted">
											{row.expires_on}
										</span>
									)}
								</span>
								<span>
									<bdi>{fmt(row.physical)}</bdi> {unit}
								</span>
							</Link>
						))}
					</div>
				</section>
			)}
			<details className={panel}>
				<summary className="cursor-pointer text-sm font-semibold">
					{flow.details}
				</summary>
				<dl className="m-0 mt-4 grid gap-4 text-sm sm:grid-cols-2">
					{[
						[
							flow.threshold,
							position.threshold === null
								? "—"
								: `${fmt(position.threshold)} ${unit}`,
						],
						[flow.increment, `${fmt(position.increment)} ${unit}`],
						[
							flow.options,
							position.tracking === "batch" ? flow.separate : flow.simple,
						],
						...(position.expired !== "0.000"
							? [[t.expired, `${fmt(position.expired)} ${unit}`]]
							: []),
					].map(([label, value]) => (
						<div key={label}>
							<dt className="text-xs text-muted">{label}</dt>
							<dd className="m-0 mt-1">{value}</dd>
						</div>
					))}
				</dl>
			</details>
			{selected && history && history.count > 0 && (
				<details className={panel}>
					<summary className="cursor-pointer text-sm font-semibold">
						{flow.history}
					</summary>
					<div className="mt-4">
						<MovementTable
							locale={locale}
							seller={seller}
							rows={history.results}
							compact
						/>
						<StockPagination
							locale={locale}
							page={history.page}
							count={history.count}
							size={history.page_size}
							href={(page) =>
								href(`inventory/${position.id}/batches/${selected.id}`, {
									page: String(page),
								})
							}
							onPage={onPage}
						/>
					</div>
				</details>
			)}
		</div>
	);
}
