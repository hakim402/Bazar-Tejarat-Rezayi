"use client";
import Link from "next/link";
import {
	ChevronLeft,
	ChevronRight,
	MoreHorizontal,
	RefreshCw,
	Search,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { Input } from "../../../components/shadcn/input";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
} from "../../../components/shadcn/pagination";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import { orderListCopy } from "../list-copy";

export function BuyerTableFrame({
	locale,
	title,
	count,
	page,
	pageSize = 20,
	onPage,
	pageHref,
	onRefresh,
	busy,
	children,
}: {
	locale: Locale;
	title: string;
	count: number | null;
	page: number;
	pageSize?: number;
	onPage: (page: number) => void;
	pageHref: (page: number) => string;
	onRefresh: () => void;
	busy: boolean;
	children: ReactNode;
}) {
	const t = orderListCopy[locale],
		nf = new Intl.NumberFormat(locale),
		last = Math.min(10000, Math.max(1, Math.ceil((count ?? 0) / pageSize))),
		current = Math.min(Math.max(1, page), last),
		pages = [
			...new Set(
				[1, current - 1, current, current + 1, last].filter(
					(n) => n >= 1 && n <= last,
				),
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
			onClick={(event) => {
				event.preventDefault();
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
		<Card className={salesTableCard}>
			<div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
				<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
					{title}
					{count !== null && (
						<Badge
							variant="secondary"
							className="rounded-full border-0 bg-page text-muted"
						>
							{nf.format(count)}
						</Badge>
					)}
				</h2>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={onRefresh}
					className="h-9 rounded-lg text-xs"
				>
					<RefreshCw
						className={cn(
							"size-3.5",
							busy && "animate-spin motion-reduce:animate-none",
						)}
						aria-hidden="true"
					/>
					{t.refresh}
				</Button>
			</div>
			{children}
			{count !== null && count > 0 && (
				<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-border px-4 py-4 sm:px-5">
					<p className="m-0 text-xs text-muted">
						{t.showing
							.replace("{start}", nf.format((current - 1) * pageSize + 1))
							.replace("{end}", nf.format(Math.min(current * pageSize, count)))
							.replace("{total}", nf.format(count))}
					</p>
					<Pagination aria-label={t.page} className="mx-0 w-auto">
						<PaginationContent className="m-0 list-none p-0">
							<PaginationItem>
								{pageLink(
									Math.max(1, current - 1),
									t.previous,
									current <= 1,
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
										isActive={n === current}
										aria-label={`${t.page} ${nf.format(n)}`}
										className={`size-9 cursor-pointer rounded-lg ${n === current ? "bg-action text-on-primary hover:bg-action hover:text-on-primary" : ""}`}
										onClick={(event) => {
											event.preventDefault();
											onPage(n);
										}}
									>
										{nf.format(n)}
									</PaginationLink>
								</PaginationItem>
							))}
							<PaginationItem>
								{pageLink(
									Math.min(last, current + 1),
									t.next,
									current >= last,
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

export function BuyerToolbar({
	locale,
	tabs = [],
	state = "",
	onTab,
	searchPlaceholder,
	searchAction,
	searchDraft,
	setSearchDraft,
	onSearch,
	onClear,
}: {
	locale: Locale;
	tabs?: [string, string][];
	state?: string;
	onTab?: (value: string) => void;
	searchPlaceholder: string;
	searchAction: string;
	searchDraft: string;
	setSearchDraft: (value: string) => void;
	onSearch: () => void;
	onClear: () => void;
}) {
	const s = sellerSalesCopy[locale];
	return (
		<section className="flex min-w-0 flex-col gap-3">
			<form
				className="flex flex-wrap items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					onSearch();
				}}
			>
				<div className="relative min-w-0 flex-1 sm:max-w-md">
					<Search
						className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
						aria-hidden="true"
					/>
					<Input
						type="search"
						aria-label={searchPlaceholder}
						placeholder={searchPlaceholder}
						value={searchDraft}
						maxLength={100}
						dir="auto"
						onChange={(event) => setSearchDraft(event.target.value)}
						className="h-10 rounded-xl bg-surface ps-9"
					/>
				</div>
				<Button type="submit" variant="outline" className="h-10 rounded-xl">
					{searchAction}
				</Button>
				{(state || searchDraft) && (
					<Button
						type="button"
						variant="ghost"
						className="h-10 rounded-xl"
						onClick={onClear}
					>
						{s.clear}
					</Button>
				)}
			</form>
			{tabs.length > 0 && (
				<nav
					aria-label={orderListCopy[locale].status}
					className="flex max-w-full gap-1 overflow-x-auto border-0 border-b border-solid border-border"
				>
					{tabs.map(([value, label]) => (
						<button
							key={value}
							type="button"
							aria-current={state === value ? "page" : undefined}
							onClick={() => onTab?.(value)}
							className={cn(
								"shrink-0 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-action",
								state === value
									? "border-action font-semibold text-action"
									: "border-transparent text-muted hover:text-foreground",
							)}
						>
							{label}
						</button>
					))}
				</nav>
			)}
		</section>
	);
}

export function BuyerTableRegion({
	label,
	head,
	minWidth = "68rem",
	children,
}: {
	label: string;
	head: string[];
	minWidth?: string;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={label}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: The named overflow region supports keyboard scrolling.
			tabIndex={0}
			className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-action lg:block"
		>
			<table className="w-full border-collapse text-start" style={{ minWidth }}>
				<caption className="sr-only">{label}</caption>
				<thead>
					<tr className="bg-transparent">
						{head.map((text, index) => (
							<th
								key={text}
								scope="col"
								className={`border-0 border-b border-solid border-border px-5 py-3 text-start text-xs font-medium text-muted ${index === head.length - 1 ? "text-end" : ""}`}
							>
								{index === head.length - 1 ? (
									<span className="sr-only">{text}</span>
								) : (
									text
								)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</section>
	);
}

export const buyerRow =
	"border-0 border-b border-solid border-border last:border-b-0 hover:bg-transparent";
export const buyerCell = "px-5 py-4 align-top";

export function BuyerRowMenu({
	locale,
	label,
	links,
	actions = [],
}: {
	locale: Locale;
	label: string;
	links: { href: string; label: string; Icon: LucideIcon }[];
	actions?: {
		label: string;
		Icon: LucideIcon;
		onSelect: () => void;
		disabled?: boolean;
	}[];
}) {
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={label}
					title={label}
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
				{links.map(({ href, label: text, Icon }) => (
					<DropdownMenuItem key={href} asChild className="gap-2.5 no-underline">
						<Link href={href} prefetch={false}>
							<Icon aria-hidden="true" />
							{text}
						</Link>
					</DropdownMenuItem>
				))}
				{actions.map(({ label: text, Icon, onSelect, disabled }) => (
					<DropdownMenuItem
						key={text}
						disabled={disabled}
						onSelect={onSelect}
						className="gap-2.5"
					>
						<Icon aria-hidden="true" />
						{text}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
