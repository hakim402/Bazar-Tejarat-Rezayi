"use client";

import {
	ArrowLeft,
	Boxes,
	CheckCircle2,
	ChevronRight,
	Clock,
	History,
	Lock,
	Package,
	PackagePlus,
	Settings2,
	SlidersHorizontal,
	Store,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "../../../../../../../components/shadcn/badge";
import { Button } from "../../../../../../../components/shadcn/button";
import { Alert } from "../../../../../../../components/ui/alert";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import type {
	StockHistory,
	StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
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
	const write = position.capabilities.write;
	const actionClass = "h-9 rounded-lg text-xs font-semibold";
	const quantities = [
		{
			label: t.physical,
			value: snapshot.physical,
			help: t.physicalHelp,
			Icon: Package,
			chip: "bg-info text-action",
		},
		{
			label: t.held,
			value: snapshot.held,
			help: t.heldHelp,
			Icon: Lock,
			chip: "bg-chip-neutral-bg text-chip-neutral",
		},
		{
			label: t.available,
			value: snapshot.available ?? t.unknown,
			help: t.availableHelp,
			Icon: CheckCircle2,
			chip: "bg-success-surface text-success",
		},
		{
			label: t.expired,
			value: selectedBatch
				? selectedBatch.expired
					? selectedBatch.physical
					: "0.000"
				: position.expired,
			help: t.expiredHelp,
			Icon: Clock,
			chip: "bg-danger-surface text-danger",
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
								className="text-muted no-underline hover:text-action"
								href={href("inventory")}
							>
								{t.inventory}
							</Link>
						</li>
						<li aria-hidden="true">
							<ChevronRight className="size-3.5 text-muted rtl:rotate-180" />
						</li>
						<li
							className="min-w-0 wrap-anywhere"
							aria-current={selectedBatch ? undefined : "page"}
						>
							{selectedBatch ? (
								<Link
									className="text-muted no-underline hover:text-action"
									href={href(`inventory/${position.id}`)}
								>
									{position.title}
								</Link>
							) : (
								<span className="font-medium text-foreground">
									{position.title}
								</span>
							)}
						</li>
						{selectedBatch && (
							<>
								<li aria-hidden="true">
									<ChevronRight className="size-3.5 text-muted rtl:rotate-180" />
								</li>
								<li
									aria-current="page"
									className="min-w-0 font-medium text-foreground wrap-anywhere"
								>
									<bdi>{selectedBatch.code}</bdi>
								</li>
							</>
						)}
					</ol>
				</nav>
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
					<div className="min-w-0 flex-1 basis-60">
						<h2 className="m-0 text-xl font-bold wrap-anywhere">
							{selectedBatch ? <bdi>{selectedBatch.code}</bdi> : position.title}
						</h2>
						{selectedBatch && (
							<p className="m-0 mt-2 text-sm text-muted wrap-anywhere">
								{position.title}
							</p>
						)}
						<p className="m-0 mt-2 text-sm text-muted wrap-anywhere">
							{t.sku}: <bdi className="text-foreground">{position.sku}</bdi> ·{" "}
							{t.unit}: {unit}
						</p>
						{selectedBatch && (
							<p className="m-0 mt-2 text-sm text-muted wrap-anywhere">
								{t.expires}: {expiry(selectedBatch.expires_on)}
							</p>
						)}
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<StockBadge locale={locale} state={position.state} />
						{!position.eligible && (
							<Badge
								variant="secondary"
								className="rounded-full border-0 bg-chip-neutral-bg px-2.5 py-1 text-xs font-medium text-chip-neutral"
							>
								{t.blocked}
							</Badge>
						)}
						{selectedBatch?.expired && (
							<StockBadge locale={locale} state="expired" />
						)}
						{selectedBatch?.expiring && !selectedBatch.expired && (
							<StockBadge locale={locale} state="expiring" />
						)}
						{!write && (
							<Badge
								variant="secondary"
								className="rounded-full border-0 bg-info px-2.5 py-1 text-xs font-medium text-action"
							>
								{t.readOnly}
							</Badge>
						)}
					</div>
				</div>
				<div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
					{params.get("history") === "1" && (
						<Button
							asChild
							variant="ghost"
							size="sm"
							className={`${actionClass} text-muted`}
						>
							<Link href={href("inventory/movements")}>
								<ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
								{copy.returnHistory}
							</Link>
						</Button>
					)}
					{write && position.configured && !selectedBatch?.expired && (
						<Button asChild size="sm" className={actionClass}>
							<Link
								href={href(`inventory/${position.id}/receipts/new`, selection)}
							>
								<PackagePlus className="size-4" aria-hidden="true" />
								{t.receipt}
							</Link>
						</Button>
					)}
					{write && !position.configured && (
						<Button asChild size="sm" className={actionClass}>
							<Link href={href(`inventory/${position.id}/settings`)}>
								<Settings2 className="size-4" aria-hidden="true" />
								{t.setupStock}
							</Link>
						</Button>
					)}
					{write && position.configured && (
						<Button asChild variant="outline" size="sm" className={actionClass}>
							<Link
								href={href(`inventory/${position.id}/adjustments/new`, selection)}
							>
								<SlidersHorizontal className="size-4" aria-hidden="true" />
								{t.correct}
							</Link>
						</Button>
					)}
					{write && (
						<>
							<Button asChild variant="outline" size="sm" className={actionClass}>
								<Link href={href(`inventory/${position.id}/settings`)}>
									<Settings2 className="size-4" aria-hidden="true" />
									{t.settings}
								</Link>
							</Button>
							<Button asChild variant="ghost" size="sm" className={actionClass}>
								<Link href={href(`catalogue/${position.product}`)}>
									<Store className="size-4" aria-hidden="true" />
									{t.openCatalogue}
								</Link>
							</Button>
						</>
					)}
				</div>
			</section>

			<section
				aria-label={copy.currentStock}
				className="grid gap-3 sm:grid-cols-2 desktop:gap-4 xl:grid-cols-4"
			>
				{quantities.map(({ label, value, help, Icon: QuantityIcon, chip }) => (
					<div
						key={label}
						className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-xs desktop:p-5"
					>
						<dl className="m-0 min-w-0">
							<dt className="flex items-center justify-between gap-2 text-xs font-medium text-muted wrap-anywhere">
								{label}
								<span
									className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${chip}`}
								>
									<QuantityIcon className="size-4" aria-hidden="true" />
								</span>
							</dt>
							<dd
								className={`m-0 mt-2 font-bold tabular-nums wrap-anywhere ${value.length > 12 ? "text-xl" : "text-2xl"}`}
							>
								<bdi dir="ltr">{value}</bdi>{" "}
								<span className="text-sm font-normal text-muted">{unit}</span>
							</dd>
						</dl>
						<p className="m-0 mt-2 text-caption leading-snug text-muted">
							{help}
						</p>
					</div>
				))}
			</section>
			<p className="m-0 text-caption leading-relaxed text-muted">
				{t.stockMeaning}
			</p>

			<section className={panel}>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
						<SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />
						{copy.policy}
					</h2>
					{write && (
						<Button asChild variant="outline" size="sm" className={actionClass}>
							<Link href={href(`inventory/${position.id}/settings`)}>
								{t.settings}
							</Link>
						</Button>
					)}
				</div>
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
						<h2 className="m-0 mb-5 flex items-center gap-2 text-base font-semibold">
							<Boxes className="size-4 text-muted" aria-hidden="true" />
							{copy.batches}
						</h2>
						{position.batches?.length ? (
							<div className="grid gap-4 xl:grid-cols-2">
								{position.batches.map((record) => (
									<article
										key={record.id}
										className="min-w-0 rounded-xl border border-border bg-page/40 p-4"
									>
										<div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
											<h3 className="m-0 min-w-0 text-sm font-semibold wrap-anywhere">
												<Link
													className="text-foreground no-underline hover:text-action"
													href={href(
														`inventory/${position.id}/batches/${record.id}`,
														{ page: "1" },
													)}
												>
													<bdi>{record.code}</bdi>
												</Link>
											</h3>
											{record.expired && (
												<StockBadge locale={locale} state="expired" />
											)}
											{record.expiring && !record.expired && (
												<StockBadge locale={locale} state="expiring" />
											)}
										</div>
										<p className="m-0 mt-2 text-xs text-muted wrap-anywhere">
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
														<span className="font-normal text-muted">
															{unit}
														</span>
													</dd>
												</div>
											))}
										</dl>
										{write && (
											<div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
												{!record.expired && (
													<Button
														asChild
														variant="secondary"
														size="sm"
														className="h-8 rounded-lg border-0 bg-info px-3 text-xs font-semibold text-action shadow-none hover:bg-info/70"
													>
														<Link
															href={href(
																`inventory/${position.id}/receipts/new`,
																{ selected_batch: record.id },
															)}
														>
															<PackagePlus className="size-4" aria-hidden="true" />
															{t.receipt}
														</Link>
													</Button>
												)}
												<Button
													asChild
													variant="outline"
													size="sm"
													className="h-8 rounded-lg text-xs font-semibold"
												>
													<Link
														href={href(
															`inventory/${position.id}/adjustments/new`,
															{ selected_batch: record.id },
														)}
													>
														<SlidersHorizontal className="size-4" aria-hidden="true" />
														{t.correct}
													</Link>
												</Button>
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
					<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
						<History className="size-4 text-muted" aria-hidden="true" />
						{selectedBatch ? t.movements : copy.latest}
					</h2>
					<Button asChild variant="outline" size="sm" className={actionClass}>
						<Link
							href={stockHref(locale, "inventory/movements", seller, undefined, {
								variant: position.id,
								batch: selectedBatch?.id ?? "",
								page: "1",
							})}
						>
							{t.movements}
						</Link>
					</Button>
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
					<StockPagination
						locale={locale}
						page={history.page}
						count={history.count}
						size={history.page_size}
						href={(page) =>
							href(`inventory/${position.id}/batches/${selectedBatch.id}`, {
								page: String(page),
							})
						}
						onPage={onPage}
					/>
				)}
			</section>
		</>
	);
}
