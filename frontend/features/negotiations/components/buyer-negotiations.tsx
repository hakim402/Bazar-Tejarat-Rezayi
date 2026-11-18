"use client";
import Link from "next/link";
import { useState } from "react";
import { Eye, FileText, Plus, ShoppingBag } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Icon } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { localTimestamp } from "../../messaging/api";
import { deliveryListCopy } from "../../fulfilment/list-copy";
import { commerceCopy } from "../../orders/copy";
import { orderListCopy } from "../../orders/list-copy";
import { invoiceHref } from "../../orders/api";
import {
	DetailCard,
	DetailField,
	Money,
	ProductThumbnail,
	ReloadButton,
} from "../../orders/components/order-ui";
import {
	BuyerTableFrame,
	BuyerToolbar,
	BuyerTableRegion,
	BuyerRowMenu,
	buyerRow,
	buyerCell,
} from "../../orders/components/buyer-ui";
import { negotiationCopy } from "../copy";
import { goodsTotal } from "../validation";
import {
	productContext,
	productImage,
	productText,
	type Proposal,
	type RequestRow,
	type Result,
} from "../api";

export function negotiationVariant(state: string) {
	switch (state) {
		case "accepted":
			return "success" as const;
		case "rejected":
			return "danger" as const;
		case "correction_requested":
			return "warning" as const;
		case "submitted":
			return "info" as const;
		default:
			return "neutral" as const;
	}
}

const proposalTotal = (proposal: Proposal) =>
	proposal.goods_total ?? goodsTotal(proposal.lines);

export function NegotiationProducts({
	proposal,
	currency,
	locale,
}: {
	proposal: Proposal;
	currency: string;
	locale: Locale;
}) {
	const c = commerceCopy[locale],
		ol = orderListCopy[locale];
	const line = (item: Proposal["lines"][number], i: number) => {
		const product = productContext(proposal, item.variant, i),
			text = productText(product, locale, item.variant);
		return (
			<div
				key={`${item.variant}:${item.tier}`}
				className="flex min-w-0 items-start gap-3"
			>
				<ProductThumbnail src={productImage(product)} />
				<div className="min-w-0 flex-1">
					<p
						className="m-0 max-w-72 truncate text-sm font-semibold text-foreground"
						title={text.title}
						dir="auto"
					>
						{text.title}
					</p>
					<p className="m-0 mt-1 text-xs text-muted">
						{c[item.tier]} ·{" "}
						<bdi>
							{item.quantity.replace(/\.000$/, "")} {text.unit}
						</bdi>
						<span aria-hidden="true" className="mx-1.5">
							×
						</span>
						<bdi>
							{item.unit_price} {currency}
						</bdi>
					</p>
				</div>
			</div>
		);
	};
	return (
		<div className="min-w-0 space-y-3">
			{proposal.lines.slice(0, 1).map(line)}
			{proposal.lines.length > 1 && (
				<details>
					<summary className="cursor-pointer text-xs font-medium text-action">
						+{new Intl.NumberFormat(locale).format(proposal.lines.length - 1)}{" "}
						{ol.more}
					</summary>
					<div className="mt-3 space-y-3">
						{proposal.lines.slice(1).map(line)}
					</div>
				</details>
			)}
		</div>
	);
}

export function BuyerRequestsList({
	locale,
	rows,
	count,
	page,
	state,
	q,
	busy,
	loading,
	href,
	navigate,
	detailHref,
	newHref,
	onReload,
}: {
	locale: Locale;
	rows: RequestRow[] | null;
	count: number | null;
	page: number;
	state: string;
	q: string;
	busy: boolean;
	loading: boolean;
	href: (page: number, state?: string, q?: string) => string;
	navigate: (href: string) => void;
	detailHref: (row: RequestRow) => string;
	newHref: string;
	onReload: () => void;
}) {
	const t = negotiationCopy[locale],
		c = commerceCopy[locale],
		ol = orderListCopy[locale],
		l = deliveryListCopy[locale],
		[searchDraft, setSearchDraft] = useState(q),
		filtered = Boolean(q || state),
		tabs: [string, string][] = [
			["", t.all],
			["submitted", t.submitted],
			["correction_requested", t.correction_requested],
			["accepted", t.accepted],
			["withdrawn", t.withdrawn],
			["rejected", t.rejected],
		];
	const identity = (row: RequestRow) => (
		<div className="flex min-w-0 flex-col gap-1">
			<Link
				href={detailHref(row)}
				className="max-w-56 truncate text-sm font-semibold text-action no-underline hover:text-foreground"
				dir="auto"
				title={row.seller_name}
			>
				{row.seller_name}
			</Link>
			<time
				dateTime={row.created_at}
				className="block text-xs leading-relaxed text-muted"
			>
				{localTimestamp(row.created_at, locale)}
			</time>
		</div>
	);
	const amount = (row: RequestRow) => (
		<div className="flex flex-col gap-1">
			<p className="m-0 whitespace-nowrap text-sm font-semibold tabular-nums">
				<Money amount={proposalTotal(row.proposal)} currency={row.currency} />
			</p>
			<p className="m-0 text-xs text-muted">
				{c.currency}: <bdi>{row.currency}</bdi>
			</p>
		</div>
	);
	const menu = (row: RequestRow) => (
		<BuyerRowMenu
			locale={locale}
			label={`${ol.actions}: ${row.seller_name}`}
			links={[
				{ href: detailHref(row), label: t.viewRequest, Icon: Eye },
				...(row.order
					? [
							{
								href: `/${locale}/account/buyer/orders/${row.order}`,
								label: t.order,
								Icon: ShoppingBag,
							},
						]
					: []),
				...(row.invoice
					? [
							{
								href: invoiceHref(locale, "buyer", row.invoice),
								label: t.invoice,
								Icon: FileText,
							},
						]
					: []),
			]}
		/>
	);
	return (
		<section className="flex min-w-0 flex-col gap-4">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="m-0 text-2xl font-bold">{t.title}</h1>
					<p className="m-0 mt-1 text-sm text-muted">{t.description}</p>
				</div>
				<Button asChild className="rounded-lg">
					<Link href={newHref}>
						<Plus className="size-4" aria-hidden="true" />
						{t.new}
					</Link>
				</Button>
			</header>
			<BuyerToolbar
				locale={locale}
				tabs={tabs}
				state={state}
				onTab={(value) => navigate(href(1, value, q))}
				searchPlaceholder={t.search}
				searchAction={l.searchAction}
				searchDraft={searchDraft}
				setSearchDraft={setSearchDraft}
				onSearch={() => navigate(href(1, state, searchDraft.trim()))}
				onClear={() => {
					setSearchDraft("");
					navigate(href(1, "", ""));
				}}
			/>
			<BuyerTableFrame
				locale={locale}
				title={t.title}
				count={count}
				page={page}
				onPage={(next) => navigate(href(next))}
				pageHref={href}
				onRefresh={onReload}
				busy={busy || loading}
			>
				{loading ? (
					<p role="status" className="m-0 px-5 py-10 text-sm text-muted">
						{c.loading}
					</p>
				) : !rows?.length ? (
					<div className="px-5 py-6">
						<EmptyState
							borderless
							icon="handshake"
							title={filtered ? sellerSalesCopy[locale].noMatches : t.empty}
							description={
								filtered ? sellerSalesCopy[locale].noMatchesHelp : t.emptyHelp
							}
							action={
								filtered ? undefined : (
									<Button asChild variant="outline" className="rounded-lg">
										<Link href={newHref}>
											<Plus className="size-4" aria-hidden="true" />
											{t.new}
										</Link>
									</Button>
								)
							}
						/>
					</div>
				) : (
					<>
						<BuyerTableRegion
							label={t.title}
							minWidth="64rem"
							head={[t.request, ol.products, t.amount, t.status, ol.actions]}
						>
							{rows.map((row) => (
								<tr key={row.id} className={buyerRow}>
									<td className={buyerCell}>{identity(row)}</td>
									<td className={`${buyerCell} min-w-72`}>
										<NegotiationProducts
											proposal={row.proposal}
											currency={row.currency}
											locale={locale}
										/>
									</td>
									<td className={buyerCell}>{amount(row)}</td>
									<td className={buyerCell}>
										<StatusBadge variant={negotiationVariant(row.state)}>
											{t[row.state]}
										</StatusBadge>
									</td>
									<td className="px-4 py-3 text-end align-top">
										<div className="flex items-center justify-end">
											{menu(row)}
										</div>
									</td>
								</tr>
							))}
						</BuyerTableRegion>
						<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
							{rows.map((row) => (
								<li key={row.id} className="flex flex-col gap-3 p-4">
									<div className="flex items-start justify-between gap-3">
										{identity(row)}
										{menu(row)}
									</div>
									<NegotiationProducts
										proposal={row.proposal}
										currency={row.currency}
										locale={locale}
									/>
									<div className="grid grid-cols-1 gap-3 rounded-xl border border-solid border-border p-3 sm:grid-cols-2">
										{amount(row)}
										<StatusBadge variant={negotiationVariant(row.state)}>
											{t[row.state]}
										</StatusBadge>
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

export function BuyerRequestHeader({
	row,
	locale,
	busy,
	backHref,
	onReload,
	onWithdraw,
	onResubmit,
}: {
	row: RequestRow;
	locale: Locale;
	busy: boolean;
	backHref: string;
	onReload: () => void;
	onWithdraw: (opener: HTMLElement) => void;
	onResubmit: () => void;
}) {
	const t = negotiationCopy[locale],
		c = commerceCopy[locale];
	return (
		<header className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					href={backHref}
					className="inline-flex items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
				>
					<Icon name="arrow" className="size-4 ltr:rotate-180" />
					{t.backToRequests}
				</Link>
				<ReloadButton busy={busy} label={t.reload} onReload={onReload} />
			</div>
			<div className="flex items-start gap-3">
				<span
					className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"
					aria-hidden="true"
				>
					<Icon name="handshake" className="size-5" />
				</span>
				<div className="min-w-0 flex-1 space-y-1">
					<h1 className="m-0 text-page-title font-bold" dir="auto">
						{row.seller_name}
					</h1>
					<p className="m-0 text-sm text-muted">
						{t.submitted}: <bdi>{localTimestamp(row.created_at, locale)}</bdi>
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-1.5">
				<StatusBadge variant={negotiationVariant(row.state)}>
					{t[row.state]}
				</StatusBadge>
				{row.state === "accepted" && row.order && (
					<StatusBadge variant="success">{t.order}</StatusBadge>
				)}
			</div>
			<div className="flex flex-wrap gap-2 text-caption text-muted">
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="wallet" className="size-3.5" />
					{c.currency}: <bdi>{row.currency}</bdi>
				</span>
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="history" className="size-3.5" />
					{t.version}: <bdi>{row.version}</bdi>
				</span>
				<span className="inline-flex items-center gap-1 rounded-control bg-page px-2 py-0.5">
					<Icon name="clock" className="size-3.5" />
					{t.noExpiry}
				</span>
			</div>
			{(row.actions.length > 0 || row.order || row.invoice) && (
				<div className="flex flex-wrap gap-2">
					{row.actions.includes("resubmit") && (
						<Button
							type="button"
							size="sm"
							className="rounded-lg"
							disabled={busy}
							onClick={onResubmit}
						>
							<Icon name="return" className="size-3.5" />
							{t.resubmit}
						</Button>
					)}
					{row.actions.includes("withdraw") && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="rounded-lg border-danger/40 text-danger hover:bg-danger-surface hover:text-danger"
							disabled={busy}
							onClick={(event) => onWithdraw(event.currentTarget)}
						>
							<Icon name="close" className="size-3.5" />
							{t.withdraw}
						</Button>
					)}
					{row.order && (
						<Button asChild variant="outline" size="sm" className="rounded-lg">
							<Link href={`/${locale}/account/buyer/orders/${row.order}`}>
								<ShoppingBag className="size-3.5" />
								{t.order}
							</Link>
						</Button>
					)}
					{row.invoice && (
						<Button asChild variant="outline" size="sm" className="rounded-lg">
							<Link href={invoiceHref(locale, "buyer", row.invoice)}>
								<FileText className="size-3.5" />
								{t.invoice}
							</Link>
						</Button>
					)}
				</div>
			)}
		</header>
	);
}

export function BuyerRequestInfo({
	row,
	locale,
}: {
	row: RequestRow;
	locale: Locale;
}) {
	const t = negotiationCopy[locale],
		c = commerceCopy[locale];
	return (
		<DetailCard title={t.requestDetails} icon="file" compact>
			<dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
				<DetailField label={t.request}>
					<bdi className="break-all text-xs">{row.id}</bdi>
				</DetailField>
				<DetailField label={t.business}>
					<span dir="auto">{row.seller_name}</span>
				</DetailField>
				<DetailField label={t.submitted}>
					<bdi>{localTimestamp(row.created_at, locale)}</bdi>
				</DetailField>
				<DetailField label={t.version}>
					<bdi>{row.version}</bdi>
				</DetailField>
				<DetailField label={c.currency}>
					<bdi>{row.currency}</bdi>
				</DetailField>
				<DetailField label={t.status}>
					<StatusBadge variant={negotiationVariant(row.state)}>
						{t[row.state]}
					</StatusBadge>
				</DetailField>
			</dl>
		</DetailCard>
	);
}

export function BuyerTermsCard({
	proposal,
	locale,
}: {
	proposal: Proposal;
	locale: Locale;
}) {
	const t = negotiationCopy[locale],
		choice = proposal.choice;
	return (
		<DetailCard title={t.terms} icon="truck" compact>
			<dl className="m-0 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
				<DetailField label={t.country}>
					<bdi>{choice.country || "—"}</bdi>
				</DetailField>
				<DetailField label={t.city}>
					<span dir="auto">{choice.city || "—"}</span>
				</DetailField>
				<DetailField label={t.method}>
					{choice.method ? t[choice.method] : t.choose}
				</DetailField>
			</dl>
		</DetailCard>
	);
}

export function BuyerPending({
	locale,
	pendingLabel,
	busy,
	canRetry,
	onRetry,
	onRecover,
}: {
	locale: Locale;
	pendingLabel: string;
	busy: boolean;
	canRetry: boolean;
	onRetry: () => void;
	onRecover: () => void;
}) {
	const t = negotiationCopy[locale];
	return (
		<div
			role="status"
			className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning/40 bg-warning-surface p-4"
		>
			<p className="m-0 flex items-center gap-2 text-sm font-medium text-warning">
				<Icon name="alert-triangle" className="size-4 shrink-0" />
				{pendingLabel}
			</p>
			<div className="flex flex-wrap gap-2">
				{canRetry && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="rounded-lg"
						disabled={busy}
						onClick={onRetry}
					>
						{t.retry}
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					className="rounded-lg"
					disabled={busy}
					onClick={onRecover}
				>
					{t.recover}
				</Button>
			</div>
		</div>
	);
}

export function BuyerResult({
	locale,
	result,
	busy,
	onResume,
}: {
	locale: Locale;
	result: Result;
	busy: boolean;
	onResume: () => void;
}) {
	const t = negotiationCopy[locale],
		c = commerceCopy[locale];
	return (
		<div
			role="status"
			className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
		>
			{result.rejected ? (
				<p className="m-0 flex items-center gap-2 text-sm font-medium text-warning">
					<Icon name="alert-triangle" className="size-4 shrink-0" />
					{t.reload}
				</p>
			) : (
				<>
					{result.state && (
						<p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold">
							<Icon name="check-circle" className="size-4 text-success" />
							{result.state in t ? t[result.state as keyof typeof t] : t.error}
						</p>
					)}
					{result.outcomes?.map((outcome) => (
						<div
							key={outcome.seller}
							className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-solid border-border px-3 py-2"
						>
							<p className="m-0 text-sm">
								{outcome.state === "submitted"
									? t.submitted
									: outcome.state === "pending"
										? t.pending
										: t.error}
								{outcome.code && (
									<span className="text-muted">
										{" · "}
										{c[outcome.code as keyof typeof c] ?? t.error}
									</span>
								)}
							</p>
							{outcome.request && (
								<Button
									asChild
									variant="outline"
									size="sm"
									className="rounded-lg"
								>
									<Link
										href={`/${locale}/account/buyer/negotiations/${outcome.request}`}
									>
										<Eye className="size-3.5" />
										{t.viewRequest}
									</Link>
								</Button>
							)}
						</div>
					))}
					{result.pending && result.id && (
						<Button
							type="button"
							size="sm"
							className="self-start rounded-lg"
							disabled={busy}
							onClick={onResume}
						>
							{c.resume}
						</Button>
					)}
				</>
			)}
		</div>
	);
}
