"use client";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import type { StockMovement } from "../../../../../../../features/inventory/api/inventory";
import { sellerHref } from "../../../../../../../lib/routes/account-routes";
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
		const previous = document.activeElement;
		ref.current?.showModal();
		ref.current?.querySelector("h2")?.focus();
		return () => {
			ref.current?.close();
			if (previous instanceof HTMLElement) previous.focus();
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
			className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-card border border-border bg-surface p-5 text-foreground shadow-card backdrop:bg-foreground/30"
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
}: {
	rows: StockMovement[];
	locale: Locale;
	seller: string;
}) {
	const t = inventoryCopy[locale],
		actions: Record<string, string> = {
			receive: t.received,
			adjust: t.adjusted,
			reserve: t.reserved,
			release: t.released,
			consume: t.consumed,
			cod: t.cod,
		};
	if (!rows.length) return <p className="py-5 text-muted">{t.empty}</p>;
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard scrolling for the labelled table region.
		<section aria-label={t.movements} tabIndex={0} className="overflow-x-auto">
			<p className="mb-3 text-xs text-muted desktop:hidden">{t.tableHint}</p>
			<table className="w-full min-w-[42rem] text-start text-sm">
				<caption className="sr-only">{t.movements}</caption>
				<thead>
					<tr>
						{[
							t.date,
							t.sku,
							t.action,
							t.delta,
							t.balance,
							t.reason,
							t.actor,
						].map((x) => (
							<th
								key={x}
								scope="col"
								className="border-b border-border p-3 text-start"
							>
								{x}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.id}>
							<td className="border-b border-border p-3">
								<time dateTime={r.at}>
									{new Intl.DateTimeFormat(locale, {
										dateStyle: "medium",
										timeStyle: "short",
										timeZone: "Asia/Kabul",
									}).format(new Date(r.at))}
								</time>
							</td>
							<td className="border-b border-border p-3">
								<Link
									href={sellerHref(locale, `inventory/${r.variant}`, seller)}
								>
									<bdi className="whitespace-nowrap">{r.sku}</bdi>
								</Link>
								<p>{r.unit_labels[locale] ?? r.unit}</p>
							</td>
							<td className="border-b border-border p-3">
								{actions[r.action] ?? r.action}
							</td>
							<td className="border-b border-border p-3">
								<bdi dir="ltr" className="whitespace-nowrap">
									{r.physical_delta} / {r.held_delta}
								</bdi>
							</td>
							<td className="border-b border-border p-3">
								<bdi dir="ltr" className="whitespace-nowrap">
									{r.physical_after} / {r.held_after}
								</bdi>
							</td>
							<td className="max-w-72 border-b border-border p-3 wrap-anywhere">
								{r.reason}
								<p className="text-xs text-muted">
									<bdi>{r.reference}</bdi>
								</p>
							</td>
							<td className="border-b border-border p-3">{r.actor}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
