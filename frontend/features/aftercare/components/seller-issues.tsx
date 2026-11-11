"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
	FileText,
	MoreHorizontal,
	Receipt as ReceiptIcon,
	ShieldX,
	ShoppingBag,
} from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { useVisiblePoll, accessLost } from "../../messaging/hooks";
import { localTimestamp } from "../../messaging/api";
import {
	SalesFrame,
	SalesHeader,
	SalesEmpty,
	SalesPagination,
	salesAction,
	salesControl,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { aftercare, disputeHref } from "../api";
import { aftercareCopy, aftercareState } from "../copy";
import { sellerAftercareCopy } from "../seller-copy";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import type { components } from "../../../lib/api/schema";

type QueueIssue = components["schemas"]["SellerIssueRow"];
type Kind = QueueIssue["kind"];
type Tab =
	| "attention"
	| "cancellations"
	| "corrections"
	| "refunds"
	| "disputes";

type Issue = QueueIssue & { href: string };

export function SellerIssues({
	locale,
	seller,
	page,
	search,
	initialTab,
}: {
	locale: Locale;
	seller: string;
	page: number;
	search: string;
	initialTab: Tab;
}) {
	const t = sellerAftercareCopy[locale],
		sales = aftercareCopy[locale],
		clear = sellerSalesCopy[locale].clear,
		params = useSearchParams(),
		router = useRouter(),
		tab = initialTab,
		[data, setData] = useState<components["schemas"]["SellerIssuePage"] | null>(
			null,
		),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[revision, setRevision] = useState(0);
	useVisiblePoll(
		async (signal) => {
			try {
				const query = new URLSearchParams({
					page: String(page),
					q: search,
					tab,
				});
				if (seller) query.set("seller", seller);
				const result = await aftercare<
					components["schemas"]["SellerIssuePage"]
				>("orders", "seller", `issues/?${query}`, undefined, signal);
				if (signal.aborted) return;
				setData(result);
				setError(false);
			} catch (e) {
				if (signal.aborted) return;
				setError(true);
				if (accessLost(e)) {
					setData(null);
					setDenied(true);
				}
				throw e;
			}
		},
		[seller, page, search, tab, revision, denied],
		!denied,
	);
	if (denied) return <p role="alert">{sales.noAccess}</p>;
	const shown: Issue[] = (data?.results ?? []).map((issue) => ({
		...issue,
		href: issue.dispute_id
			? disputeHref(locale, "seller", issue.dispute_id, issue.order.seller)
			: salesHref(
					locale,
					"aftercare",
					issue.order.seller,
					issue.order.id,
					params,
					{
						page: String(page),
						q: search,
						issue_tab: tab,
					},
				),
	}));
	const tabList: [Tab, string][] = [
		["attention", t.attention],
		["cancellations", t.cancellations],
		["corrections", t.corrections],
		["refunds", t.refunds],
		["disputes", t.disputes],
	];
	function typeLabel(kind: Kind) {
		return {
			cancellation: t.typeCancellation,
			correction: t.typeCorrection,
			refund_due: t.typeRefundDue,
			refund_report: t.typeRefundReport,
			delivery_refund: t.typeDeliveryRefund,
			dispute: t.typeDispute,
		}[kind];
	}
	function statusLabel(issue: Issue) {
		if (issue.kind === "refund_due")
			return issue.state === "confirmed"
				? t.refundConfirmed
				: issue.state === "reported"
					? t.refundReported
					: t.refundRequired;
		if (issue.kind === "refund_report" || issue.kind === "delivery_refund")
			return issue.state === "confirmed"
				? t.refundConfirmed
				: issue.state === "pending"
					? t.refundReported
					: aftercareState(locale, issue.state);
		return aftercareState(locale, issue.state);
	}
	function actionLabel(issue: Issue) {
		if (issue.kind === "dispute" && issue.actionable)
			return t.actionRespondDispute;
		if (issue.kind === "refund_due" && issue.actionable)
			return t.actionReportRefund;
		if (issue.kind === "refund_report" && issue.actionable)
			return t.actionWithdraw;
		if (
			(issue.kind === "cancellation" || issue.kind === "correction") &&
			issue.state === "pending"
		)
			return t.actionAwaitReview;
		return t.actionView;
	}
	function amountLabel(issue: Issue) {
		if (issue.amount === null) return "—";
		return `${issue.amount} ${issue.order.currency}`;
	}
	return (
		<SalesFrame seller>
			<SalesHeader
				locale={locale}
				section="aftercare"
				title={t.title}
				seller={seller}
				business={
					<Link className={salesAction} href={salesHref(locale, "aftercare")}>
						{sales.allBusinesses}
					</Link>
				}
			/>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					const form = new FormData(e.currentTarget);
					router.push(
						salesHref(locale, "aftercare", seller, undefined, params, {
							page: "1",
							q: String(form.get("q") ?? ""),
						}),
					);
				}}
				className={cn(salesPanel, "flex flex-wrap items-end gap-3")}
			>
				<label className="grid min-w-0 flex-1 gap-2">
					{t.search}
					<input
						name="q"
						className={salesControl}
						maxLength={100}
						dir="auto"
						defaultValue={search}
					/>
				</label>
				<button type="submit" className={salesAction}>
					{t.search}
				</button>
				{(search || page > 1) && (
					<Link
						className={salesAction}
						href={salesHref(locale, "aftercare", seller)}
					>
						{clear}
					</Link>
				)}
			</form>
			<nav
				aria-label={t.title}
				className="flex flex-wrap gap-1 border-b border-solid border-border"
			>
				{tabList.map(([id, label]) => (
					<button
						key={id}
						type="button"
						aria-current={tab === id ? "page" : undefined}
						onClick={() =>
							router.push(
								salesHref(locale, "aftercare", seller, undefined, params, {
									issue_tab: id,
									page: "1",
								}),
							)
						}
						className={cn(
							"-mb-px inline-flex min-h-11 items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold transition-colors motion-reduce:transition-none",
							tab === id
								? "border-border bg-surface text-action"
								: "border-transparent bg-transparent text-muted hover:text-foreground",
						)}
					>
						{label}
					</button>
				))}
			</nav>
			{error ? (
				<section role="alert" className={salesPanel}>
					<p className="m-0 text-sm">{t.error}</p>
					<Button
						variant="outline"
						onClick={() => setRevision((value) => value + 1)}
					>
						{sales.refresh}
					</Button>
				</section>
			) : !data ? (
				<p role="status" className={salesPanel}>
					{t.loading}
				</p>
			) : shown.length === 0 ? (
				<SalesEmpty locale={locale} filtered={!!search}>
					<p className="text-sm text-muted">
						{tab === "attention"
							? t.attentionEmpty
							: search
								? t.emptyFiltered
								: t.empty}
					</p>
				</SalesEmpty>
			) : (
				<Card className="gap-0 overflow-hidden rounded-2xl border-border bg-surface py-0 shadow-xs">
					<section
						aria-label={t.title}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: named overflow region
						tabIndex={0}
						className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-action lg:block"
					>
						<table className="w-full min-w-[60rem] border-collapse text-start">
							<caption className="sr-only">{t.title}</caption>
							<thead>
								<tr className="bg-page/70">
									{[
										t.order,
										t.customer,
										t.type,
										t.amount,
										t.date,
										t.status,
										t.nextAction,
										"",
									].map((label, i) => (
										<th
											key={label}
											scope="col"
											className={cn(
												"border-b border-solid border-border px-4 py-3 text-start text-xs font-medium text-muted",
												i === 7 && "text-end",
											)}
										>
											{i === 7 ? (
												<span className="sr-only">{label}</span>
											) : (
												label
											)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{shown.map((issue) => (
									<tr
										key={issue.key}
										className="border-b border-solid border-border last:border-b-0 hover:bg-page/40"
									>
										<td className="px-4 py-4 align-top">
											<Link
												href={issue.href}
												className="text-sm font-semibold text-action no-underline"
											>
												<bdi>{issue.order.number}</bdi>
											</Link>
										</td>
										<td className="px-4 py-4 align-top">
											<span className="text-sm font-medium" dir="auto">
												{issue.order.buyer_name}
											</span>
										</td>
										<td className="px-4 py-4 align-top text-sm">
											{typeLabel(issue.kind)}
										</td>
										<td className="px-4 py-4 align-top text-sm tabular-nums">
											<bdi>{amountLabel(issue)}</bdi>
										</td>
										<td className="px-4 py-4 align-top text-xs text-muted">
											<bdi>{localTimestamp(issue.date, locale)}</bdi>
										</td>
										<td className="px-4 py-4 align-top">
											<Badge
												variant="secondary"
												className={cn(
													"whitespace-normal border-0",
													statusTone(issue.state),
												)}
											>
												{statusLabel(issue)}
											</Badge>
										</td>
										<td className="px-4 py-4 align-top">
											<Link className={salesAction} href={issue.href}>
												{actionLabel(issue)}
											</Link>
										</td>
										<td className="px-4 py-3 text-end align-top">
											<IssueMenu locale={locale} issue={issue} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
						{shown.map((issue) => (
							<li key={issue.key} className="space-y-3 p-4">
								<div className="flex items-start justify-between gap-3">
									<div className="space-y-1">
										<Link
											href={issue.href}
											className="text-sm font-semibold text-action no-underline"
										>
											<bdi>{issue.order.number}</bdi>
										</Link>
										<p className="m-0 text-sm" dir="auto">
											{issue.order.buyer_name}
										</p>
									</div>
									<IssueMenu locale={locale} issue={issue} />
								</div>
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<span className="font-medium">{typeLabel(issue.kind)}</span>
									<Badge
										variant="secondary"
										className={cn(
											"whitespace-normal border-0",
											statusTone(issue.state),
										)}
									>
										{statusLabel(issue)}
									</Badge>
									<span className="tabular-nums">
										<bdi>{amountLabel(issue)}</bdi>
									</span>
								</div>
								<Link className={salesAction} href={issue.href}>
									{actionLabel(issue)}
								</Link>
							</li>
						))}
					</ul>
				</Card>
			)}
			{data && !error && (
				<SalesPagination
					locale={locale}
					page={page}
					count={data.count}
					onPage={(next) =>
						router.push(
							salesHref(locale, "aftercare", seller, undefined, params, {
								page: String(next),
							}),
						)
					}
				/>
			)}
		</SalesFrame>
	);
}

function statusTone(state: string) {
	return state === "approved" || state === "confirmed"
		? "bg-success-surface text-success"
		: state === "rejected" || state === "dismissed"
			? "bg-danger-surface text-danger"
			: state === "withdrawn" || state === "resolved_non_monetary"
				? "bg-page text-muted"
				: "bg-info text-action";
}

function IssueMenu({ locale, issue }: { locale: Locale; issue: Issue }) {
	const t = sellerAftercareCopy[locale],
		sales = aftercareCopy[locale];
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t.openIssue}
					className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
				>
					<MoreHorizontal className="size-5" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className="w-56 rounded-xl p-1.5"
			>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={issue.href}>
						<FileText aria-hidden="true" />
						{t.openIssue}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link
						href={salesHref(
							locale,
							"orders",
							issue.order.seller,
							issue.order.id,
						)}
					>
						<ShoppingBag aria-hidden="true" />
						{t.openOrder}
					</Link>
				</DropdownMenuItem>
				{issue.kind === "dispute" && issue.dispute_id && (
					<DropdownMenuItem asChild className="gap-2.5 no-underline">
						<Link
							href={disputeHref(
								locale,
								"seller",
								issue.dispute_id,
								issue.order.seller,
							)}
						>
							<ShieldX aria-hidden="true" />
							{sales.disputes}
						</Link>
					</DropdownMenuItem>
				)}
				{(issue.kind === "refund_due" ||
					issue.kind === "refund_report" ||
					issue.kind === "delivery_refund") && (
					<DropdownMenuItem asChild className="gap-2.5 no-underline">
						<Link
							href={salesHref(
								locale,
								"payments",
								issue.order.seller,
								issue.order.id,
							)}
						>
							<ReceiptIcon aria-hidden="true" />
							{t.openPayments}
						</Link>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
