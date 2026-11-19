"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "../../../../../../components/ui/empty-state";
import { RecentMessagesList } from "../../../../../../components/ui/recent-messages-list";
import {
	localTimestamp,
	recentConversations,
	threadHref,
	type RecentConversations,
} from "../../../../../../features/messaging/api";
import { communicationCopy } from "../../../../../../features/messaging/copy";
import {
	accessLost,
	useVisiblePoll,
} from "../../../../../../features/messaging/hooks";
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
import { ArrowUpRight } from "lucide-react";
import { Badge } from "../../../../../../components/shadcn/badge";
import { Button } from "../../../../../../components/shadcn/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../components/shadcn/table";
import { ProductThumbnail } from "../../../../../../features/orders/components/order-ui";
import { orderListCopy } from "../../../../../../features/orders/list-copy";
import { commerceCopy } from "../../../../../../features/orders/copy";
import { paymentState } from "../../../../../../features/payments/copy";
import { fulfilmentState } from "../../../../../../features/fulfilment/copy";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { sellerMessagesCopy } from "../../../../../../lib/i18n/seller-messages";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";
import { uuidPattern } from "../../../../../../lib/routes/account-routes";

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

export function RecentMessages({
	locale,
	seller,
}: {
	locale: Locale;
	seller: string;
}) {
	const t = communicationCopy[locale];
	const copy = sellerMessagesCopy[locale];
	const shell = sellerShellCopy[locale];
	const [recent, setRecent] = useState<
		| { state: "loading" | "failed" | "denied" }
		| { state: "ready"; data: RecentConversations }
	>({ state: "loading" });
	useVisiblePoll(
		async (signal) => {
			try {
				const data = await recentConversations(seller, { signal });
				if (signal.aborted) return;
				setRecent({ state: "ready", data });
			} catch (error) {
				if (signal.aborted) return;
				// Drop all previews on failure; loss of access also stops polling.
				setRecent({ state: accessLost(error) ? "denied" : "failed" });
				throw error;
			}
		},
		[seller, locale],
		uuidPattern.test(seller) && recent.state !== "denied",
	);
	if (recent.state === "loading")
		return (
			<p role="status" className="text-sm text-muted">
				{t.loading}
			</p>
		);
	if (recent.state !== "ready")
		return (
			<p role="alert" className="text-sm text-muted">
				{recent.state === "denied"
					? shell.messagesDenied
					: shell.messagesUnavailable}
			</p>
		);
	return (
		<RecentMessagesList
			messages={recent.data.results.slice(0, 4).map((conversation) => {
				const last = conversation.last_message;
				const preview = last?.text.trim()
					? last.text
					: last?.has_images
						? t.images
						: "";
				return {
					id: conversation.id,
					href: threadHref(
						locale,
						"seller",
						conversation.id,
						conversation.seller,
					),
					counterparty: conversation.counterparty,
					preview: last?.own ? `${t.you}: ${preview}` : preview,
					at: last?.at ?? conversation.updated_at,
					unread: conversation.unread,
				};
			})}
			locale={locale}
			unreadLabel={t.unread}
			emptyTitle={copy.empty}
			emptyDescription={copy.emptyHelp}
		/>
	);
}

function Amount({ value, currency }: { value: string; currency: string }) {
	return (
		<bdi dir="ltr" className="tabular-nums">
			{value} {currency}
		</bdi>
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
	const labels = orderListCopy[locale];
	const rows = activity.orders.map((order) => {
		const first = order.lines[0];
		const title = first
			? (first.snapshot.titles[locale] ??
				first.snapshot.titles[first.snapshot.source_locale] ??
				first.snapshot.sku)
			: "";
		const paid = ["paid", "overpaid"].includes(order.dimensions.financial);
		const delivered = order.dimensions.fulfilment === "delivered";
		return {
			id: order.id,
			product: (
				<div className="flex min-w-0 items-center gap-3">
					<ProductThumbnail key={first?.image} src={first?.image} />
					<div className="min-w-0">
						<Link
							href={salesHref(locale, "orders", seller, order.id)}
							className="text-sm font-semibold text-action no-underline hover:underline focus-visible:outline-2 focus-visible:outline-action"
						>
							<bdi>{order.number}</bdi>
						</Link>
						<p className="m-0 mt-1 truncate text-xs text-muted" title={title}>
							<bdi>{title}</bdi>
						</p>
						{order.lines.length > 1 && (
							<span className="text-xs text-muted">
								+{new Intl.NumberFormat(locale).format(order.lines.length - 1)}{" "}
								{labels.more}
							</span>
						)}
					</div>
				</div>
			),
			customer: (
				<div className="min-w-0">
					<p className="m-0 truncate text-sm" dir="auto">
						{order.snapshot.buyer}
					</p>
					<time
						dateTime={order.accepted_at}
						className="mt-1 block text-xs text-muted"
					>
						<bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
					</time>
				</div>
			),
			amount: (
				<span className="text-sm font-semibold">
					<Amount value={order.goods_total} currency={order.currency} />
				</span>
			),
			payment: (
				<Badge
					variant="secondary"
					className={`max-w-full whitespace-normal border-0 text-xs ${paid ? "bg-success-surface text-success" : "bg-info text-action"}`}
				>
					<span className="sr-only">{labels.payment}: </span>
					{paymentState(locale, order.dimensions.financial)}
				</Badge>
			),
			delivery: (
				<Badge
					variant="secondary"
					className={`max-w-full whitespace-normal border-0 text-xs ${delivered ? "bg-success-surface text-success" : "bg-page text-muted"}`}
				>
					<span className="sr-only">{labels.shipping}: </span>
					{fulfilmentState(locale, order.dimensions.fulfilment)}
				</Badge>
			),
			link: (
				<Button asChild variant="ghost" size="icon" className="text-muted">
					<Link
						href={salesHref(locale, "orders", seller, order.id)}
						aria-label={`${labels.view}: ${order.number}`}
					>
						<ArrowUpRight
							className="size-4 rtl:-scale-x-100"
							aria-hidden="true"
						/>
					</Link>
				</Button>
			),
		};
	});
	return (
		<>
			<div className="hidden lg:block">
				<Table className="table-fixed border-collapse text-start [&_td]:whitespace-normal [&_th]:text-start [&_tr]:border-0 [&_tr]:border-b [&_tr]:border-solid [&_tr]:border-border [&_tr:last-child]:border-b-0">
					<caption className="sr-only">{t.ordersTitle}</caption>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							{[
								labels.order,
								labels.customer,
								commerceCopy[locale].total,
								labels.payment,
								labels.shipping,
								labels.actions,
							].map((label, index) => (
								<TableHead
									key={label}
									className={`px-4 text-xs font-medium text-muted ${index === 0 ? "w-[28%]" : index === 5 ? "w-14" : ""}`}
								>
									{index === 5 ? (
										<span className="sr-only">{label}</span>
									) : (
										label
									)}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.id} className="hover:bg-info/30">
								<TableCell className="px-4 py-4">{row.product}</TableCell>
								<TableCell className="px-4 py-4">{row.customer}</TableCell>
								<TableCell className="px-4 py-4">{row.amount}</TableCell>
								<TableCell className="px-4 py-4">{row.payment}</TableCell>
								<TableCell className="px-4 py-4">{row.delivery}</TableCell>
								<TableCell className="px-2 py-4">{row.link}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
				{rows.map((row) => (
					<li key={row.id} className="space-y-3 p-4">
						<div className="flex items-center justify-between gap-2">
							<div className="min-w-0">{row.product}</div>
							{row.link}
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3">
							{row.customer}
							<div>
								<span className="mb-1 block text-xs text-muted">
									{commerceCopy[locale].total}
								</span>
								{row.amount}
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							{row.payment}
							{row.delivery}
						</div>
					</li>
				))}
			</ul>
		</>
	);
}
