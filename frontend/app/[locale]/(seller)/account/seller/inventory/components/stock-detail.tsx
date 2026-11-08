"use client";

import Link from "next/link";
import { Alert } from "../../../../../../../components/ui/alert";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { Icon } from "../../../../../../../components/ui/icon";
import { StatusBadge } from "../../../../../../../components/ui/status-badge";
import type {
	StockHistory,
	StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { Pagination } from "../../../../../../../features/inventory/components/pagination";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import type { QueryReader } from "../../../../../../../lib/routes/account-routes";
import { MovementTable, panel, linkClass } from "./stock-parts";
import { stockHref } from "./stock-ui";

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
	const t = inventoryCopy[locale];
	const copy = sellerInventoryCopy[locale];
	const href = (path: string, changes: Record<string, string> = {}) =>
		stockHref(locale, path, seller, params, changes);
	const selectedBatch = batch
		? position.batches?.find((candidate) => candidate.id === batch)
		: null;
	if (batch && !selectedBatch) return <Alert>{t.notFound}</Alert>;

	const snapshot = selectedBatch ?? position;
	const unit = position.unit_labels[locale] ?? position.unit;
	const selection = { selected_batch: selectedBatch?.id ?? "" };
	const quantities = [
		{ label: t.physical, value: snapshot.physical, icon: "warehouse" },
		{ label: t.held, value: snapshot.held, icon: "lock" },
		{
			label: t.available,
			value: snapshot.available ?? t.unknown,
			icon: "check-circle",
		},
		{
			label: t.expired,
			value: selectedBatch
				? selectedBatch.expired
					? selectedBatch.physical
					: "0.000"
				: position.expired,
			icon: "clock",
		},
	] as const;
	const expiry = (date: string | null) =>
		date ? (
			<time dateTime={date}>
				<bdi dir="ltr">{date}</bdi>
			</time>
		) : (
			copy.notSet
		);

	return (
		<>
			<section className={panel}>
				<nav aria-label={t.inventory} className="mb-5 text-sm">
					<ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-2 p-0">
						<li>
							<Link
								className="text-action hover:underline"
								href={href("inventory")}
							>
								{t.inventory}
							</Link>
						</li>
						<li aria-hidden="true">
							<Icon name="chevron" className="size-3 text-muted" />
						</li>
						<li
							className="min-w-0 wrap-anywhere"
							aria-current={selectedBatch ? undefined : "page"}
						>
							{selectedBatch ? (
								<Link
									className="text-action hover:underline"
									href={href(`inventory/${position.id}`)}
								>
									{position.title}
								</Link>
							) : (
								position.title
							)}
						</li>
						{selectedBatch && (
							<>
								<li aria-hidden="true">
									<Icon name="chevron" className="size-3 text-muted" />
								</li>
								<li aria-current="page" className="min-w-0 wrap-anywhere">
									<bdi>{selectedBatch.code}</bdi>
								</li>
							</>
						)}
					</ol>
				</nav>
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
					<div className="min-w-0 flex-1 basis-60">
						<h2 className="text-xl font-semibold wrap-anywhere">
							{selectedBatch ? <bdi>{selectedBatch.code}</bdi> : position.title}
						</h2>
						{selectedBatch && (
							<p className="mt-2 wrap-anywhere">{position.title}</p>
						)}
						<p className="mt-2 text-sm text-muted wrap-anywhere">
							{t.sku}: <bdi>{position.sku}</bdi> · {t.unit}: {unit}
						</p>
						{selectedBatch && (
							<p className="mt-2 text-sm text-muted wrap-anywhere">
								{t.expires}: {expiry(selectedBatch.expires_on)}
							</p>
						)}
					</div>
					<div className="flex min-w-0 flex-wrap gap-2">
						<StatusBadge
							dot={false}
							variant={position.eligible ? "success" : "neutral"}
						>
							{position.eligible ? t.eligible : t.blocked}
						</StatusBadge>
						<StatusBadge dot={false} variant="neutral">
							{position.configured ? t.configured : t.unconfigured}
						</StatusBadge>
						{selectedBatch?.expired && (
							<StatusBadge dot={false} variant="danger">
								{t.expired}
							</StatusBadge>
						)}
						{!position.capabilities.write && (
							<StatusBadge dot={false} variant="info">
								{t.readOnly}
							</StatusBadge>
						)}
					</div>
				</div>
				<div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-4">
					{params.get("history") === "1" && (
						<Link className={linkClass} href={href("inventory/movements")}>
							<Icon name="return" className="me-2 size-4" />
							{copy.returnHistory}
						</Link>
					)}
					{position.capabilities.write && (
						<>
							<Link
								className={linkClass}
								href={href(`inventory/${position.id}/settings`)}
							>
								<Icon name="sliders" className="me-2 size-4" />
								{t.settings}
							</Link>
							{position.configured && (
								<>
									{!selectedBatch?.expired && (
										<Link
											className={linkClass}
											href={href(
												`inventory/${position.id}/receipts/new`,
												selection,
											)}
										>
											<Icon name="inbox" className="me-2 size-4" />
											{t.receipt}
										</Link>
									)}
									<Link
										className={linkClass}
										href={href(
											`inventory/${position.id}/adjustments/new`,
											selection,
										)}
									>
										<Icon name="sliders" className="me-2 size-4" />
										{t.adjustment}
									</Link>
								</>
							)}
							<Link
								className={linkClass}
								href={href(`catalogue/${position.product}`)}
							>
								<Icon name="box" className="me-2 size-4" />
								{t.products}
							</Link>
						</>
					)}
				</div>
			</section>

			<section
				aria-label={copy.currentStock}
				className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
			>
				{quantities.map(({ label, value, icon }) => (
					<div key={label} className={panel}>
						<dl className="m-0 min-w-0">
							<dt className="flex items-start gap-2 text-sm text-muted wrap-anywhere">
								<Icon name={icon} className="mt-0.5 size-4" />
								{label}
							</dt>
							<dd
								className={`m-0 mt-3 font-semibold tabular-nums wrap-anywhere ${value.length > 12 ? "text-xl" : "text-2xl"}`}
							>
								<bdi dir="ltr">{value}</bdi>{" "}
								<span className="text-sm font-normal text-muted">{unit}</span>
							</dd>
						</dl>
					</div>
				))}
			</section>
			<p className="text-sm leading-relaxed text-muted">{t.stockMeaning}</p>

			<section className={panel}>
				<h2 className="flex items-center gap-2 text-lg font-semibold">
					<Icon name="sliders" className="size-5 text-muted" />
					{copy.policy}
				</h2>
				<dl className="m-0 mt-5 grid gap-5 sm:grid-cols-2">
					<div className="min-w-0">
						<dt className="text-sm text-muted">{t.tracking}</dt>
						<dd className="m-0 mt-1 font-medium wrap-anywhere">
							{!position.configured
								? t.unconfigured
								: position.tracking === "batch"
									? t.batchMode
									: t.plain}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-sm text-muted">{t.expiryRequired}</dt>
						<dd className="m-0 mt-1 font-medium">
							{!position.configured
								? copy.notSet
								: position.expiry_required
									? copy.yes
									: copy.no}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-sm text-muted">{t.threshold}</dt>
						<dd className="m-0 mt-1 font-medium tabular-nums wrap-anywhere">
							{position.threshold === null ? (
								copy.notSet
							) : (
								<>
									<bdi dir="ltr">{position.threshold}</bdi> {unit}
								</>
							)}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-sm leading-relaxed text-muted">
							{t.precision}
						</dt>
						<dd className="m-0 mt-1 font-medium tabular-nums wrap-anywhere">
							<bdi dir="ltr">{position.increment}</bdi> {unit}
						</dd>
					</div>
				</dl>
				<p className="mt-5 border-t border-border pt-4 text-sm leading-relaxed text-muted">
					{position.movements?.length ? t.locked : copy.setupHelp}
				</p>
			</section>

			{!selectedBatch &&
				position.configured &&
				position.tracking === "batch" && (
					<section className={panel}>
						<h2 className="mb-5 flex items-center gap-2 text-lg font-semibold">
							<Icon name="box" className="size-5 text-muted" />
							{copy.batches}
						</h2>
						{position.batches?.length ? (
							<div className="grid gap-4 xl:grid-cols-2">
								{position.batches.map((record) => (
									<article
										key={record.id}
										className="min-w-0 rounded-xl border border-border p-4"
									>
										<div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
											<h3 className="min-w-0 font-semibold wrap-anywhere">
												<Link
													className="text-action hover:underline"
													href={href(
														`inventory/${position.id}/batches/${record.id}`,
														{ page: "1" },
													)}
												>
													<bdi>{record.code}</bdi>
												</Link>
											</h3>
											{record.expired && (
												<StatusBadge dot={false} variant="danger">
													{t.expired}
												</StatusBadge>
											)}
										</div>
										<p className="mt-2 text-sm text-muted wrap-anywhere">
											{t.expires}: {expiry(record.expires_on)}
										</p>
										<dl className="m-0 mt-4 grid gap-3 sm:grid-cols-3">
											{[
												[t.physical, record.physical],
												[t.held, record.held],
												[t.available, record.available],
											].map(([label, value]) => (
												<div key={label} className="min-w-0">
													<dt className="text-xs text-muted wrap-anywhere">
														{label}
													</dt>
													<dd className="m-0 mt-1 text-sm font-semibold tabular-nums wrap-anywhere">
														<bdi dir="ltr">{value}</bdi>{" "}
														<span className="font-normal">{unit}</span>
													</dd>
												</div>
											))}
										</dl>
										{position.capabilities.write && (
											<div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
												{!record.expired && (
													<Link
														className={linkClass}
														href={href(
															`inventory/${position.id}/receipts/new`,
															{ selected_batch: record.id },
														)}
													>
														<Icon name="inbox" className="me-2 size-4" />
														{t.receipt}
													</Link>
												)}
												<Link
													className={linkClass}
													href={href(
														`inventory/${position.id}/adjustments/new`,
														{ selected_batch: record.id },
													)}
												>
													<Icon name="sliders" className="me-2 size-4" />
													{t.adjustment}
												</Link>
											</div>
										)}
									</article>
								))}
							</div>
						) : (
							<EmptyState
								borderless
								icon="box"
								title={copy.noBatches}
								description={copy.noBatchesHelp}
							/>
						)}
					</section>
				)}

			<section className={panel}>
				<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
					<h2 className="flex items-center gap-2 text-lg font-semibold">
						<Icon name="history" className="size-5 text-muted" />
						{selectedBatch ? t.movements : copy.latest}
					</h2>
					<Link
						className={linkClass}
						href={stockHref(locale, "inventory/movements", seller, undefined, {
							variant: position.id,
							batch: selectedBatch?.id ?? "",
							page: "1",
						})}
					>
						{t.movements}
						<Icon name="arrow" className="ms-2 size-4" />
					</Link>
				</div>
				<MovementTable
					locale={locale}
					seller={seller}
					params={params}
					rows={
						selectedBatch
							? (history?.results ?? [])
							: (position.movements ?? [])
					}
				/>
				{selectedBatch && history && (
					<Pagination
						locale={locale}
						page={history.page}
						count={history.count}
						size={history.page_size}
						onPage={onPage}
					/>
				)}
			</section>
		</>
	);
}
