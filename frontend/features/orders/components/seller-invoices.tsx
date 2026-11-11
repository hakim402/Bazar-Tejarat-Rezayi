"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, MoreHorizontal, Printer, ShoppingBag } from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { Icon } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { uuidPattern, type QueryReader } from "../../../lib/routes/account-routes";
import { SessionEntry } from "./session-entry";
import { commerce, downloadInvoice, invoiceHref, type Order } from "../api";
import { commerceCopy } from "../copy";
import { orderListCopy } from "../list-copy";
import { paymentCopy, paymentState } from "../../payments/copy";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { useCommunicationSession } from "../../messaging/hooks";
import { localTimestamp } from "../../messaging/api";
import {
	SalesFrame,
	SalesHeader,
	SalesBusinessSelect,
	SalesEmpty,
	SalesPagination,
	salesAction,
	salesControl,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { DetailCard, DetailField, Money } from "./order-ui";
import toast from "react-hot-toast";

type InvoiceProfile = { id: string; name: string; invoices: boolean };

export function SellerInvoices({ locale, id }: { locale: Locale; id?: string }) {
	const session = useCommunicationSession("seller"),
		q = useSearchParams(),
		t = commerceCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return <SessionEntry locale={locale} context="seller" error={session.error} />;
	const seller = q.get("seller") ?? "",
		page = Number(q.get("page") ?? 1),
		state = q.get("state") ?? "",
		search = q.get("q") ?? "";
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000
	)
		return <p role="alert">{t.error}</p>;
	const identity = `${session.session.identity.id}:${session.session.accounts[0].id}`;
	return (
		<Bootstrap
			key={`${identity}:${locale}:${seller}:${id ?? "list"}:${page}:${state}:${search}`}
			{...{ locale, id, seller, page, state, search }}
		/>
	);
}

function Bootstrap({
	locale,
	id,
	seller,
	page,
	state,
	search,
}: {
	locale: Locale;
	id?: string;
	seller: string;
	page: number;
	state: string;
	search: string;
}) {
	const t = commerceCopy[locale],
		q = useSearchParams(),
		router = useRouter(),
		[profiles, setProfiles] = useState<InvoiceProfile[] | null>(null),
		[error, setError] = useState<unknown>(null);
	useEffect(() => {
		const controller = new AbortController();
		let alive = true;
		void commerce<{ results: InvoiceProfile[] }>("orders/seller/profiles/", undefined, "GET", controller.signal)
			.then((p) => {
				if (!alive) return;
				const allowed = p.results.filter((row) => row.invoices);
				setProfiles(allowed);
				if (!seller && !id && allowed[0])
					router.replace(salesHref(locale, "invoices", allowed[0].id));
			})
			.catch((e) => {
				if (alive) setError(e);
			});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [locale, seller, id, router]);
	if (error)
		return (
			<SalesFrame seller>
				<p role="alert" className={salesPanel}>
					{t.error}
				</p>
			</SalesFrame>
		);
	if (!profiles)
		return (
			<SalesFrame seller>
				<p role="status" className={salesPanel}>
					{t.loading}
				</p>
			</SalesFrame>
		);
	if (!profiles.length)
		return (
			<SalesFrame seller>
				<SalesEmpty locale={locale} noBusiness />
			</SalesFrame>
		);
	const business = (
		<SalesBusinessSelect
			locale={locale}
			value={seller}
			profiles={profiles}
			onChange={(chosen) => router.push(salesHref(locale, "invoices", chosen))}
		/>
	);
	return (
		<SalesFrame seller>
			{id ? (
				<InvoiceWorkspace
					key={`${id}:${seller}`}
					locale={locale}
					id={id}
					seller={seller}
					onSeller={(value) => {
						if (!seller)
							router.replace(salesHref(locale, "invoices", value, id));
					}}
				/>
			) : (
				<InvoiceList
					key={`${seller}:${page}:${state}:${search}`}
					locale={locale}
					seller={seller}
					page={page}
					state={state}
					search={search}
					params={q}
					business={business}
				/>
			)}
		</SalesFrame>
	);
}

function StatusPill({ locale, order }: { locale: Locale; order: Order }) {
	return (
		<Badge
			variant="secondary"
			className={cn(
				"whitespace-normal border-0",
				order.payment.financial === "paid"
					? "bg-success-surface text-success"
					: order.payment.overdue
						? "bg-warning-surface text-warning"
						: "bg-info text-action",
			)}
		>
			{paymentState(locale, order.payment.financial)}
		</Badge>
	);
}

function printHref(locale: Locale, order: Order, seller: string) {
	return `${invoiceHref(locale, "seller", order.invoice, seller).split("?")[0]}/print${seller ? `?seller=${seller}` : ""}`;
}

function InvoiceList({
	locale,
	seller,
	page,
	state,
	search,
	params,
	business,
}: {
	locale: Locale;
	seller: string;
	page: number;
	state: string;
	search: string;
	params: QueryReader;
	business: ReactNode;
}) {
	const t = commerceCopy[locale],
		list = orderListCopy[locale],
		sales = sellerSalesCopy[locale],
		nf = new Intl.NumberFormat(locale),
		router = useRouter(),
		[data, setData] = useState<{ count: number; results: Order[] } | null>(null),
		[error, setError] = useState(false),
		[downloading, setDownloading] = useState(false);
	const detailHref = (order: Order) =>
		salesHref(locale, "invoices", seller, order.invoice, params);
	const change = (changes: Record<string, string>) =>
		router.push(salesHref(locale, "invoices", seller, undefined, params, changes));
	useEffect(() => {
		const controller = new AbortController();
		let alive = true;
		setData(null);
		setError(false);
		const query = new URLSearchParams({ page: String(page), q: search, state });
		if (seller) query.set("seller", seller);
		void commerce<{ count: number; results: Order[] }>(
			`orders/seller/invoices/?${query}`,
			undefined,
			"GET",
			controller.signal,
		)
			.then((value) => {
				if (alive) setData(value);
			})
			.catch(() => {
				if (alive) setError(true);
			});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [seller, page, state, search]);
	async function download(order: Order) {
		if (downloading) return;
		const controller = new AbortController();
		setDownloading(true);
		try {
			await downloadInvoice("seller", order.invoice, locale, controller.signal);
			toast.success(list.downloaded);
		} catch {
			toast.error(list.downloadError);
		} finally {
			setDownloading(false);
		}
	}
	return (
		<>
			<SalesHeader locale={locale} section="invoices" seller={seller} business={business} />
			<form
				onSubmit={(e) => {
					e.preventDefault();
					const form = new FormData(e.currentTarget);
					change({ page: "1", q: String(form.get("q") ?? ""), state: String(form.get("state") ?? "") });
				}}
				className={cn(salesPanel, "grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)_auto]")}
			>
				<label className="grid min-w-0 gap-2">
					{list.customer} / {t.invoices}
					<input name="q" className={salesControl} maxLength={100} dir="auto" defaultValue={search} />
				</label>
				<label className="grid min-w-0 gap-2">
					{paymentCopy[locale].title}
					<select name="state" className={salesControl} defaultValue={state}>
						<option value="">{paymentCopy[locale].all}</option>
						{(["unpaid", "partial", "paid", "overpaid", "overdue"] as const).map((v) => (
							<option key={v} value={v}>
								{paymentState(locale, v)}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap gap-2">
					<button type="submit" className={salesAction}>
						{paymentCopy[locale].refresh}
					</button>
					{(search || state || page > 1) && (
						<Link className={salesAction} href={salesHref(locale, "invoices", seller)}>
							{sales.clear}
						</Link>
					)}
				</div>
			</form>
			{error ? (
				<p role="alert" className={salesPanel}>
					{t.error}
				</p>
			) : !data ? (
				<p role="status" className={salesPanel}>
					{t.loading}
				</p>
			) : !data.results.length ? (
				<SalesEmpty locale={locale} filtered={!!search || !!state || page > 1} />
			) : (
				<Card className="gap-0 overflow-hidden rounded-2xl border-border bg-surface py-0 shadow-xs">
					<div className="flex items-center justify-between gap-3 border-b border-solid border-border px-4 py-4 sm:px-5">
						<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
							{t.invoices}
							<Badge variant="secondary" className="rounded-full border-0 bg-page text-muted">
								{nf.format(data.count)}
							</Badge>
						</h2>
					</div>
					<section
						aria-label={t.invoices}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: named overflow region
						tabIndex={0}
						className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-action lg:block"
					>
						<table className="w-full min-w-[58rem] border-collapse text-start">
							<caption className="sr-only">{t.invoices}</caption>
							<thead>
								<tr className="bg-page/70">
									{[t.invoices, list.customer, list.order, list.total, list.status, ""].map((label, i) => (
										<th
											key={`${label}:${i}`}
											scope="col"
											className={cn(
												"border-b border-solid border-border px-4 py-3 text-start text-xs font-medium text-muted",
												i === 5 && "text-end",
											)}
										>
											{i === 5 ? <span className="sr-only">{label}</span> : label}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{data.results.map((order) => (
									<tr key={order.id} className="border-b border-solid border-border last:border-b-0 hover:bg-page/40">
										<td className="px-4 py-4 align-top">
											<Link href={detailHref(order)} className="text-sm font-semibold text-action no-underline">
												<bdi>{order.number}</bdi>
											</Link>
											<time dateTime={order.issued_at} className="mt-1 block max-w-36 text-xs text-muted">
												{localTimestamp(order.issued_at, locale)}
											</time>
										</td>
										<td className="px-4 py-4 align-top">
											<span className="text-sm font-medium" dir="auto">
												{order.snapshot.buyer}
											</span>
										</td>
										<td className="px-4 py-4 align-top">
											<Link className="text-xs font-medium text-action no-underline" href={salesHref(locale, "orders", seller, order.id)}>
												<bdi>{order.id.slice(0, 8)}</bdi>
											</Link>
										</td>
										<td className="px-4 py-4 align-top text-sm tabular-nums">
											<bdi>
												{order.goods_total} {order.currency}
											</bdi>
										</td>
										<td className="px-4 py-4 align-top">
											<StatusPill locale={locale} order={order} />
										</td>
										<td className="px-4 py-3 text-end align-top">
											<RowMenu locale={locale} order={order} seller={seller} busy={downloading} onDownload={() => void download(order)} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
						{data.results.map((order) => (
							<li key={order.id} className="space-y-3 p-4">
								<div className="flex items-start justify-between gap-3">
									<div className="space-y-1">
										<Link href={detailHref(order)} className="text-sm font-semibold text-action no-underline">
											<bdi>{order.number}</bdi>
										</Link>
										<p className="m-0 break-words text-sm" dir="auto">
											{order.snapshot.buyer}
										</p>
									</div>
									<RowMenu locale={locale} order={order} seller={seller} busy={downloading} onDownload={() => void download(order)} />
								</div>
								<div className="flex items-center justify-between gap-3">
									<StatusPill locale={locale} order={order} />
									<span className="text-sm font-semibold tabular-nums">
										<bdi>
											{order.goods_total} {order.currency}
										</bdi>
									</span>
								</div>
							</li>
						))}
					</ul>
					<SalesPagination
						locale={locale}
						page={page}
						count={data.count}
						onPage={(next) => change({ page: String(next) })}
					/>
				</Card>
			)}
		</>
	);
}

function RowMenu({
	locale,
	order,
	seller,
	busy,
	onDownload,
}: {
	locale: Locale;
	order: Order;
	seller: string;
	busy: boolean;
	onDownload: () => void;
}) {
	const t = commerceCopy[locale],
		list = orderListCopy[locale];
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={list.invoice}
					className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
				>
					<MoreHorizontal className="size-5" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={6} className="w-56 rounded-xl p-1.5">
				<DropdownMenuItem disabled={busy} className="gap-2.5" onSelect={onDownload}>
					<Download aria-hidden="true" />
					{list.pdf}
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={printHref(locale, order, seller)}>
						<Printer aria-hidden="true" />
						{t.print}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={salesHref(locale, "orders", seller, order.id)}>
						<ShoppingBag aria-hidden="true" />
						{list.order}
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function InvoiceWorkspace({
	locale,
	id,
	seller,
	onSeller,
}: {
	locale: Locale;
	id: string;
	seller: string;
	onSeller: (value: string) => void;
}) {
	const t = commerceCopy[locale],
		list = orderListCopy[locale],
		[order, setOrder] = useState<Order | null>(null),
		[error, setError] = useState(false),
		[downloading, setDownloading] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		let alive = true;
		void commerce<Order>(`orders/seller/invoices/${id}/?locale=${locale}`, undefined, "GET", controller.signal)
			.then((value) => {
				if (!alive) return;
				setOrder(value);
				onSeller(value.seller);
			})
			.catch(() => {
				if (alive) setError(true);
			});
		return () => {
			alive = false;
			controller.abort();
		};
		// id/locale own this load; onSeller is a stable redirect callback.
	}, [id, locale]);
	async function download(item: Order) {
		if (downloading) return;
		const controller = new AbortController();
		setDownloading(true);
		try {
			await downloadInvoice("seller", item.invoice, locale, controller.signal);
			toast.success(list.downloaded);
		} catch {
			toast.error(list.downloadError);
		} finally {
			setDownloading(false);
		}
	}
	if (error)
		return (
			<p role="alert" className={salesPanel}>
				{t.error}
			</p>
		);
	if (!order)
		return (
			<p role="status" className={salesPanel}>
				{t.loading}
			</p>
		);
	const dest = order.snapshot.terms.destination;
	return (
		<div className="min-w-0 space-y-5">
			<header className="min-w-0 space-y-3">
				<Link
					href={salesHref(locale, "orders", seller, order.id)}
					className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action"
				>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{list.order}
				</Link>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 space-y-1.5">
						<h1 className="text-xl font-bold tracking-tight" tabIndex={-1}>
							{t.invoices} · <bdi>{order.number}</bdi>
						</h1>
						<p className="m-0 text-sm text-muted">
							<span dir="auto">{order.snapshot.buyer}</span> ·{" "}
							<span dir="auto">{order.snapshot.seller}</span>
						</p>
						<p className="m-0 text-xs text-muted">
							{t.issued}: <bdi>{localTimestamp(order.issued_at, locale)}</bdi>
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" className="rounded-xl" disabled={downloading} onClick={() => void download(order)}>
							<Download className="size-4" aria-hidden="true" />
							{list.pdf}
						</Button>
						<Button asChild variant="outline" className="rounded-xl">
							<Link href={printHref(locale, order, seller)} target="_blank" rel="noreferrer">
								<Printer className="size-4" aria-hidden="true" />
								{t.print}
							</Link>
						</Button>
					</div>
				</div>
			</header>

			<DetailCard title={t.invoices} icon="receipt">
				<div className="space-y-4">
					{order.lines.map((line) => {
						const source = line.snapshot.titles[locale] ? locale : line.snapshot.source_locale;
						return (
							<div key={line.id} className="min-w-0 space-y-1 border-b border-solid border-border pb-3 last:border-0 last:pb-0">
								<p className="m-0 break-words text-sm font-semibold" dir="auto">
									{line.snapshot.titles[source] ?? line.snapshot.sku}
								</p>
								<p className="m-0 text-xs text-muted">
									{list.sku}: <bdi>{line.snapshot.sku}</bdi>
									<span className="mx-1.5" aria-hidden="true">·</span>
									{t[line.tier]}
									<span className="mx-1.5" aria-hidden="true">·</span>
									{line.snapshot.unit_labels[locale] ?? line.snapshot.unit}
								</p>
								<dl className="m-0 grid grid-cols-3 gap-3">
									<DetailField label={list.quantity}>
										<bdi>{line.quantity.replace(/\.000$/, "")}</bdi>
									</DetailField>
									<DetailField label={list.unitPrice}>
										<Money amount={line.unit_price} currency={order.currency} />
									</DetailField>
									<DetailField label={t.total}>
										<Money amount={line.goods_amount} currency={order.currency} className="font-semibold" />
									</DetailField>
								</dl>
							</div>
						);
					})}
					<div className="flex items-center justify-between gap-3 border-t border-solid border-border pt-3">
						<span className="text-sm font-medium text-muted">{t.total}</span>
						<Money amount={order.goods_total} currency={order.currency} className="text-lg font-bold" />
					</div>
				</div>
			</DetailCard>

			<section className={salesPanel}>
				<h2 className="m-0 text-sm font-semibold">{paymentCopy[locale].title}</h2>
				<p className="m-0 text-xs text-muted">{paymentCopy[locale].claimNote}</p>
				<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
					<DetailField label={t.method}>{t[order.payment_method]}</DetailField>
					<DetailField label={t.destination}>
						<bdi>{dest.country}</bdi> · <span dir="auto">{dest.city}</span>
					</DetailField>
					<DetailField label={paymentCopy[locale].confirmed}>
						<Money amount={order.payment.confirmed_total} currency={order.currency} />
					</DetailField>
					<DetailField label={paymentCopy[locale].remaining}>
						<Money amount={order.payment.remaining} currency={order.currency} />
					</DetailField>
				</dl>
				<p className="m-0 text-xs text-muted">
					{paymentCopy[locale].title}: {paymentState(locale, order.payment.financial)}
				</p>
			</section>
		</div>
	);
}
