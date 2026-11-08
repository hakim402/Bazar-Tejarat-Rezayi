"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { Icon } from "../../../../../../../components/ui/icon";
import { StatusBadge } from "../../../../../../../components/ui/status-badge";
import type { StockMovement } from "../../../../../../../features/inventory/api/inventory";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import type { QueryReader } from "../../../../../../../lib/routes/account-routes";
import { movementStockHref, stockHref } from "./stock-ui";

export const panel =
	"min-w-0 rounded-card border border-border bg-surface p-4 shadow-card desktop:p-6";
export const linkClass =
	"inline-flex min-h-11 items-center justify-center rounded-control border border-border bg-surface px-4 py-2 text-sm font-bold text-action no-underline hover:bg-info";

export function StockModal({
	title,
	children,
	onClose,
}: {
	title: string;
	children: ReactNode;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		const previous = document.activeElement;
		dialog.showModal();
		dialog.querySelector("h2")?.focus({ preventScroll: true });
		return () => {
			dialog.close();
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus({ preventScroll: true });
		};
	}, []);
	return (
		<dialog
			ref={ref}
			aria-label={title}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] min-w-0 max-w-xl overflow-y-auto overscroll-contain rounded-card border border-border bg-surface p-5 text-foreground shadow-card wrap-anywhere backdrop:bg-foreground/30"
		>
			<h2 tabIndex={-1} className="mb-4 text-xl font-bold">
				{title}
			</h2>
			{children}
		</dialog>
	);
}

export function MovementTable({
	rows,
	locale,
	seller,
	compact = false,
	params,
	fromHistory = false,
}: {
	rows: StockMovement[];
	locale: Locale;
	seller: string;
	compact?: boolean;
	params?: QueryReader;
	fromHistory?: boolean;
}) {
	const t = inventoryCopy[locale];
	const copy = sellerInventoryCopy[locale];
	const actions: Record<string, string> = {
		receive: t.received,
		adjust: t.adjusted,
		reserve: t.reserved,
		release: t.released,
		consume: t.consumed,
		cod: t.cod,
	};
	const dateFormat = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Kabul",
	});
	const href = (path: string) =>
		fromHistory
			? movementStockHref(locale, path, seller, params)
			: stockHref(locale, path, seller, params);
	const identity = (row: StockMovement) => (
		<div className="min-w-0">
			<p className="mb-1 text-xs text-muted">{t.sku}</p>
			<Link
				href={href(`inventory/${row.variant}`)}
				className="font-semibold text-action wrap-anywhere hover:underline"
			>
				<bdi>{row.sku}</bdi>
			</Link>
			{row.batch && (
				<Link
					href={href(`inventory/${row.variant}/batches/${row.batch}`)}
					className="mt-2 flex min-h-11 items-center gap-1.5 text-sm text-action hover:underline"
				>
					<Icon name="box" className="size-4" />
					{t.batch}
				</Link>
			)}
		</div>
	);
	const operation = (row: StockMovement) => (
		<StatusBadge
			dot={false}
			variant={
				row.action === "receive"
					? "success"
					: row.action === "adjust"
						? "warning"
						: "info"
			}
		>
			{actions[row.action] ?? row.action}
		</StatusBadge>
	);
	const quantities = (row: StockMovement, after: boolean) => {
		const unit = row.unit_labels[locale] ?? row.unit;
		return (
			<dl className="m-0 grid min-w-0 gap-3">
				{[
					{
						label: after ? copy.physicalAfter : copy.physicalChange,
						value: after ? row.physical_after : row.physical_delta,
					},
					{
						label: after ? copy.heldAfter : copy.heldChange,
						value: after ? row.held_after : row.held_delta,
					},
				].map(({ label, value }) => (
					<div key={label} className="min-w-0">
						<dt className="text-xs leading-relaxed text-muted wrap-anywhere">
							{label}
						</dt>
						<dd className="m-0 mt-1 text-sm font-semibold tabular-nums wrap-anywhere">
							<bdi dir="ltr">{value}</bdi>{" "}
							<span className="font-normal">{unit}</span>
						</dd>
					</div>
				))}
			</dl>
		);
	};
	const details = (row: StockMovement) => (
		<dl className="m-0 grid min-w-0 gap-3 text-sm">
			<div className="min-w-0">
				<dt className="text-xs text-muted">{t.reason}</dt>
				<dd className="m-0 mt-1 whitespace-pre-wrap wrap-anywhere">
					{row.reason || copy.notSet}
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-xs text-muted">{t.reference}</dt>
				<dd className="m-0 mt-1 wrap-anywhere">
					<bdi>{row.reference || copy.notSet}</bdi>
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-xs text-muted">{t.date}</dt>
				<dd className="m-0 mt-1 wrap-anywhere">
					<time dateTime={row.at}>{dateFormat.format(new Date(row.at))}</time>
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-xs text-muted">{t.actor}</dt>
				<dd className="m-0 mt-1 wrap-anywhere">
					<bdi>{row.actor || t.unknown}</bdi>
				</dd>
			</div>
		</dl>
	);

	if (!rows.length) {
		return (
			<EmptyState
				borderless
				icon="history"
				title={fromHistory ? copy.noMovements : t.emptyMovements}
				description={fromHistory ? copy.noMovementsHelp : t.emptyMovementsDesc}
			/>
		);
	}
	return (
		<div className="min-w-0">
			{!compact && (
				<section
					aria-label={t.movements}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Named overflow region allows keyboard access to every history column.
					tabIndex={0}
					className="hidden min-w-0 overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary desktop:block"
				>
					<table className="w-full min-w-[48rem] border-collapse text-start text-sm">
						<caption className="sr-only">{t.movements}</caption>
						<thead>
							<tr>
								{[copy.options, t.action, copy.change, copy.details].map(
									(label) => (
										<th
											key={label}
											scope="col"
											className="border-b border-border p-3 text-start text-xs font-semibold text-muted wrap-anywhere"
										>
											{label}
										</th>
									),
								)}
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr
									key={row.id}
									className="border-b border-border last:border-0"
								>
									<th
										scope="row"
										className="w-1/5 p-3 text-start align-top font-normal"
									>
										{identity(row)}
									</th>
									<td className="p-3 align-top">{operation(row)}</td>
									<td className="p-3 align-top">
										<div className="grid grid-cols-2 gap-4">
											{quantities(row, false)}
											{quantities(row, true)}
										</div>
									</td>
									<td className="w-1/3 p-3 align-top">{details(row)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			)}
			<ul
				className={`m-0 min-w-0 list-none space-y-3 p-0 ${compact ? "" : "desktop:hidden"}`}
			>
				{rows.map((row) => (
					<li
						key={row.id}
						className="min-w-0 rounded-xl border border-border bg-surface p-4"
					>
						<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
							{identity(row)}
							<div className="min-w-0">
								<p className="mb-1 text-xs text-muted">{t.action}</p>
								{operation(row)}
							</div>
						</div>
						<div className="my-4 grid min-w-0 grid-cols-2 gap-4 rounded-xl bg-page p-3">
							{quantities(row, false)}
							{quantities(row, true)}
						</div>
						{details(row)}
					</li>
				))}
			</ul>
		</div>
	);
}
