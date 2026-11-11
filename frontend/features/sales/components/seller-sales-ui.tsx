"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
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
	aftercare: ["page"],
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
	for (const key of ["list_page", "list_state", "list_q"]) {
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
	const t = sellerSalesCopy[locale],
		destinations = useSellerNavigation(),
		params = useSearchParams(),
		pathname = usePathname();
	const returnParams: QueryReader = {
		get: (key) =>
			pathname.endsWith(`/${section}`) || key.startsWith("list_")
				? params.get(key)
				: null,
	};
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
				className={`grid items-start gap-4 ${business ? "lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]" : ""}`}
			>
				<div className="min-w-0 space-y-2">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted">
						{t.sales}
					</p>
					<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
						{title ?? t[section]}
					</h1>
					<p className="max-w-2xl text-sm leading-relaxed text-muted">
						{t[`${section}Description`]}
					</p>
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
			<nav
				aria-label={t.related}
				className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
			>
				{sections
					.filter(
						(item) =>
							item.key === section ||
							destinations?.some((link) => link.route === item.key),
					)
					.map((item) => (
						<Link
							key={item.key}
							href={salesHref(
								locale,
								item.key,
								seller,
								undefined,
								item.key === section ? returnParams : undefined,
							)}
							aria-current={item.key === section ? "page" : undefined}
							className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${item.key === section ? "border-action bg-info text-action" : "border-border bg-surface text-muted hover:border-action hover:text-action"}`}
						>
							<Icon name={item.icon} className="size-4" />
							{t[item.key]}
						</Link>
					))}
			</nav>
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
			<p className="mx-auto max-w-lg text-sm leading-relaxed text-muted">
				{noBusiness
					? t.noBusinessHelp
					: filtered
						? t.noMatchesHelp
						: t.emptyHelp}
			</p>
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
