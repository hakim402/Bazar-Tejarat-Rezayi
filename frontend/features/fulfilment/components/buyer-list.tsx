"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, ShoppingBag, Truck, Wallet } from "lucide-react";
import { Icon, type IconName } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { Money } from "../../orders/components/order-ui";
import { cn } from "../../../lib/shadcn-utils";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { paymentHref } from "../../payments/api";
import { aftercareHref } from "../../aftercare/api";
import { orderListCopy } from "../../orders/list-copy";
import {
	BuyerTableFrame,
	BuyerToolbar,
	BuyerTableRegion,
	BuyerRowMenu,
	buyerRow,
	buyerCell,
} from "../../orders/components/buyer-ui";
import { fulfilmentHref } from "../api";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import { deliveryListCopy } from "../list-copy";
import type { Summary } from "../types";
import { stageVariant, completionVariant } from "./buyer-cards";

export function BuyerDeliveries({
	locale,
	seller,
	page,
	state,
	search,
	data,
	error,
	searchDraft,
	setSearchDraft,
	onReload,
}: {
	locale: Locale;
	seller: string;
	page: number;
	state: string;
	search: string;
	data: { count: number; results: Summary[] } | null;
	error: boolean;
	searchDraft: string;
	setSearchDraft: (value: string) => void;
	onReload: () => void;
}) {
	const t = fulfilmentCopy[locale],
		l = deliveryListCopy[locale],
		s = sellerSalesCopy[locale],
		ol = orderListCopy[locale],
		router = useRouter(),
		filtered = Boolean(state || search),
		href = (nextPage: number, nextState = state, nextSearch = search) =>
			fulfilmentHref(
				locale,
				"buyer",
				undefined,
				seller,
				nextPage,
				nextState,
				nextSearch,
			),
		tabs: [string, string][] = [
			["", l.all],
			["not_dispatched", l.pending],
			["dispatched", l.transit],
			["delivered", l.delivered],
			["blocked", l.blocked],
		],
		detailHref = (row: Summary) =>
			fulfilmentHref(locale, "buyer", row.id, seller),
		identity = (row: Summary) => (
			<div className="flex min-w-0 flex-col gap-1">
				<Link
					href={detailHref(row)}
					className="text-sm font-semibold text-action no-underline hover:text-foreground"
				>
					<bdi>{row.number}</bdi>
				</Link>
				<p className="m-0 max-w-44 truncate text-xs text-muted" dir="auto">
					{row.destination.country || row.destination.city ? (
						<>
							<bdi>{row.destination.country ?? ""}</bdi>
							{row.destination.city && (
								<>
									{" · "}
									<bdi>{row.destination.city}</bdi>
								</>
							)}
						</>
					) : (
						"—"
					)}
				</p>
				{row.provider && (
					<p className="m-0 max-w-44 truncate text-xs text-muted" dir="auto">
						{row.provider}
					</p>
				)}
			</div>
		),
		fee = (row: Summary) => (
			<div className="flex flex-col gap-1">
				<p className="m-0 whitespace-nowrap text-sm font-semibold tabular-nums">
					{row.charge === null ? (
						<span className="font-normal text-muted">{l.unset}</span>
					) : (
						<Money amount={row.charge} currency={row.currency} />
					)}
				</p>
				{row.delivery_remaining !== null && (
					<p className="m-0 text-xs text-muted">
						{t.deliveryRemaining}:{" "}
						<Money amount={row.delivery_remaining} currency={row.currency} />
					</p>
				)}
			</div>
		),
		statuses = (row: Summary) => (
			<div className="flex flex-wrap items-center gap-1 lg:flex-nowrap">
				<StatusBadge
					size="sm"
					variant={stageVariant(row.stage)}
					className="shrink-0 whitespace-nowrap"
				>
					{fulfilmentState(locale, row.stage)}
				</StatusBadge>
				{(row.completion === "completed_with_exception" ||
					row.completion === "pending_publication") && (
					<StatusBadge
						size="sm"
						variant={completionVariant(row.completion)}
						className="shrink-0 whitespace-nowrap"
					>
						{fulfilmentState(locale, row.completion)}
					</StatusBadge>
				)}
				{row.overdue && (
					<StatusBadge
						size="sm"
						variant="danger"
						className="shrink-0 whitespace-nowrap"
					>
						{t.overdue}
					</StatusBadge>
				)}
				{row.cancellation_hold && (
					<StatusBadge
						size="sm"
						variant="warning"
						className="shrink-0 whitespace-nowrap"
					>
						{t.cancellation}
					</StatusBadge>
				)}
				{row.dispute_open && (
					<StatusBadge
						size="sm"
						variant="danger"
						className="shrink-0 whitespace-nowrap"
					>
						{t.dispute}
					</StatusBadge>
				)}
			</div>
		),
		menu = (row: Summary) => (
			<BuyerRowMenu
				locale={locale}
				label={`${l.actions}: ${row.number}`}
				links={[
					{
						href: detailHref(row),
						label: l.view,
						Icon: Truck,
					},
					{
						href: paymentHref(locale, "buyer", row.id, seller),
						label: s.payments,
						Icon: Wallet,
					},
					{
						href: `/${locale}/account/buyer/orders/${row.id}`,
						label: ol.view,
						Icon: ShoppingBag,
					},
					{
						href: aftercareHref(locale, "buyer", row.id),
						label: ol.aftercare,
						Icon: RotateCcw,
					},
				]}
			/>
		);
	return (
		<section className="min-w-0 space-y-4">
			<header>
				<h1 className="m-0 text-2xl font-bold">{l.title}</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.intro}</p>
			</header>
			<BuyerToolbar
				locale={locale}
				tabs={tabs}
				state={state}
				onTab={(value) => router.push(href(1, value, search))}
				searchPlaceholder={l.search}
				searchAction={l.searchAction}
				searchDraft={searchDraft}
				setSearchDraft={setSearchDraft}
				onSearch={() => router.push(href(1, state, searchDraft.trim()))}
				onClear={() => {
					setSearchDraft("");
					router.push(href(1, "", ""));
				}}
			/>
			{error && (
				<p
					role="alert"
					className="m-0 rounded-lg border border-solid border-danger bg-danger-surface px-3 py-2 text-sm text-danger"
				>
					{t.error}
				</p>
			)}
			<BuyerTableFrame
				locale={locale}
				title={l.title}
				count={data?.count ?? null}
				page={page}
				onPage={(next) => router.push(href(next))}
				pageHref={href}
				onRefresh={onReload}
				busy={!data && !error}
			>
				{!data && !error ? (
					<p role="status" className="m-0 px-5 py-10 text-sm text-muted">
						{t.loading}
					</p>
				) : data && data.results.length === 0 ? (
					<div className="px-5 py-6">
						<EmptyState
							borderless
							icon="truck"
							title={filtered ? s.noMatches : s.empty}
							description={filtered ? s.noMatchesHelp : s.emptyHelp}
						/>
					</div>
				) : data ? (
					<>
						<BuyerTableRegion
							label={l.title}
							minWidth="64rem"
							head={[l.order, l.progress, l.fee, l.status, l.actions]}
						>
							{data.results.map((row) => (
								<tr key={row.id} className={buyerRow}>
									<td className={buyerCell}>{identity(row)}</td>
									<td className={`${buyerCell} min-w-56`}>
										<CardProgress locale={locale} row={row} />
									</td>
									<td className={buyerCell}>{fee(row)}</td>
									<td className={buyerCell}>{statuses(row)}</td>
									<td className="px-4 py-3 text-end align-top">
										<div className="flex items-center justify-end">
											{menu(row)}
										</div>
									</td>
								</tr>
							))}
						</BuyerTableRegion>
						<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
							{data.results.map((row) => (
								<li key={row.id} className="flex flex-col gap-3 p-4">
									<div className="flex items-start justify-between gap-3">
										{identity(row)}
										{menu(row)}
									</div>
									<CardProgress locale={locale} row={row} />
									<div className="grid grid-cols-1 gap-3 rounded-xl border border-solid border-border p-3 sm:grid-cols-2">
										{fee(row)}
										{statuses(row)}
									</div>
									{row.dispatch_problem && (
										<p
											role="status"
											className="m-0 rounded-lg bg-warning-surface px-2.5 py-1.5 text-caption text-warning"
										>
											{t.lastAttempt}:{" "}
											{fulfilmentState(locale, row.dispatch_problem)}
										</p>
									)}
								</li>
							))}
						</ul>
					</>
				) : null}
			</BuyerTableFrame>
		</section>
	);
}

function CardProgress({ locale, row }: { locale: Locale; row: Summary }) {
	const t = fulfilmentCopy[locale],
		stage = row.stage,
		steps: { label: string; icon: IconName; done: boolean }[] = [
			{
				label: t.preparation,
				icon: "box",
				done: ["prepared", "dispatched", "delivered"].includes(stage),
			},
			{
				label: t.stageDispatch,
				icon: "truck",
				done: ["dispatched", "delivered"].includes(stage),
			},
			{ label: t.delivered, icon: "map-pin", done: stage === "delivered" },
			{
				label: t.completion,
				icon: "check-circle",
				done:
					row.completion === "completed" ||
					row.completion === "completed_with_exception",
			},
		],
		firstOpen = steps.findIndex((step) => !step.done),
		current = firstOpen === -1 ? steps.length - 1 : firstOpen;
	return (
		<ol className="m-0 flex list-none items-start p-0">
			{steps.map((step, i) => {
				const isCurrent = i === current && !step.done,
					last = i === steps.length - 1;
				return (
					<li
						key={step.label}
						className="relative flex flex-1 flex-col items-center gap-1 text-center"
					>
						{!last && (
							<span
								aria-hidden="true"
								className={cn(
									"absolute start-1/2 top-3 z-0 h-0.5 w-full",
									step.done ? "bg-success" : "bg-border",
								)}
							/>
						)}
						<span
							className={cn(
								"relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border",
								step.done
									? "border-success bg-success-surface text-success"
									: isCurrent
										? "border-action bg-info text-action ring-2 ring-action/20"
										: "border-border bg-page text-muted",
							)}
						>
							<Icon name={step.icon} className="size-3" />
						</span>
						<span
							className={cn(
								"block text-[10px] font-medium leading-tight",
								step.done
									? "text-success"
									: isCurrent
										? "text-action"
										: "text-muted",
							)}
						>
							{step.label}
						</span>
					</li>
				);
			})}
		</ol>
	);
}
