"use client";
import {
	Download,
	Eye,
	FileText,
	MoreHorizontal,
	Package,
	RefreshCw,
	RotateCcw,
	Truck,
	Wallet,
	ChevronLeft,
	ChevronRight,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
} from "../../../components/shadcn/pagination";
import { useSellerNavigation } from "../../../app/[locale]/(seller)/account/seller/components/seller-navigation";
import { apiOrigin } from "../../../lib/api/client";
import type { Locale } from "../../../lib/i18n/locales";
import { localTimestamp } from "../../messaging/api";
import { paymentState } from "../../payments/copy";
import { fulfilmentState } from "../../fulfilment/copy";
import { salesHref } from "../../sales/components/seller-sales-ui";
import { commerceCopy } from "../copy";
import { orderListCopy } from "../list-copy";
import type { Order, OrderLine } from "../api";

function ProductThumbnail({ src }: { src?: string | null }) {
	const [failed, setFailed] = useState(false);
	return (
		<span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-solid border-border bg-page text-muted">
			{src && !failed ? (
				<Image
					src={apiOrigin(process.env.NEXT_PUBLIC_API_URL) + src}
					alt=""
					fill
					sizes="48px"
					unoptimized
					className="object-cover"
					onError={() => setFailed(true)}
				/>
			) : (
				<Package className="size-5" aria-hidden="true" />
			)}
		</span>
	);
}
function OrderProducts({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderListCopy[locale];
	const line = (item: OrderLine) => (
		<div key={item.id} className="flex min-w-0 items-start gap-3">
			<ProductThumbnail key={item.image} src={item.image} />
			<div className="min-w-0 flex-1">
				<p
					className="m-0 max-w-72 truncate text-sm font-semibold text-foreground"
					title={
						item.snapshot.titles[locale] ??
						item.snapshot.titles[item.snapshot.source_locale]
					}
				>
					{item.snapshot.titles[locale] ??
						item.snapshot.titles[item.snapshot.source_locale] ??
						item.snapshot.sku}
				</p>
				<p className="m-0 mt-1 text-xs text-muted">
					{t.sku}: <bdi>{item.snapshot.sku}</bdi>
				</p>
				<p className="m-0 mt-1 text-xs text-muted">
					<span title={t.quantity}>
						<bdi>{item.quantity.replace(/\.000$/, "")}</bdi>{" "}
						{item.snapshot.unit_labels[locale] ?? item.snapshot.unit}
					</span>
					<span aria-hidden="true" className="mx-1.5">
						×
					</span>
					<span title={t.unitPrice}>
						<bdi>
							{item.unit_price} {order.currency}
						</bdi>
					</span>
				</p>
			</div>
		</div>
	);
	return (
		<div className="min-w-0 space-y-3">
			{order.lines.slice(0, 1).map(line)}
			{order.lines.length > 1 && (
				<details>
					<summary className="cursor-pointer text-xs font-medium text-action">
						+{new Intl.NumberFormat(locale).format(order.lines.length - 1)}{" "}
						{t.more}
					</summary>
					<div className="mt-3 space-y-3">{order.lines.slice(1).map(line)}</div>
				</details>
			)}
		</div>
	);
}
function OrderStatuses({ order, locale }: { order: Order; locale: Locale }) {
	const t = orderListCopy[locale];
	const paid =
		order.dimensions.financial === "paid" ||
		order.dimensions.financial === "settled";
	return (
		<div className="flex flex-col items-start gap-2">
			<span className="sr-only">{t.payment}</span>
			<Badge
				variant="secondary"
				className={`max-w-52 whitespace-normal rounded-full border-0 px-2.5 py-1 text-xs ${paid ? "bg-success-surface text-success" : "bg-info text-action"}`}
			>
				{paymentState(locale, order.dimensions.financial)}
			</Badge>
			<span className="sr-only">{t.shipping}</span>
			<span className="text-xs text-muted">
				{fulfilmentState(locale, order.dimensions.fulfilment)}
			</span>
			{order.dimensions.cancellation === "pending" && (
				<Badge
					variant="secondary"
					className="border-0 bg-warning-surface text-warning"
				>
					{t.cancelHold}
				</Badge>
			)}
			{order.dimensions.dispute === "unresolved" && (
				<Badge
					variant="secondary"
					className="border-0 bg-danger-surface text-danger"
				>
					{t.dispute}
				</Badge>
			)}
		</div>
	);
}
function OrderMenu({
	order,
	locale,
	canInvoice,
	busy,
	onDownload,
}: {
	order: Order;
	locale: Locale;
	canInvoice: boolean;
	busy: boolean;
	onDownload: (order: Order) => void;
}) {
	const t = orderListCopy[locale],
		destinations = useSellerNavigation();
	const links = [
		{
			path: "orders" as const,
			id: order.id,
			label: t.view,
			Icon: Eye,
			show: true,
		},
		{
			path: "invoices" as const,
			id: order.invoice,
			label: t.invoice,
			Icon: FileText,
			show: canInvoice,
		},
		{
			path: "payments" as const,
			id: order.id,
			label: t.payments,
			Icon: Wallet,
			show: destinations?.some((x) => x.route === "payments"),
		},
		{
			path: "fulfilment" as const,
			id: order.id,
			label: t.delivery,
			Icon: Truck,
			show: destinations?.some((x) => x.route === "fulfilment"),
		},
		{
			path: "aftercare" as const,
			id: order.id,
			label: t.aftercare,
			Icon: RotateCcw,
			show: destinations?.some((x) => x.route === "aftercare"),
		},
	];
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`${t.actions}: ${order.number}`}
					title={t.actions}
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
				{links
					.filter((x) => x.show)
					.map(({ path, id, label, Icon }) => (
						<DropdownMenuItem
							key={path}
							asChild
							className="gap-2.5 no-underline"
						>
							<Link href={salesHref(locale, path, order.seller, id)}>
								<Icon aria-hidden="true" />
								{label}
							</Link>
						</DropdownMenuItem>
					))}
				{canInvoice && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={busy}
							className="gap-2.5"
							onSelect={() => onDownload(order)}
						>
							<Download aria-hidden="true" />
							{t.pdf}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
export function SellerOrdersTable({
	orders,
	locale,
	count,
	page,
	canInvoice,
	busy,
	onDownload,
	onPage,
	onRefresh,
	pageHref,
}: {
	orders: Order[];
	locale: Locale;
	count: number;
	page: number;
	canInvoice: boolean;
	busy: boolean;
	onDownload: (order: Order) => void;
	onPage: (page: number) => void;
	onRefresh: () => void;
	pageHref: (page: number) => string;
}) {
	const t = orderListCopy[locale],
		nf = new Intl.NumberFormat(locale),
		last = Math.min(10000, Math.max(1, Math.ceil(count / 20)));
	const customer = (order: Order) => (
		<div className="min-w-0 max-w-56">
			<p className="m-0 text-sm font-medium text-foreground">
				<bdi>{order.customer?.name ?? order.snapshot.buyer}</bdi>
			</p>
			<p className="m-0 mt-1 break-all text-xs text-muted">
				<bdi dir="ltr">{order.customer?.email ?? "—"}</bdi>
			</p>
		</div>
	);
	const amount = (order: Order) => (
		<div className="space-y-1">
			<p className="m-0 whitespace-nowrap text-sm font-semibold tabular-nums">
				<bdi>
					{order.goods_total} {order.currency}
				</bdi>
			</p>
			<p className="m-0 text-xs text-muted">
				{commerceCopy[locale][order.payment_method]}
			</p>
		</div>
	);
	const identity = (order: Order) => (
		<div className="space-y-1.5">
			<Link
				href={salesHref(locale, "orders", order.seller, order.id)}
				className="text-sm font-semibold text-action no-underline hover:text-foreground"
			>
				<bdi>{order.number}</bdi>
			</Link>
			<time
				dateTime={order.accepted_at}
				className="block max-w-36 text-xs leading-relaxed text-muted"
			>
				{localTimestamp(order.accepted_at, locale)}
			</time>
		</div>
	);
	const menu = (order: Order) => (
		<OrderMenu
			order={order}
			locale={locale}
			canInvoice={canInvoice}
			busy={busy}
			onDownload={onDownload}
		/>
	);
	const pages = [
		...new Set(
			[1, page - 1, page, page + 1, last].filter((n) => n >= 1 && n <= last),
		),
	].sort((a, b) => a - b);
	const pageLink = (
		n: number,
		label: string,
		disabled: boolean,
		icon: "previous" | "next",
	) => (
		<PaginationLink
			href={disabled ? undefined : pageHref(n)}
			aria-label={label}
			aria-disabled={disabled || undefined}
			tabIndex={disabled ? -1 : 0}
			className={`size-9 rounded-lg ${disabled ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
			onClick={(e) => {
				e.preventDefault();
				if (!disabled) onPage(n);
			}}
		>
			{icon === "previous" ? (
				<ChevronLeft className="size-4 rtl:rotate-180" />
			) : (
				<ChevronRight className="size-4 rtl:rotate-180" />
			)}
		</PaginationLink>
	);
	return (
		<Card className="gap-0 overflow-hidden rounded-2xl border-border bg-surface py-0 shadow-xs">
			<div className="flex items-center justify-between gap-3 border-b border-solid border-border px-4 py-4 sm:px-5">
				<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
					{commerceCopy[locale].orders}
					<Badge
						variant="secondary"
						className="rounded-full border-0 bg-page text-muted"
					>
						{nf.format(count)}
					</Badge>
				</h2>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={onRefresh}
					className="h-9 rounded-lg text-xs"
				>
					<RefreshCw className="size-3.5" aria-hidden="true" />
					{t.refresh}
				</Button>
			</div>
			{!orders.length ? (
				<div className="px-5 py-12 text-center">
					<Package
						className="mx-auto mb-3 size-8 text-muted"
						aria-hidden="true"
					/>
					<h3 className="m-0 text-base font-semibold">{t.empty}</h3>
					<p className="mt-2 text-sm text-muted">{t.emptyHelp}</p>
					{page > 1 && (
						<Button variant="outline" onClick={() => onPage(1)}>
							{t.page} {nf.format(1)}
						</Button>
					)}
				</div>
			) : (
				<>
					<section
						aria-label={commerceCopy[locale].orders}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: The named overflow region supports keyboard scrolling.
						tabIndex={0}
						className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-action lg:block"
					>
						<table className="w-full min-w-[68rem] border-collapse text-start">
							<caption className="sr-only">
								{commerceCopy[locale].orders}
							</caption>
							<thead>
								<tr className="bg-page/70">
									{[
										t.order,
										t.products,
										t.customer,
										t.total,
										t.status,
										t.actions,
									].map((label, i) => (
										<th
											key={label}
											scope="col"
											className={`border-b border-solid border-border px-5 py-3 text-start text-xs font-medium text-muted ${i === 5 ? "text-end" : ""}`}
										>
											{i === 5 ? (
												<span className="sr-only">{label}</span>
											) : (
												label
											)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{orders.map((order) => (
									<tr
										key={order.id}
										className="border-b border-solid border-border last:border-b-0 hover:bg-page/40"
									>
										<td className="px-5 py-5 align-top">{identity(order)}</td>
										<td className="min-w-72 px-5 py-5 align-top">
											{<OrderProducts order={order} locale={locale} />}
										</td>
										<td className="px-5 py-5 align-top">{customer(order)}</td>
										<td className="px-5 py-5 align-top">{amount(order)}</td>
										<td className="px-5 py-5 align-top">
											{<OrderStatuses order={order} locale={locale} />}
										</td>
										<td className="px-4 py-3 text-end align-top">
											{menu(order)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
						{orders.map((order) => (
							<li key={order.id} className="space-y-4 p-4">
								<div className="flex items-start justify-between gap-3">
									{identity(order)}
									{menu(order)}
								</div>
								<OrderProducts order={order} locale={locale} />
								<div className="grid grid-cols-1 gap-3 rounded-xl bg-page p-3 sm:grid-cols-2">
									{customer(order)}
									{amount(order)}
								</div>
								<OrderStatuses order={order} locale={locale} />
							</li>
						))}
					</ul>
				</>
			)}
			{count > 0 && (
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-solid border-border px-4 py-4 sm:px-5">
					<p className="m-0 text-xs text-muted">
						{orders.length
							? t.showing
									.replace("{start}", nf.format((page - 1) * 20 + 1))
									.replace("{end}", nf.format(Math.min(page * 20, count)))
									.replace("{total}", nf.format(count))
							: `${t.page} ${nf.format(page)}`}
					</p>
					<Pagination aria-label={t.page} className="mx-0 w-auto">
						<PaginationContent className="m-0 list-none p-0">
							<PaginationItem>
								{pageLink(
									Math.max(1, page - 1),
									t.previous,
									page <= 1,
									"previous",
								)}
							</PaginationItem>
							{pages.map((n, index) => (
								<PaginationItem key={n} className="flex items-center gap-1">
									{index > 0 && n - pages[index - 1] > 1 && (
										<span className="px-1 text-muted" aria-hidden="true">
											…
										</span>
									)}
									<PaginationLink
										href={pageHref(n)}
										isActive={n === page}
										aria-label={`${t.page} ${nf.format(n)}`}
										className={`size-9 cursor-pointer rounded-lg ${n === page ? "bg-action text-on-primary hover:bg-action hover:text-on-primary" : ""}`}
										onClick={(e) => {
											e.preventDefault();
											onPage(n);
										}}
									>
										{nf.format(n)}
									</PaginationLink>
								</PaginationItem>
							))}
							<PaginationItem>
								{pageLink(
									Math.min(last, page + 1),
									t.next,
									page >= last,
									"next",
								)}
							</PaginationItem>
						</PaginationContent>
					</Pagination>
				</div>
			)}
		</Card>
	);
}
