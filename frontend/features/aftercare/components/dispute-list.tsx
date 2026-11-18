"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw, Shield } from "lucide-react";
import type { Locale } from "../../../lib/i18n/locales";
import {
	accessLost,
	useOnlineState,
	useVisiblePoll,
} from "../../messaging/hooks";
import { localTimestamp } from "../../messaging/api";
import { EmptyState } from "../../../components/ui/empty-state";
import { StatusBadge } from "../../../components/ui/status-badge";
import { orderListCopy } from "../../orders/list-copy";
import {
	BuyerTableFrame,
	BuyerTableRegion,
	BuyerRowMenu,
	buyerRow,
	buyerCell,
} from "../../orders/components/buyer-ui";
import { aftercare, aftercareHref, disputeHref } from "../api";
import { aftercareCopy, aftercareState } from "../copy";
import type { Context, DisputeRow, Page } from "../types";

export function DisputeList({
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
		online = useOnlineState(),
		router = useRouter();
	const [data, setData] = useState<Page<DisputeRow> | null>(null),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[revision, setRevision] = useState(0);
	useVisiblePoll(
		async (signal) => {
			try {
				const query = new URLSearchParams({ page: String(page) });
				if (context === "seller" && seller) query.set("seller", seller);
				const result = await aftercare<Page<DisputeRow>>(
					"orders",
					context,
					`disputes/?${query}`,
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
		[context, seller, page, revision, denied],
		!denied,
	);
	if (denied)
		return (
			<p role="alert" className="text-sm text-danger">
				{t.noAccess}
			</p>
		);
	const pageHref = (next: number) =>
		disputeHref(locale, context, undefined, seller, next);
	const identity = (row: DisputeRow) => (
		<div className="min-w-0 space-y-1.5">
			<Link
				href={disputeHref(locale, context, row.id, seller)}
				className="text-sm font-semibold text-action no-underline hover:text-foreground"
			>
				<bdi>{row.number}</bdi>
			</Link>
			<time
				dateTime={row.created_at}
				className="block max-w-40 text-xs leading-relaxed text-muted"
			>
				{localTimestamp(row.created_at, locale)}
			</time>
		</div>
	);
	const reason = (row: DisputeRow) => (
		<p
			dir="auto"
			className="m-0 line-clamp-2 max-w-72 text-sm leading-relaxed"
			title={row.reason}
		>
			{row.reason}
		</p>
	);
	const status = (row: DisputeRow) => (
		<StatusBadge
			variant={
				row.state === "pending"
					? "warning"
					: row.state === "refund_ordered"
						? "info"
						: row.state === "resolved_non_monetary"
							? "success"
							: "neutral"
			}
		>
			{aftercareState(locale, row.state)}
		</StatusBadge>
	);
	const menu = (row: DisputeRow) => (
		<BuyerRowMenu
			locale={locale}
			label={`${ol.actions}: ${row.number}`}
			links={[
				{
					href: disputeHref(locale, context, row.id, seller),
					label: t.disputeView,
					Icon: Shield,
				},
				{
					href: aftercareHref(locale, context, row.order),
					label: t.helpOpen,
					Icon: RotateCcw,
				},
			]}
		/>
	);
	return (
		<section className="flex min-w-0 flex-col gap-5">
			<header className="min-w-0">
				<h1 className="m-0 text-2xl font-bold">{t.disputes}</h1>
				<p className="m-0 mt-1 max-w-3xl text-sm text-muted">
					{t.disputeIntro}
				</p>
			</header>
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
				title={t.disputes}
				count={data?.count ?? null}
				page={page}
				onPage={(next) => router.push(pageHref(next))}
				pageHref={pageHref}
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
					<EmptyState borderless icon="inbox" title={t.disputeEmpty} />
				) : (
					<>
						<BuyerTableRegion
							label={t.disputes}
							head={[t.disputes, t.disputeReason, ol.status, ol.actions]}
							minWidth="56rem"
						>
							{data.results.map((row) => (
								<tr key={row.id} className={buyerRow}>
									<td className={buyerCell}>{identity(row)}</td>
									<td className={buyerCell}>{reason(row)}</td>
									<td className={buyerCell}>{status(row)}</td>
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
									{reason(row)}
									{status(row)}
								</li>
							))}
						</ul>
					</>
				)}
			</BuyerTableFrame>
		</section>
	);
}
