"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { SellerSelect } from "../../../app/[locale]/(seller)/account/seller/components/seller-select";
import { useSellerNavigation } from "../../../app/[locale]/(seller)/account/seller/components/seller-navigation";
import { Icon, type IconName } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import {
	sellerHref,
	type QueryReader,
} from "../../../lib/routes/account-routes";

export type SalesSection =
	| "orders"
	| "negotiations"
	| "fulfilment"
	| "aftercare"
	| "invoices"
	| "payments";
const sections: { key: SalesSection; icon: IconName }[] = [
	{ key: "orders", icon: "shopping-bag" },
	{ key: "negotiations", icon: "handshake" },
	{ key: "fulfilment", icon: "truck" },
	{ key: "aftercare", icon: "return" },
	{ key: "invoices", icon: "receipt" },
	{ key: "payments", icon: "wallet" },
];
const filters: Record<SalesSection, readonly string[]> = {
	orders: ["page"],
	invoices: ["page", "state", "q"],
	aftercare: ["page", "q", "issue_tab"],
	negotiations: ["page", "state", "q"],
	fulfilment: ["page", "state", "q"],
	payments: ["page", "state", "q"],
};

export function salesHref(
	locale: Locale,
	section: SalesSection,
	seller = "",
	id?: string,
	params?: QueryReader,
	changes: Record<string, string> = {},
) {
	const query = new URLSearchParams();
	if (seller) query.set("seller", seller);
	for (const key of filters[section]) {
		const value =
			changes[key] ?? params?.get(`list_${key}`) ?? params?.get(key);
		if (
			!value ||
			(key === "page" &&
				(!/^\d+$/.test(value) || Number(value) <= 1 || Number(value) > 10000))
		)
			continue;
		query.set(
			id ? `list_${key}` : key,
			key === "q" ? value.slice(0, 100) : value,
		);
	}
	return `${sellerHref(locale, `${section}${id ? `/${id}` : ""}`)}${query.size ? `?${query}` : ""}`;
}

export function salesHistoryHref(href: string, params: QueryReader) {
	const [path, search = ""] = href.split("?");
	const query = new URLSearchParams(search);
	for (const key of ["list_page", "list_state", "list_q", "list_issue_tab"]) {
		const value = params.get(key);
		if (value) query.set(key, value);
	}
	return `${path}${query.size ? `?${query}` : ""}`;
}

export const salesAction =
	"inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-action shadow-sm transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
export const salesControl =
	"min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2 text-base text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50";
export const salesPanel =
	"min-w-0 space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6";

export function SalesFrame({
	seller,
	children,
}: {
	seller: boolean;
	children: ReactNode;
}) {
	return seller ? (
		<div
			data-seller-sales
			className="min-w-0 space-y-6 [&_label]:text-sm [&_label]:font-medium [&_input:not([type=checkbox]):not([type=radio])]:min-h-11 [&_input:not([type=checkbox]):not([type=radio])]:rounded-xl [&_input:not([type=checkbox]):not([type=radio])]:text-base [&_textarea]:rounded-xl [&_textarea]:text-base [&_select]:min-h-11 [&_select]:rounded-xl [&_select]:text-base [&_fieldset]:min-w-0 [&_section]:scroll-mt-28 [&_h2]:tracking-tight [&_p]:wrap-anywhere [&_a]:wrap-anywhere [&_button]:motion-reduce:transition-none"
		>
			{children}
		</div>
	) : (
		children
	);
}

export function SalesHeader({
	locale,
	section,
	seller = "",
	title,
	business,
	back,
}: {
	locale: Locale;
	section: SalesSection;
	seller?: string;
	title?: ReactNode;
	business?: ReactNode;
	back?: string;
}) {
	const t = sellerSalesCopy[locale];
	return (
		<header className="min-w-0 space-y-5">
			{back && (
				<Link
					href={back}
					className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action"
				>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{t.back}
				</Link>
			)}
			<div
				className={`grid items-start gap-4 ${business ? "lg:grid-cols-[minmax(0,1fr)_18rem]" : ""}`}
			>
				<div className="min-w-0 space-y-2">
					<h1 className="m-0 text-2xl font-bold tracking-tight">
						{title ??
							(section === "payments" || section === "invoices"
								? t.finance
								: section === "orders" || section === "fulfilment"
									? t.orders
									: section === "aftercare"
										? t.issues
										: t[section])}
					</h1>
				</div>
				{business && (
					<div className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm">
						<div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted">
							<Icon name="store" className="size-4" />
							{t.business}
						</div>
						{business}
					</div>
				)}
			</div>
			<SalesWorkspaceTabs locale={locale} section={section} seller={seller} />
		</header>
	);
}

export function SalesBusinessSelect({
	locale,
	value,
	profiles,
	onChange,
	all = false,
}: {
	locale: Locale;
	value: string;
	profiles: readonly { id: string; name: string }[];
	onChange: (value: string) => void;
	all?: boolean;
}) {
	const t = sellerSalesCopy[locale];
	return (
		<SellerSelect
			label={t.business}
			value={value}
			options={[
				...(all ? [{ value: "", label: t.allBusinesses }] : []),
				...profiles.map((profile) => ({
					value: profile.id,
					label: profile.name,
				})),
			]}
			onChange={onChange}
			icon="store"
		/>
	);
}

export function SalesEmpty({
	locale,
	filtered = false,
	noBusiness = false,
	children,
}: {
	locale: Locale;
	filtered?: boolean;
	noBusiness?: boolean;
	children?: ReactNode;
}) {
	const t = sellerSalesCopy[locale];
	return (
		<section className={`${salesPanel} py-10! text-center`}>
			<span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-info text-action">
				<Icon
					name={noBusiness ? "lock" : filtered ? "search" : "inbox"}
					className="size-6"
				/>
			</span>
			<h2 className="text-lg font-semibold">
				{noBusiness ? t.noBusiness : filtered ? t.noMatches : t.empty}
			</h2>
			{!children && (
				<p className="mx-auto max-w-lg text-sm leading-relaxed text-muted">
					{noBusiness
						? t.noBusinessHelp
						: filtered
							? t.noMatchesHelp
							: t.emptyHelp}
				</p>
			)}
			{children}
		</section>
	);
}

export function SalesPagination({
	locale,
	page,
	count,
	onPage,
	pageSize = 20,
}: {
	locale: Locale;
	page: number;
	count: number;
	onPage: (page: number) => void;
	pageSize?: number;
}) {
	const t = sellerSalesCopy[locale],
		number = new Intl.NumberFormat(locale);
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 text-sm">
			<p className="text-muted">
				{t.results}:{" "}
				<bdi className="font-semibold tabular-nums text-foreground">
					{number.format(count)}
				</bdi>{" "}
				· {t.page} <bdi className="tabular-nums">{number.format(page)}</bdi>
			</p>
			<div className="flex gap-2">
				<button
					type="button"
					className={salesAction}
					disabled={page <= 1}
					onClick={() => onPage(page - 1)}
				>
					{t.previous}
				</button>
				<button
					type="button"
					className={salesAction}
					disabled={page >= 10000 || page * pageSize >= count}
					onClick={() => onPage(page + 1)}
				>
					{t.next}
				</button>
			</div>
		</div>
	);
}

export function SalesRelated({
	locale,
	seller,
	links,
}: {
	locale: Locale;
	seller: string;
	links: readonly { section: SalesSection; id: string }[];
}) {
	const t = sellerSalesCopy[locale],
		destinations = useSellerNavigation();
	const visible = links.filter((link) =>
		destinations?.some((item) => item.route === link.section),
	);
	if (visible.length > 2)
		return (
			<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="sm" className="rounded-lg">
						<MoreHorizontal className="size-4" aria-hidden="true" />
						{t.actions}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
					{visible.map((link) => (
						<DropdownMenuItem
							key={link.section}
							asChild
							className="gap-2 no-underline"
						>
							<Link href={salesHref(locale, link.section, seller, link.id)}>
								<Icon
									name={
										sections.find((item) => item.key === link.section)?.icon ??
										"file"
									}
									className="size-4"
								/>
								{t[link.section]}
							</Link>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	return visible.length ? (
		<nav aria-label={t.details} className="flex flex-wrap gap-2">
			{visible.map((link) => (
				<Link
					key={link.section}
					prefetch={false}
					className={salesAction}
					href={salesHref(locale, link.section, seller, link.id)}
				>
					<Icon
						name={
							sections.find((item) => item.key === link.section)?.icon ?? "file"
						}
						className="size-4"
					/>
					{t[link.section]}
				</Link>
			))}
		</nav>
	) : null;
}

function SalesWorkspaceTabs({
	locale,
	section,
	seller,
}: {
	locale: Locale;
	section: SalesSection;
	seller: string;
}) {
	const t = sellerSalesCopy[locale],
		destinations = useSellerNavigation();
	const items: { key: SalesSection; label: string }[] =
		section === "orders" || section === "fulfilment"
			? [
					{ key: "orders", label: t.orders },
					{ key: "fulfilment", label: t.deliveries },
				]
			: section === "payments" || section === "invoices"
				? [
						{ key: "payments", label: t.payments },
						{ key: "invoices", label: t.invoices },
					]
				: [];
	const available = items.filter((item) =>
		destinations?.some((link) => link.route === item.key),
	);
	if (available.length < 2) return null;
	return (
		<nav
			aria-label={t.related}
			className="flex flex-wrap gap-1 border-0 border-b border-solid border-border"
		>
			{available.map((item) => (
				<Link
					key={item.key}
					href={salesHref(locale, item.key, seller)}
					aria-current={section === item.key ? "page" : undefined}
					className={`inline-flex min-h-10 items-center rounded-t-lg border-0 border-b-2 border-solid px-4 py-2 text-sm no-underline focus-visible:outline-2 focus-visible:outline-action ${section === item.key ? "border-action font-semibold text-action" : "border-transparent text-muted hover:bg-page hover:text-foreground"}`}
				>
					{item.label}
				</Link>
			))}
		</nav>
	);
}
