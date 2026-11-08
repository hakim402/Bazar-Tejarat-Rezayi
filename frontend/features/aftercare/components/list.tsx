"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import {
	accessLost,
	useVisiblePoll,
	useOnlineState,
} from "../../messaging/hooks";
import {
	action as defaultAction,
	panel as defaultPanel,
} from "../../orders/components/controls";
import {
	SalesEmpty,
	SalesFrame,
	SalesHeader,
	SalesPagination,
	salesAction,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { aftercare, aftercareHref } from "../api";
import { aftercareCopy, aftercareState } from "../copy";
import type { Context, Detail, Page } from "../types";
import { AftercareSummary } from "./summary";

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
		sales = sellerSalesCopy[locale],
		online = useOnlineState(),
		router = useRouter();
	const isSeller = context === "seller",
		action = isSeller ? salesAction : defaultAction,
		panel = isSeller ? salesPanel : defaultPanel;
	const [data, setData] = useState<Page<Detail> | null>(null);
	const [error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[revision, setRevision] = useState(0);
	useVisiblePoll(
		async (signal) => {
			try {
				const query = new URLSearchParams({ page: String(page) });
				if (seller) query.set("seller", seller);
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
		[context, seller, page, revision, denied],
		!denied,
	);
	if (denied) return <p role="alert">{t.noAccess}</p>;
	return (
		<SalesFrame seller={isSeller}>
			<div className="min-w-0 space-y-5">
				{isSeller ? (
					<SalesHeader
						locale={locale}
						section="aftercare"
						seller={seller}
						business={
							<p className="text-sm font-medium wrap-anywhere">
								<bdi>{seller || sales.allBusinesses}</bdi>
							</p>
						}
					/>
				) : (
					<h1 className="text-2xl font-bold">{t.buyerTitle}</h1>
				)}
				<p
					className={
						isSeller
							? "max-w-3xl text-sm leading-relaxed text-muted"
							: undefined
					}
				>
					{t.intro}
				</p>
				{seller && (
					<Link
						className={action}
						prefetch={false}
						href={aftercareHref(locale, context)}
					>
						{t.allBusinesses}
					</Link>
				)}
				{!online && <p role="status">{t.offline}</p>}
				{error && <p role="alert">{t.error}</p>}
				<button
					className={action}
					type="button"
					disabled={!online}
					onClick={() => setRevision((value) => value + 1)}
				>
					{t.refresh}
				</button>
				{!data ? (
					<p role="status">{t.loading}</p>
				) : data.results.length ? (
					<ul className="space-y-4">
						{data.results.map((row) => {
							const href = isSeller
								? salesHref(
										locale,
										"aftercare",
										row.seller,
										row.id,
										undefined,
										{ page: String(page) },
									)
								: aftercareHref(locale, context, row.id);
							const cancellation = isSeller
								? (row.cancellations.find((item) => item.state === "pending") ??
									row.cancellations[0])
								: row.cancellations[0];
							const amendment = isSeller
								? (row.amendments.find((item) => item.state === "pending") ??
									row.amendments[0])
								: row.amendments[0];
							return (
								<li key={row.id} className={`${panel} space-y-3`}>
									<Link
										className={
											isSeller
												? "inline-flex min-h-11 items-center text-lg font-bold text-action"
												: "block min-h-11 font-bold"
										}
										prefetch={false}
										href={href}
									>
										<bdi>{row.number}</bdi>
									</Link>
									<AftercareSummary
										{...{ locale, row, compact: true, seller: isSeller }}
									/>
									{cancellation && (
										<p className={isSeller ? "text-sm" : undefined}>
											{isSeller ? t.cancellation : t.cancellations}:{" "}
											{aftercareState(locale, cancellation.state)}
										</p>
									)}
									{amendment && (
										<p className={isSeller ? "text-sm" : undefined}>
											{isSeller ? t.amendment : t.amendments}:{" "}
											{aftercareState(locale, amendment.state)}
										</p>
									)}
									{isSeller && (
										<Link className={action} prefetch={false} href={href}>
											{sales.view}
											<span className="sr-only">
												{" "}
												· <bdi>{row.number}</bdi>
											</span>
										</Link>
									)}
								</li>
							);
						})}
					</ul>
				) : isSeller ? (
					<SalesEmpty locale={locale}>
						<p className="text-sm text-muted">{t.empty}</p>
					</SalesEmpty>
				) : (
					<p>{t.empty}</p>
				)}
				{data &&
					(isSeller ? (
						<SalesPagination
							locale={locale}
							page={page}
							count={data.count}
							onPage={(next) =>
								router.push(
									salesHref(locale, "aftercare", seller, undefined, undefined, {
										page: String(next),
									}),
								)
							}
						/>
					) : (
						<nav
							className="flex flex-wrap items-center gap-3"
							aria-label={t.history}
						>
							{page > 1 && (
								<Link
									className={action}
									prefetch={false}
									href={aftercareHref(
										locale,
										context,
										undefined,
										seller,
										page - 1,
									)}
								>
									{t.previous}
								</Link>
							)}
							<bdi>{page}</bdi>
							{page * 20 < data.count && (
								<Link
									className={action}
									prefetch={false}
									href={aftercareHref(
										locale,
										context,
										undefined,
										seller,
										page + 1,
									)}
								>
									{t.next}
								</Link>
							)}
						</nav>
					))}
			</div>
		</SalesFrame>
	);
}
