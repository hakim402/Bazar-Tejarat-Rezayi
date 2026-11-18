"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LifeBuoy, Shield, ShoppingBag } from "lucide-react";
import type { Locale } from "../../../lib/i18n/locales";
import {
	accessLost,
	useVisiblePoll,
	useOnlineState,
} from "../../messaging/hooks";
import { EmptyState } from "../../../components/ui/empty-state";
import { StatusBadge } from "../../../components/ui/status-badge";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { deliveryListCopy } from "../../fulfilment/list-copy";
import { orderListCopy } from "../../orders/list-copy";
import {
	BuyerTableFrame,
	BuyerToolbar,
	BuyerTableRegion,
	BuyerRowMenu,
	buyerRow,
	buyerCell,
} from "../../orders/components/buyer-ui";
import { Money, ProductThumbnail } from "../../orders/components/order-ui";
import { aftercare, aftercareHref, disputeHref } from "../api";
import { aftercareCopy } from "../copy";
import type { Context, Detail, Page } from "../types";

export function AftercareList({
	locale,
	context,
	seller,
	page,
}: {
	locale: Locale;
	context: Context;
	seller: string;
	page: number;
}) {
	const t = aftercareCopy[locale],
		ol = orderListCopy[locale],
		l = deliveryListCopy[locale],
		s = sellerSalesCopy[locale],
		nf = new Intl.NumberFormat(locale),
		online = useOnlineState(),
		router = useRouter(),
		q = useSearchParams().get("q") ?? "";
	const [searchDraft, setSearchDraft] = useState(q);
	const [data, setData] = useState<Page<Detail> | null>(null);
	const [error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[revision, setRevision] = useState(0);
	useVisiblePoll(
		async (signal) => {
			try {
				const query = new URLSearchParams({ page: String(page) });
				if (seller) query.set("seller", seller);
				if (q) query.set("q", q);
				const result = await aftercare<Page<Detail>>(
					"orders",
					context,
					`aftercare/?${query}`,
					undefined,
					signal,
				);
				if (signal.aborted) return;
				setData(result);
				setError(false);
			} catch (error) {
				if (signal.aborted) return;
				setError(true);
				if (accessLost(error)) {
					setData(null);
					setDenied(true);
				}
				throw error;
			}
		},
		[context, seller, page, q, revision, denied],
		!denied,
	);
	if (denied)
		return (
			<p role="alert" className="text-sm text-danger">
				{t.noAccess}
			</p>
		);
	const href = (next: number, nextQ = q) => {
		const base = aftercareHref(locale, context, undefined, seller, next);
		return nextQ
			? `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(nextQ)}`
			: base;
	};
	const identity = (row: Detail) => (
		<div className="min-w-0 space-y-1.5">
			<Link
				href={aftercareHref(locale, context, row.id)}
				className="text-sm font-semibold text-action no-underline hover:text-foreground"
			>
				<bdi>{row.number}</bdi>
			</Link>
			<p
				className="m-0 max-w-44 truncate text-xs text-muted"
				dir="auto"
				title={row.seller_name}
			>
				{row.seller_name}
			</p>
		</div>
	);
	const items = (row: Detail) => {
		const first = row.effective_lines[0];
		if (!first) return <span className="text-sm text-muted">—</span>;
		const title = first.titles?.[locale] ?? first.sku ?? ol.unknown;
		return (
			<div className="min-w-0 max-w-72">
				<div className="flex min-w-0 items-start gap-3">
					<ProductThumbnail
						src={`/api/v1/orders/buyer/orders/${row.id}/lines/${first.line}/image/`}
					/>
					<div className="min-w-0 flex-1">
						<p className="m-0 truncate text-sm font-semibold" title={title}>
							{title}
						</p>
						<p className="m-0 mt-1 text-xs text-muted">
							{ol.sku}: <bdi>{first.sku ?? first.line}</bdi>
						</p>
					</div>
				</div>
				{row.effective_lines.length > 1 && (
					<p className="m-0 mt-1 text-xs text-muted">
						+{nf.format(row.effective_lines.length - 1)} {ol.more}
					</p>
				)}
			</div>
		);
	};
	const badges = (row: Detail) => {
		const due = Number(row.payment.refund_due) > 0,
			cancelPending = row.cancellations.some((c) => c.state === "pending"),
			amendPending = row.amendments.some((a) => a.state === "pending");
		if (!row.aftercare.cancelled && !cancelPending && !amendPending && !due)
			return <span className="text-sm text-muted">—</span>;
		return (
			<div className="flex flex-wrap items-center gap-1">
				{row.aftercare.cancelled && (
					<StatusBadge
						size="sm"
						variant="neutral"
						className="shrink-0 whitespace-nowrap"
					>
						{t.cancelled}
					</StatusBadge>
				)}
				{cancelPending && (
					<StatusBadge
						size="sm"
						variant="warning"
						className="shrink-0 whitespace-nowrap"
					>
						{t.cancelPending}
					</StatusBadge>
				)}
				{amendPending && (
					<StatusBadge
						size="sm"
						variant="warning"
						className="shrink-0 whitespace-nowrap"
					>
						{t.amendPending}
					</StatusBadge>
				)}
				{due && (
					<StatusBadge
						size="sm"
						variant="info"
						className="shrink-0 whitespace-nowrap"
					>
						{t.refundDue}
					</StatusBadge>
				)}
			</div>
		);
	};
	const money = (row: Detail) => (
		<div className="space-y-1">
			<p className="m-0 whitespace-nowrap text-sm font-semibold">
				<Money amount={row.accepted_total} currency={row.currency} />
			</p>
			{Number(row.payment.refund_due) > 0 && (
				<p className="m-0 text-xs text-muted">
					{t.refundDue}:{" "}
					<Money amount={row.payment.refund_due} currency={row.currency} />
				</p>
			)}
		</div>
	);
	const menu = (row: Detail) => (
		<BuyerRowMenu
			locale={locale}
			label={`${ol.actions}: ${row.number}`}
			links={[
				{
					href: aftercareHref(locale, context, row.id),
					label: t.helpOpen,
					Icon: LifeBuoy,
				},
				{
					href: `/${locale}/account/buyer/orders/${row.id}`,
					label: ol.view,
					Icon: ShoppingBag,
				},
				{ href: disputeHref(locale, context), label: t.disputes, Icon: Shield },
			]}
		/>
	);
	return (
		<section className="flex min-w-0 flex-col gap-5">
			<header className="min-w-0">
				<h1 className="m-0 text-2xl font-bold">{t.buyerTitle}</h1>
				<p className="m-0 mt-1 max-w-3xl text-sm text-muted">{t.buyerIntro}</p>
			</header>
			<BuyerToolbar
				locale={locale}
				searchPlaceholder={l.search}
				searchAction={l.searchAction}
				searchDraft={searchDraft}
				setSearchDraft={setSearchDraft}
				onSearch={() => router.push(href(1, searchDraft.trim()))}
				onClear={() => {
					setSearchDraft("");
					router.push(href(1, ""));
				}}
			/>
			{!online && (
				<p role="status" className="m-0 text-sm text-muted">
					{t.offline}
				</p>
			)}
			{error && (
				<p
					role="alert"
					className="m-0 rounded-xl bg-danger-surface px-4 py-3 text-sm text-danger"
				>
					{t.error}
				</p>
			)}
			<BuyerTableFrame
				locale={locale}
				title={t.buyerTitle}
				count={data?.count ?? null}
				page={page}
				onPage={(next) => router.push(href(next))}
				pageHref={(next) => href(next)}
				onRefresh={() => setRevision((value) => value + 1)}
				busy={!data && !error}
			>
				{!data ? (
					error ? null : (
						<p className="m-0 px-5 py-10 text-sm text-muted" role="status">
							{t.loading}
						</p>
					)
				) : data.results.length === 0 ? (
					<EmptyState
						borderless
						icon="inbox"
						title={q ? s.noMatches : t.empty}
						description={q ? s.noMatchesHelp : undefined}
					/>
				) : (
					<>
						<BuyerTableRegion
							label={t.buyerTitle}
							head={[
								ol.order,
								ol.products,
								ol.status,
								t.acceptedTotal,
								ol.actions,
							]}
							minWidth="68rem"
						>
							{data.results.map((row) => (
								<tr key={row.id} className={buyerRow}>
									<td className={buyerCell}>{identity(row)}</td>
									<td className={buyerCell}>{items(row)}</td>
									<td className={buyerCell}>{badges(row)}</td>
									<td className={buyerCell}>{money(row)}</td>
									<td className="px-4 py-3 align-top">
										<div className="flex items-center justify-end">
											{menu(row)}
										</div>
									</td>
								</tr>
							))}
						</BuyerTableRegion>
						<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
							{data.results.map((row) => (
								<li key={row.id} className="space-y-4 p-4">
									<div className="flex items-start justify-between gap-3">
										{identity(row)}
										{menu(row)}
									</div>
									{items(row)}
									<div className="grid grid-cols-1 gap-3 rounded-xl border border-solid border-border p-3 sm:grid-cols-2">
										{money(row)}
										{badges(row)}
									</div>
								</li>
							))}
						</ul>
					</>
				)}
			</BuyerTableFrame>
		</section>
	);
}
