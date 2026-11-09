"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "../../../../../../components/ui/empty-state";
import { localTimestamp } from "../../../../../../features/messaging/api";
import {
	commerce,
	type Order,
	type Page,
} from "../../../../../../features/orders/api";
import {
	reportProfiles,
	sellerSummary,
	type SellerSummary,
} from "../../../../../../features/reports/api";
import { reportCopy } from "../../../../../../features/reports/copy";
import { salesHref } from "../../../../../../features/sales/components/seller-sales-ui";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { sellerHref } from "../../../../../../lib/routes/account-routes";

export type Activity =
	| { state: "loading" | "unavailable" | "failed" }
	| { state: "ready"; summary: SellerSummary; orders: Order[] | null };

export function useSellerActivity(seller: string, locale: Locale): Activity {
	const [activity, setActivity] = useState<Activity>({ state: "loading" });
	useEffect(() => {
		if (!seller) {
			setActivity({ state: "unavailable" });
			return;
		}
		const controller = new AbortController();
		setActivity({ state: "loading" });
		(async () => {
			const { results } = await reportProfiles();
			const profile = results.find((item) => item.id === seller);
			if (!profile?.sections.orders) return { state: "unavailable" } as const;
			const [summary, orders] = await Promise.all([
				sellerSummary(seller, {}),
				commerce<Page<Order>>(
					`orders/seller/orders/?page=1&seller=${seller}&locale=${locale}`,
					undefined,
					"GET",
					controller.signal,
				).then(
					(page) => page.results.slice(0, 5),
					() => null,
				),
			]);
			return { state: "ready", summary, orders } as const;
		})().then(
			(value) => !controller.signal.aborted && setActivity(value),
			() => !controller.signal.aborted && setActivity({ state: "failed" }),
		);
		return () => controller.abort();
	}, [seller, locale]);
	return activity;
}

function Amount({ value, currency }: { value: string; currency: string }) {
	return (
		<bdi dir="ltr" className="tabular-nums">
			{value} {currency}
		</bdi>
	);
}

export function SalesSnapshot({
	locale,
	seller,
	activity,
	fallback,
}: {
	locale: Locale;
	seller: string;
	activity: Activity;
	fallback: React.ReactNode;
}) {
	const t = reportCopy[locale];
	if (activity.state === "loading")
		return (
			<p role="status" className="text-sm text-muted">
				{t.loading}
			</p>
		);
	if (activity.state !== "ready") return fallback;
	const number = new Intl.NumberFormat(locale);
	const rows = activity.summary.orders ?? [];
	const waiting = activity.summary.queues.awaiting_dispatch;
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted">{t.last30}</p>
			{rows.length === 0 ? (
				<p className="text-sm text-muted">{t.noOrders}</p>
			) : (
				<dl className="m-0 grid gap-3 sm:grid-cols-2">
					{rows.map((row) => (
						<div
							key={row.currency}
							className="min-w-0 rounded-xl border border-border p-4"
						>
							<dt className="text-sm text-muted">
								{t.accepted} · {row.currency}
							</dt>
							<dd className="m-0 mt-1 text-2xl font-bold text-foreground">
								{number.format(row.accepted)}
							</dd>
							<dd className="m-0 mt-1 text-sm text-muted">
								{t.acceptedTotal}:{" "}
								<Amount value={row.accepted_total} currency={row.currency} />
							</dd>
						</div>
					))}
				</dl>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3">
				{waiting !== undefined && (
					<p className="text-sm text-foreground">
						{t.queues.awaiting_dispatch}:{" "}
						<strong>{number.format(waiting)}</strong>
					</p>
				)}
				<Link
					className="text-sm font-semibold text-action"
					href={sellerHref(locale, "reports", seller)}
				>
					{t.openReports}
				</Link>
			</div>
		</div>
	);
}

export function RecentOrders({
	locale,
	seller,
	activity,
	fallback,
}: {
	locale: Locale;
	seller: string;
	activity: Activity;
	fallback: React.ReactNode;
}) {
	const t = reportCopy[locale];
	if (activity.state === "loading")
		return (
			<p role="status" className="text-sm text-muted">
				{t.loading}
			</p>
		);
	if (activity.state !== "ready") return fallback;
	if (activity.orders === null)
		return <p className="text-sm text-muted">{t.ordersFailed}</p>;
	if (activity.orders.length === 0)
		return (
			<EmptyState
				borderless
				icon="shopping-bag"
				title={t.ordersEmpty}
				description={t.ordersEmptyHint}
			/>
		);
	return (
		<ul className="m-0 list-none space-y-1 p-0">
			{activity.orders.map((order) => (
				<li key={order.id}>
					<Link
						href={salesHref(locale, "orders", seller, order.id)}
						className="flex min-h-14 min-w-0 items-center justify-between gap-3 rounded-xl px-2 py-2 no-underline hover:bg-info"
					>
						<span className="min-w-0">
							<bdi className="block font-semibold text-action">
								{order.number}
							</bdi>
							<span dir="auto" className="block truncate text-sm text-muted">
								{order.snapshot.buyer}
							</span>
						</span>
						<span className="shrink-0 text-end text-sm">
							<span className="block font-semibold text-foreground">
								<Amount value={order.goods_total} currency={order.currency} />
							</span>
							<bdi className="block text-muted">
								{localTimestamp(order.accepted_at, locale)}
							</bdi>
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
