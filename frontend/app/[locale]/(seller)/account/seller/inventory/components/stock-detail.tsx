"use client";
import { Pagination } from "../../../../../../../features/inventory/components/pagination";
import Link from "next/link";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { Alert } from "../../../../../../../components/ui/alert";
import {
	sellerHref,
	type QueryReader,
} from "../../../../../../../lib/routes/account-routes";
import type {
	StockPosition,
	StockHistory,
} from "../../../../../../../features/inventory/api/inventory";
import { MovementTable, panel, linkClass } from "./stock-parts";
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
		screen = batch ? "batch" : "detail",
		href = (route: string) => sellerHref(locale, route, seller, params);
	const selectedBatch = batch
		? position.batches?.find((b) => b.id === batch)
		: null;
	if (batch && !selectedBatch) return <Alert>{t.unavailable}</Alert>;
	const snapshot = selectedBatch ?? position,
		unit = position.unit_labels[locale] ?? position.unit;
	return (
		<>
			<section className={panel}>
				<nav className="mb-4 flex flex-wrap gap-3 text-sm">
					<Link href={href("inventory")}>{t.inventory}</Link>
					<span>/</span>
					<span>{t[screen]}</span>
				</nav>
				<h1 className="text-2xl font-bold wrap-anywhere">
					{selectedBatch?.code ?? position.title}
				</h1>
				<p className="mt-2 text-muted">
					<bdi>{position.sku}</bdi> · {unit} ·{" "}
					{position.eligible ? t.eligible : t.blocked}
				</p>
				{position.capabilities.write && (
					<Link href={href(`catalogue/${position.product}`)}>{t.products}</Link>
				)}
				<div className="mt-5 flex flex-wrap gap-3">
					{position.capabilities.write && (
						<>
							<Link
								className={linkClass}
								href={href(`inventory/${position.id}/settings`)}
							>
								{t.settings}
							</Link>
							{position.configured && (
								<>
									<Link
										className={linkClass}
										href={href(`inventory/${position.id}/receipts/new`)}
									>
										{t.receipt}
									</Link>
									<Link
										className={linkClass}
										href={href(`inventory/${position.id}/adjustments/new`)}
									>
										{t.adjustment}
									</Link>
								</>
							)}
						</>
					)}
				</div>
			</section>
			<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{[
					[t.physical, snapshot.physical],
					[t.held, snapshot.held],
					[t.available, snapshot.available ?? t.unknown],
					[
						t.expired,
						selectedBatch
							? selectedBatch.expired
								? selectedBatch.physical
								: "0.000"
							: position.expired,
					],
				].map(([label, value]) => (
					<div key={label} className={panel}>
						<h2 className="text-sm text-muted">{label}</h2>
						<p
							className={`mt-3 wrap-anywhere font-bold ${String(value).length > 12 ? "text-xl" : "text-2xl"}`}
						>
							<bdi dir="ltr">{value}</bdi>{" "}
							<span className="text-sm font-normal">{unit}</span>
						</p>
					</div>
				))}
			</section>
			<section className={panel}>
				<p className="mb-4 text-sm text-muted">{t.stockMeaning}</p>
				<h2 className="text-lg font-bold">{t.tracking}</h2>
				<p className="mt-2">
					{!position.configured
						? t.unconfigured
						: position.tracking === "batch"
							? t.batchMode
							: t.plain}
				</p>
				{selectedBatch && (
					<p>
						{t.expires}: <bdi>{selectedBatch.expires_on ?? t.unknown}</bdi>{" "}
						{selectedBatch.expired && t.expired}
					</p>
				)}
				{!batch &&
					position.batches?.map((b) => (
						<div
							key={b.id}
							className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
						>
							<div>
								<Link
									href={sellerHref(
										locale,
										`inventory/${position.id}/batches/${b.id}`,
										seller,
										params,
										{ page: "" },
									)}
								>
									<bdi>{b.code}</bdi>
								</Link>
								<p className="text-sm text-muted">
									{t.expires}: <bdi>{b.expires_on ?? t.unknown}</bdi>
									{b.expired ? ` · ${t.expired}` : ""}
								</p>
							</div>
							<p>
								{t.available}: <bdi>{b.available}</bdi> {unit}
							</p>
						</div>
					))}
			</section>
			<section className={panel}>
				<h2 className="mb-4 text-lg font-bold">{t.movements}</h2>
				<MovementTable
					locale={locale}
					seller={seller}
					rows={batch ? (history?.results ?? []) : (position.movements ?? [])}
				/>
				{batch && history && (
					<Pagination
						locale={locale}
						page={history.page}
						count={history.count}
						size={history.page_size}
						onPage={(page) => onPage(page)}
					/>
				)}
				<Link
					href={
						sellerHref(locale, "inventory/movements", seller) +
						`&variant=${position.id}${batch ? `&batch=${batch}` : ""}`
					}
				>
					{t.movements}
				</Link>
			</section>
		</>
	);
}
