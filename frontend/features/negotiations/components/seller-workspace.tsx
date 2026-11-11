"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, MoreHorizontal, Package, RefreshCw } from "lucide-react";
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
import { uuidPattern, type QueryReader } from "../../../lib/routes/account-routes";
import { SessionEntry } from "../../orders/components/session-entry";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { commerce, type Profile } from "../../orders/api";
import { ProductThumbnail } from "../../orders/components/order-ui";
import { commerceCopy } from "../../orders/copy";
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
import { negotiationCopy } from "../copy";
import { sellerNegotiationCopy } from "../seller-copy";
import {
	negotiation,
	productContext,
	productText,
	productImage,
	type RequestRow,
	type Line,
} from "../api";
import { NegotiationFailure } from "./failure";
import { RequestDetail } from "./seller-detail";

export function SellerNegotiationWorkspace({
	locale,
	id,
}: {
	locale: Locale;
	id?: string;
}) {
	const session = useCommunicationSession("seller"),
		q = useSearchParams(),
		t = sellerNegotiationCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return <SessionEntry locale={locale} context="seller" error={session.error} />;
	const seller = q.get("seller") ?? "",
		page = Number(q.get("page") ?? 1),
		state = q.get("state") ?? "",
		search = q.get("q") ?? "",
		attempt = q.get("negotiation_command");
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt && !uuidPattern.test(attempt)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000
	)
		return <p role="alert">{negotiationCopy[locale].error}</p>;
	const identity = `${session.session.identity.id}:${session.session.accounts[0].id}`;
	return (
		<Bootstrap
			key={`${identity}:${locale}:${seller}:${id ?? "list"}:${page}:${state}:${search}`}
			locale={locale}
			id={id}
			identity={identity}
			seller={seller}
			page={page}
			state={state}
			search={search}
			attempt={attempt}
		/>
	);
}

function Bootstrap({
	locale,
	id,
	identity,
	seller,
	page,
	state,
	search,
	attempt,
}: {
	locale: Locale;
	id?: string;
	identity: string;
	seller: string;
	page: number;
	state: string;
	search: string;
	attempt: string | null;
}) {
	const t = sellerNegotiationCopy[locale],
		q = useSearchParams(),
		router = useRouter(),
		[profiles, setProfiles] = useState<Profile[] | null>(null),
		[error, setError] = useState<unknown>(null),
		returnParams = useRef(q),
		scope = `${identity}:negotiations:${seller}:${id ?? "list"}`;
	useEffect(() => {
		returnParams.current = q;
	}, [q]);
	useEffect(() => {
		const controller = new AbortController();
		let alive = true;
		void commerce<{ results: Profile[] }>(
			"orders/seller/profiles/",
			undefined,
			"GET",
			controller.signal,
		)
			.then((p) => {
				if (!alive) return;
				const allowed = p.results.filter((row) => row.orders);
				setProfiles(allowed);
				if (!seller && !id && allowed[0]) {
					router.replace(
						salesHref(locale, "negotiations", allowed[0].id, undefined, returnParams.current) +
							(attempt ? `&negotiation_command=${attempt}` : ""),
					);
				} else if (!seller && !id) {
					setProfiles([]);
				}
			})
			.catch((e) => {
				if (alive) setError(e);
			});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [locale, seller, id, router, attempt]);
	const back = salesHref(locale, "negotiations", seller, undefined, q);
	if (error)
		return (
			<SalesFrame seller>
				<NegotiationFailure locale={locale} error={error} />
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
	if (seller && !profiles.some((p) => p.id === seller))
		return (
			<SalesFrame seller>
				<p role="alert" className={salesPanel}>
					{negotiationCopy[locale].error}
				</p>
			</SalesFrame>
		);
	const business = (
		<SalesBusinessSelect
			locale={locale}
			value={seller}
			profiles={profiles}
			onChange={(chosen) =>
				router.push(
					salesHref(locale, "negotiations", chosen, undefined, q, {
						page: "1",
					}),
				)
			}
		/>
	);
	return (
		<SalesFrame seller>
			{id ? (
				<RequestDetail
					key={`${scope}:${id}`}
					locale={locale}
					id={id}
					seller={seller}
					params={q}
					back={back}
					attempt={attempt}
					scope={scope}
				/>
			) : (
				<RequestList
					key={`${scope}:${page}:${state}:${search}`}
					locale={locale}
					seller={seller}
					page={page}
					filterState={state}
					filterQuery={search}
					params={q}
					business={business}
				/>
			)}
		</SalesFrame>
	);
}

function StatusBadge({ locale, state }: { locale: Locale; state: string }) {
	const t = negotiationCopy[locale];
	const tone =
		state === "accepted"
			? "bg-success-surface text-success"
			: state === "correction_requested"
				? "bg-warning-surface text-warning"
				: state === "rejected"
					? "bg-danger-surface text-danger"
					: state === "withdrawn"
						? "bg-page text-muted"
						: "bg-info text-action";
	return (
		<Badge variant="secondary" className={cn("whitespace-normal border-0", tone)}>
			{t[state as keyof typeof t] ?? state}
		</Badge>
	);
}

function nextLabel(locale: Locale, row: RequestRow) {
	const s = sellerNegotiationCopy[locale];
	if (row.state === "submitted") return s.setTerms;
	if (row.state === "correction_requested") return s.awaitingCustomer;
	if (row.state === "accepted") return row.order ? s.openOrder : s.viewRequest;
	return s.viewRequest;
}

function ProductCell({
	locale,
	row,
}: {
	locale: Locale;
	row: RequestRow;
}) {
	const line = (item: Line, index: number) => {
		const product = productContext(row.proposal, item.variant, index),
			text = productText(product, locale, item.variant),
			sku = String(product?.sku ?? "");
		return (
			<div key={`${item.variant}:${item.tier}`} className="flex min-w-0 items-start gap-3">
				<ProductThumbnail src={productImage(product)} />
				<div className="min-w-0 flex-1">
					<p className="m-0 truncate text-sm font-semibold" title={text.title} dir="auto">
						{text.title}
					</p>
					<p className="m-0 mt-0.5 text-xs text-muted">
						{commerceCopy[locale][item.tier]}
						{sku && (
							<>
								<span className="mx-1.5" aria-hidden="true">
									·
								</span>
								<bdi>{sku}</bdi>
							</>
						)}
					</p>
					<p className="m-0 mt-0.5 text-xs text-muted">
						<bdi>{item.quantity}</bdi> {text.unit}
						<span aria-hidden="true" className="mx-1.5">
							×
						</span>
						<bdi>
							{item.unit_price} {row.currency}
						</bdi>
					</p>
				</div>
			</div>
		);
	};
	return (
		<div className="min-w-0 space-y-3">
			{row.proposal.lines.slice(0, 1).map(line)}
			{row.proposal.lines.length > 1 && (
				<details>
					<summary className="cursor-pointer text-xs font-medium text-action">
						+{row.proposal.lines.length - 1}
					</summary>
					<div className="mt-3 space-y-3">
						{row.proposal.lines.slice(1).map((item, i) => line(item, i + 1))}
					</div>
				</details>
			)}
		</div>
	);
}

function RequestList({
	locale,
	seller,
	page,
	filterState,
	filterQuery,
	params,
	business,
}: {
	locale: Locale;
	seller: string;
	page: number;
	filterState: string;
	filterQuery: string;
	params: QueryReader;
	business: ReactNode;
}) {
	const t = sellerNegotiationCopy[locale],
		nf = new Intl.NumberFormat(locale),
		router = useRouter(),
		search = useSearchParams(),
		guard = useCommerceGuard(locale, false),
		[rows, setRows] = useState<{ results: RequestRow[]; count: number } | null>(
			null,
		),
		[error, setError] = useState<unknown>(null),
		[reload, setReload] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		let alive = true;
		setRows(null);
		setError(null);
		const query = new URLSearchParams({
			page: String(page),
			locale,
			state: filterState,
			q: filterQuery,
		});
		if (seller) query.set("seller", seller);
		void negotiation<{ results: RequestRow[]; count: number }>(
			"seller",
			`negotiations/?${query}`,
			undefined,
			controller.signal,
		)
			.then((value) => {
				if (alive) setRows(value);
			})
			.catch((e) => {
				if (alive) setError(e);
			});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [locale, seller, page, filterState, filterQuery, reload]);
	const go = (changes: Record<string, string>) =>
		guard.choose(() =>
			router.push(
				salesHref(locale, "negotiations", seller, undefined, params, {
					page: "1",
					...changes,
				}),
			),
		);
	const detailHref = (row: RequestRow) =>
		salesHref(locale, "negotiations", seller, row.id, search);
	return (
		<>
			<SalesHeader
				locale={locale}
				section="negotiations"
				seller={seller}
				business={business}
			/>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					go({
						q: String(data.get("q") ?? ""),
						state: String(data.get("state") ?? ""),
					});
				}}
				className={cn(
					salesPanel,
					"grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)_auto]",
				)}
			>
				<label className="grid min-w-0 gap-2">
					{t.customer} / {negotiationCopy[locale].request}
					<input
						name="q"
						className={salesControl}
						maxLength={100}
						dir="auto"
						defaultValue={filterQuery}
					/>
				</label>
				<label className="grid min-w-0 gap-2">
					{negotiationCopy[locale].status}
					<select
						name="state"
						className={salesControl}
						defaultValue={filterState}
					>
						<option value="">{negotiationCopy[locale].all}</option>
						{(
							[
								"submitted",
								"correction_requested",
								"accepted",
								"withdrawn",
								"rejected",
							] as const
						).map((s) => (
							<option key={s} value={s}>
								{negotiationCopy[locale][s]}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap gap-2">
					<button type="submit" className={salesAction}>
						{negotiationCopy[locale].search}
					</button>
					{(filterQuery || filterState || page > 1) && (
						<Link
							className={salesAction}
							href={salesHref(locale, "negotiations", seller)}
						>
							{sellerSalesCopy[locale].clear}
						</Link>
					)}
				</div>
			</form>
			{error ? (
				<NegotiationFailure locale={locale} error={error} />
			) : !rows ? (
				<p role="status" className={salesPanel}>
					{t.loading}
				</p>
			) : !rows.results.length ? (
				<SalesEmpty
					locale={locale}
					filtered={!!filterQuery || !!filterState || page > 1}
				>
					<p className="text-sm text-muted">{t.emptyFiltered}</p>
				</SalesEmpty>
			) : (
				<Card className="gap-0 overflow-hidden rounded-2xl border-border bg-surface py-0 shadow-xs">
					<div className="flex items-center justify-between gap-3 border-b border-solid border-border px-4 py-4 sm:px-5">
						<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
							{negotiationCopy[locale].title}
							<Badge
								variant="secondary"
								className="rounded-full border-0 bg-page text-muted"
							>
								{nf.format(rows.count)}
							</Badge>
						</h2>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setReload((v) => v + 1)}
							className="h-9 rounded-lg text-xs"
						>
							<RefreshCw className="size-3.5" aria-hidden="true" />
							{negotiationCopy[locale].reload}
						</Button>
					</div>
					<section
						aria-label={negotiationCopy[locale].title}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: named overflow region
						tabIndex={0}
						className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-action lg:block"
					>
						<table className="w-full min-w-[64rem] border-collapse text-start">
							<caption className="sr-only">
								{negotiationCopy[locale].title}
							</caption>
							<thead>
								<tr className="bg-page/70">
									{[
										negotiationCopy[locale].request,
										t.products,
										t.customer,
										t.status,
										t.nextAction,
										t.actions,
									].map((label, i) => (
										<th
											key={label}
											scope="col"
											className={cn(
												"border-b border-solid border-border px-5 py-3 text-start text-xs font-medium text-muted",
												i === 5 && "text-end",
											)}
										>
											{i === 5 ? <span className="sr-only">{label}</span> : label}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{rows.results.map((row) => (
									<tr
										key={row.id}
										className="border-b border-solid border-border last:border-b-0 hover:bg-page/40"
									>
										<td className="px-5 py-5 align-top">
											<div className="space-y-1.5">
												<Link
													href={detailHref(row)}
													className="text-sm font-semibold text-action no-underline hover:text-foreground"
												>
													<bdi>{row.id}</bdi>
												</Link>
												<time
													dateTime={row.created_at}
													className="block max-w-36 text-xs leading-relaxed text-muted"
												>
													{localTimestamp(row.created_at, locale)}
												</time>
											</div>
										</td>
										<td className="min-w-72 px-5 py-5 align-top">
											<ProductCell locale={locale} row={row} />
										</td>
										<td className="px-5 py-5 align-top">
											<span className="text-sm font-medium" dir="auto">
												{row.buyer}
											</span>
										</td>
										<td className="px-5 py-5 align-top">
											<StatusBadge locale={locale} state={row.state} />
										</td>
										<td className="px-5 py-5 align-top">
											<Link
												className={salesAction}
												href={
													row.state === "accepted" && row.order
														? salesHref(locale, "orders", seller, row.order)
														: detailHref(row)
												}
											>
												{nextLabel(locale, row)}
											</Link>
										</td>
										<td className="px-4 py-3 text-end align-top">
											<RequestMenu locale={locale} seller={seller} row={row} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					<ul className="m-0 list-none divide-y divide-border p-0 lg:hidden">
						{rows.results.map((row) => (
							<li key={row.id} className="space-y-4 p-4">
								<div className="flex items-start justify-between gap-3">
									<div className="space-y-1">
										<Link
											href={detailHref(row)}
											className="text-sm font-semibold text-action no-underline"
										>
											<bdi>{row.id}</bdi>
										</Link>
										<p className="m-0 break-words text-sm" dir="auto">
											{row.buyer}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<StatusBadge locale={locale} state={row.state} />
										<RequestMenu locale={locale} seller={seller} row={row} />
									</div>
								</div>
								<ProductCell locale={locale} row={row} />
								<Link
									className={salesAction}
									href={
										row.state === "accepted" && row.order
											? salesHref(locale, "orders", seller, row.order)
											: detailHref(row)
									}
								>
									{nextLabel(locale, row)}
								</Link>
							</li>
						))}
					</ul>
					<SalesPagination
						locale={locale}
						page={page}
						count={rows.count}
						onPage={(next) =>
							router.push(
								salesHref(locale, "negotiations", seller, undefined, search, {
									page: String(next),
								}),
							)
						}
					/>
				</Card>
			)}
		</>
	);
}

function RequestMenu({
	locale,
	seller,
	row,
}: {
	locale: Locale;
	seller: string;
	row: RequestRow;
}) {
	const t = sellerNegotiationCopy[locale];
	return (
		<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t.moreActions}
					title={t.moreActions}
					className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
				>
					<MoreHorizontal className="size-5" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={6} className="w-56 rounded-xl p-1.5">
				<DropdownMenuItem asChild className="gap-2.5 no-underline">
					<Link href={salesHref(locale, "negotiations", seller, row.id)}>
						<Package aria-hidden="true" />
						{t.viewRequest}
					</Link>
				</DropdownMenuItem>
				{row.state === "accepted" && row.order && (
					<DropdownMenuItem asChild className="gap-2.5 no-underline">
						<Link href={salesHref(locale, "orders", seller, row.order)}>
							<Check aria-hidden="true" />
							{t.openOrder}
						</Link>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
