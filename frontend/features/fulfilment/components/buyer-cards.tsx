"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { cn } from "../../../lib/shadcn-utils";
import type { Locale } from "../../../lib/i18n/locales";
import { localTimestamp } from "../../messaging/api";
import { aftercareCopy } from "../../aftercare/copy";
import { aftercareHref } from "../../aftercare/api";
import { paymentHref } from "../../payments/api";
import {
	DetailCard,
	DetailField,
	Money,
	ReloadButton,
} from "../../orders/components/order-ui";
import {
	DetailDialog,
	DialogLink,
} from "../../orders/components/detail-dialog";
import { fulfilment } from "../api";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import type { Context, Detail } from "../types";
import { DeliveryHistory } from "./history";

export function stageVariant(
	stage: string,
): "success" | "accent" | "info" | "warning" | "neutral" {
	switch (stage) {
		case "delivered":
			return "success";
		case "dispatched":
			return "accent";
		case "prepared":
			return "info";
		case "needs_preparation":
			return "warning";
		default:
			return "neutral";
	}
}

export function completionVariant(
	completion: string,
): "success" | "warning" | "info" | "neutral" {
	switch (completion) {
		case "completed":
			return "success";
		case "completed_with_exception":
			return "warning";
		case "pending_publication":
			return "info";
		default:
			return "neutral";
	}
}

export function BuyerDeliveryHeader({
	locale,
	row,
	back,
	busy,
	onReload,
	actions,
}: {
	locale: Locale;
	row: Detail;
	back: string;
	busy: boolean;
	onReload: () => void;
	actions?: ReactNode;
}) {
	const t = fulfilmentCopy[locale],
		a = aftercareCopy[locale],
		dest = row.destination;
	return (
		<header className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					href={back}
					className="inline-flex items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
				>
					<Icon name="arrow" className="size-4 ltr:rotate-180" />
					{t.buyerTitle}
				</Link>
				<ReloadButton busy={busy} label={t.refresh} onReload={onReload} />
			</div>
			<div className="flex items-start gap-3">
				<span
					className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"
					aria-hidden="true"
				>
					<Icon name="truck" className="size-5" />
				</span>
				<div className="min-w-0 flex-1 space-y-1">
					<h1
						className="m-0 text-page-title font-bold"
						tabIndex={-1}
						data-fulfilment-summary
					>
						<bdi>{row.number}</bdi>
					</h1>
					<p className="m-0 text-sm text-muted" dir="auto">
						<bdi>{dest.country ?? ""}</bdi>
						{dest.city && (
							<>
								{" · "}
								<bdi>{dest.city}</bdi>
							</>
						)}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-1.5">
				<StatusBadge variant={stageVariant(row.stage)}>
					{fulfilmentState(locale, row.stage)}
				</StatusBadge>
				<StatusBadge variant={completionVariant(row.completion)}>
					{fulfilmentState(locale, row.completion)}
				</StatusBadge>
				{row.cancellation_hold && (
					<StatusBadge variant="warning">{t.cancellation}</StatusBadge>
				)}
				{row.dispute_open && (
					<StatusBadge variant="danger">{t.dispute}</StatusBadge>
				)}
				{row.overdue && <StatusBadge variant="danger">{t.overdue}</StatusBadge>}
			</div>
			<div className="flex flex-wrap gap-2 text-caption text-muted">
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="wallet" className="size-3.5" />
					{fulfilmentState(locale, row.payment_method)}
				</span>
				{row.provider && (
					<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
						<Icon name="truck" className="size-3.5" />
						<span dir="auto">{row.provider}</span>
					</span>
				)}
				{row.completed_at && (
					<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
						<Icon name="clock" className="size-3.5" />
						<bdi>{localTimestamp(row.completed_at, locale)}</bdi>
					</span>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				<DialogLink
					href={paymentHref(locale, "buyer", row.id, row.seller)}
					icon="wallet"
				>
					{t.title}
				</DialogLink>
				{row.capabilities.invoice && (
					<DialogLink
						href={aftercareHref(locale, "buyer", row.id, row.seller)}
						icon="return"
					>
						{a.openWorkspace}
					</DialogLink>
				)}
				{actions}
			</div>
		</header>
	);
}

export function BuyerDeliveryProgress({
	locale,
	row,
}: {
	locale: Locale;
	row: Detail;
}) {
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
		current = firstOpen === -1 ? steps.length - 1 : firstOpen,
		hold = row.cancellation_hold
			? t.cancellation
			: row.dispute_open
				? t.dispute
				: null;
	return (
		<DetailCard title={t.deliveryProgress} icon="truck" compact>
			{hold && (
				<p className="m-0 rounded-lg bg-warning-surface px-3 py-2 text-caption text-warning">
					{hold}
				</p>
			)}
			<ol className="m-0 flex list-none flex-col p-0 sm:flex-row sm:items-start">
				{steps.map((step, i) => {
					const isCurrent = i === current && !step.done,
						last = i === steps.length - 1;
					return (
						<li
							key={step.label}
							className="relative flex flex-1 items-start gap-3 pb-4 last:pb-0 sm:flex-col sm:items-center sm:gap-1.5 sm:pb-0 sm:text-center"
						>
							{!last && (
								<span
									aria-hidden="true"
									className={cn(
										"absolute z-0 start-[15px] top-8 bottom-0 w-0.5 sm:start-1/2 sm:top-[15px] sm:bottom-auto sm:h-0.5 sm:w-full",
										step.done ? "bg-success" : "bg-border",
									)}
								/>
							)}
							<span
								className={cn(
									"relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
									step.done
										? "border-success bg-success-surface text-success"
										: isCurrent
											? "border-action bg-info text-action ring-2 ring-action/20"
											: "border-border bg-page text-muted",
								)}
							>
								<Icon name={step.icon} className="size-4" />
							</span>
							<span className="min-w-0 flex-1 sm:w-full sm:flex-none">
								<span
									className={cn(
										"block text-xs font-medium leading-tight",
										step.done
											? "text-success"
											: isCurrent
												? "text-action"
												: "text-muted",
									)}
								>
									{step.label}
								</span>
								<span className="sr-only">
									{step.done ? t.completed : isCurrent ? t.pendingReview : ""}
								</span>
							</span>
						</li>
					);
				})}
			</ol>
		</DetailCard>
	);
}

export function BuyerMoneyCard({
	locale,
	row,
	seller,
}: {
	locale: Locale;
	row: Detail;
	seller: string;
}) {
	const t = fulfilmentCopy[locale],
		a = aftercareCopy[locale],
		chargeLabel =
			row.charge === null
				? t.unknownCharge
				: row.charge === "0.00"
					? t.zero
					: row.delivery_settled
						? t.settled
						: t.unsettled,
		charge =
			row.charge === null ? (
				<span className="text-warning">{t.unknownCharge}</span>
			) : (
				<>
					<Money amount={row.charge} currency={row.currency} />
					<span className="ms-2 text-xs text-muted">({chargeLabel})</span>
				</>
			),
		amount = (value: string | null) =>
			value === null ? (
				<span className="text-warning">{t.unknownCharge}</span>
			) : (
				<Money amount={value} currency={row.currency} />
			);
	return (
		<DetailCard title={t.finalCharge} icon="wallet" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={t.finalCharge}>{charge}</DetailField>
				<DetailField label={t.deliveryRemaining}>
					{amount(row.delivery_remaining)}
				</DetailField>
				<DetailField label={t.goodsRemaining}>
					<Money amount={row.goods_remaining} currency={row.currency} />
				</DetailField>
				<DetailField label={t.completion}>
					{fulfilmentState(locale, row.completion)}
				</DetailField>
			</dl>
			<DetailDialog
				locale={locale}
				icon="wallet"
				label={t.moneyDetails}
				title={t.moneyDetails}
				wide
				footer={
					<DialogLink
						href={paymentHref(locale, "buyer", row.id, seller)}
						icon="wallet"
					>
						{t.title}
					</DialogLink>
				}
			>
				<div className="flex flex-col gap-3">
					<h3 className="m-0 text-xs font-semibold text-muted">{t.title}</h3>
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={t.total}>
							<Money amount={row.goods_total} currency={row.currency} />
						</DetailField>
						<DetailField label={t.goodsConfirmed}>
							<Money amount={row.goods_confirmed} currency={row.currency} />
						</DetailField>
						<DetailField label={t.goodsRemaining}>
							<Money amount={row.goods_remaining} currency={row.currency} />
						</DetailField>
						<DetailField label={t.allocation}>
							{fulfilmentState(locale, row.allocation)}
						</DetailField>
					</dl>
				</div>
				<div className="flex flex-col gap-3">
					<h3 className="m-0 text-xs font-semibold text-muted">
						{t.finalCharge}
					</h3>
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={t.finalCharge}>{charge}</DetailField>
						<DetailField label={t.deliveryConfirmed}>
							<Money amount={row.delivery_confirmed} currency={row.currency} />
						</DetailField>
						<DetailField label={a.providerRefunded}>
							<Money amount={row.delivery_refunded} currency={row.currency} />
						</DetailField>
						<DetailField label={t.deliveryRemaining}>
							{amount(row.delivery_remaining)}
						</DetailField>
						<DetailField label={t.deliveryExcess}>
							{amount(row.delivery_excess)}
						</DetailField>
						<DetailField label={t.provider}>
							<span dir="auto">{row.provider || "—"}</span>
						</DetailField>
						<DetailField label={t.chargePayee}>
							<span dir="auto">{row.charge_provider || "—"}</span>
						</DetailField>
						<DetailField label={t.method}>
							{fulfilmentState(locale, row.payment_method)}
						</DetailField>
					</dl>
					<p className="m-0 text-sm font-medium">{chargeLabel}</p>
				</div>
				<p className="m-0 text-xs leading-relaxed text-muted">{t.noAuto}</p>
			</DetailDialog>
		</DetailCard>
	);
}

export function BuyerRecipientCard({
	locale,
	row,
}: {
	locale: Locale;
	row: Detail;
}) {
	const t = fulfilmentCopy[locale],
		recipient = row.recipient;
	if (!recipient) return null;
	return (
		<DetailCard title={t.recipient} icon="user-circle" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={t.recipientName}>
					<span dir="auto">{recipient.name}</span>
				</DetailField>
				<DetailField label={t.phone}>
					<bdi>{recipient.phone}</bdi>
				</DetailField>
			</dl>
			<DetailDialog
				locale={locale}
				icon="user-circle"
				label={t.recipientDetails}
				title={t.recipient}
			>
				<p className="m-0 text-xs leading-relaxed text-muted">{t.privacy}</p>
				<dl className="m-0 grid gap-3 sm:grid-cols-2">
					<DetailField label={t.revision}>
						<bdi>{recipient.revision}</bdi>
					</DetailField>
					<DetailField label={t.recipientName}>
						<span dir="auto">{recipient.name}</span>
					</DetailField>
					<DetailField label={t.phone}>
						<bdi>{recipient.phone}</bdi>
					</DetailField>
				</dl>
				<div className="space-y-1">
					<p className="m-0 text-xs font-medium text-muted">{t.address}</p>
					<p className="m-0 break-words whitespace-pre-wrap text-sm">
						{recipient.address}
					</p>
				</div>
				{recipient.instructions && (
					<div className="flex flex-col gap-1">
						<p className="m-0 text-xs font-medium text-muted">
							{t.instructions}
						</p>
						<p className="m-0 break-words whitespace-pre-wrap text-sm">
							{recipient.instructions}
						</p>
					</div>
				)}
				<p className="m-0 text-xs text-muted">{t.unchangedDestination}</p>
			</DetailDialog>
		</DetailCard>
	);
}

export function BuyerArrangementCard({
	locale,
	row,
}: {
	locale: Locale;
	row: Detail;
}) {
	const t = fulfilmentCopy[locale],
		arrangement = row.arrangement;
	if (!arrangement) return null;
	return (
		<DetailCard title={t.arrangement} icon="truck" compact>
			<dl className="m-0 grid gap-3 sm:grid-cols-2">
				<DetailField label={t.provider}>
					<span dir="auto">{arrangement.provider}</span>
				</DetailField>
				<DetailField label={t.arranger}>
					{fulfilmentState(locale, arrangement.arranger)}
				</DetailField>
			</dl>
			{row.stage === "needs_preparation" && (
				<p
					role="status"
					className="m-0 rounded-lg bg-warning-surface px-3 py-2 text-caption text-warning"
				>
					{t.needPreparation}
				</p>
			)}
			<DetailDialog
				locale={locale}
				icon="truck"
				label={t.arrangementDetails}
				title={t.arrangement}
			>
				<dl className="m-0 grid gap-3 sm:grid-cols-2">
					<DetailField label={t.arranger}>
						{fulfilmentState(locale, arrangement.arranger)}
					</DetailField>
					<DetailField label={t.provider}>
						<span dir="auto">{arrangement.provider}</span>
					</DetailField>
					{row.preparation && (
						<DetailField label={t.preparedFor}>
							<bdi>{row.preparation.recipient_revision}</bdi>
						</DetailField>
					)}
				</dl>
				{arrangement.instructions && (
					<div className="flex flex-col gap-1">
						<p className="m-0 text-xs font-medium text-muted">
							{t.instructions}
						</p>
						<p className="m-0 break-words whitespace-pre-wrap text-sm">
							{arrangement.instructions}
						</p>
					</div>
				)}
				{row.stage === "needs_preparation" && (
					<p role="status" className="m-0 text-sm text-warning">
						{t.needPreparation}
					</p>
				)}
				{(row.stage === "dispatched" || row.stage === "delivered") && (
					<p className="m-0 text-xs text-muted">{t.providerFrozen}</p>
				)}
			</DetailDialog>
		</DetailCard>
	);
}

export function BuyerDeliveryHistory({
	locale,
	context,
	row,
	seller,
}: {
	locale: Locale;
	context: Context;
	row: Detail;
	seller: string;
}) {
	const t = fulfilmentCopy[locale],
		basePage = row.history_page || 1,
		[page, setPage] = useState(basePage),
		[paged, setPaged] = useState<Detail | null>(null),
		[error, setError] = useState(false),
		[loading, setLoading] = useState(false);
	useEffect(() => {
		if (page === basePage) {
			setPaged(null);
			setError(false);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		fulfilment<Detail>(
			context,
			`orders/${row.id}/?page=${page}${seller ? `&seller=${seller}` : ""}`,
			undefined,
			controller.signal,
		)
			.then((value) => {
				if (controller.signal.aborted) return;
				setPaged(value);
				setError(false);
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				setError(true);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [page, basePage, context, row.id, seller]);
	const shown = page === basePage ? row : (paged ?? row);
	return (
		<DetailCard title={t.history} icon="history" compact>
			<p className="m-0 text-xs text-muted">{t.historyHelp}</p>
			<DetailDialog
				locale={locale}
				icon="history"
				label={t.historyDetails}
				title={t.history}
				wide
			>
				{loading && (
					<p role="status" className="m-0 text-xs text-muted">
						{t.loading}
					</p>
				)}
				{error && (
					<p role="alert" className="m-0 text-sm text-danger">
						{t.error}
					</p>
				)}
				<DeliveryHistory
					locale={locale}
					context={context}
					row={shown}
					seller={seller}
					page={page}
					onPage={setPage}
				/>
			</DetailDialog>
		</DetailCard>
	);
}
