"use client";
import Link from "next/link";
import { Search, RotateCw } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { Input } from "../../../components/shadcn/input";
import { deliveryListCopy } from "../list-copy";
import { SellerDeliveryList } from "./seller-delivery-list";
import { BuyerDeliveries } from "./buyer-list";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { uuidPattern } from "../../../lib/routes/account-routes";
import {
	useCommunicationSession,
	useVisiblePoll,
	accessLost,
} from "../../messaging/hooks";
import { SessionEntry } from "../../orders/components/session-entry";
import { fulfilment } from "../api";
import { fulfilmentCopy } from "../copy";
import type { Context, Summary } from "../types";
import { DeliveryDetail } from "./detail";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import {
	SalesFrame,
	SalesHeader,
	SalesBusinessSelect,
	SalesEmpty,
	SalesPagination,
	salesHref,
	salesAction,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
export function FulfilmentWorkspace({
	locale,
	context,
	id,
}: {
	locale: Locale;
	context: Context;
	id?: string;
}) {
	const session = useCommunicationSession(context),
		query = useSearchParams(),
		t = fulfilmentCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return <SessionEntry {...{ locale, context, error: session.error }} />;
	const seller = context === "seller" ? (query.get("seller") ?? "") : "",
		page = Number(query.get("page") ?? 1),
		state = query.get("state") ?? "",
		search = query.get("q") ?? "",
		attempt = query.get("fulfilment_attempt");
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt && !uuidPattern.test(attempt)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000 ||
		search.length > 100 ||
		!["", "not_dispatched", "dispatched", "delivered", "blocked"].includes(
			state,
		)
	)
		return <p role="alert">{t.error}</p>;
	const scope = `${session.session.identity.id}:${session.session.accounts[0].id}:${context}:${seller}:${id ?? "list"}`;
	return id ? (
		<DeliveryDetail
			key={`${scope}:${locale}:${page}`}
			{...{ locale, context, id, seller, page, scope, attempt }}
		/>
	) : (
		<DeliveryList
			key={`${scope}:${locale}:${page}:${state}:${search}`}
			{...{ locale, context, seller, page, state, search }}
		/>
	);
}
function DeliveryList({
	locale,
	context,
	seller,
	page,
	state,
	search,
}: {
	locale: Locale;
	context: Context;
	seller: string;
	page: number;
	state: string;
	search: string;
}) {
	const t = fulfilmentCopy[locale],
		router = useRouter(),
		[data, setData] = useState<{ count: number; results: Summary[] } | null>(
			null,
		),
		[searchDraft, setSearchDraft] = useState(search),
		[error, setError] = useState(false),
		[revision, setRevision] = useState(0),
		[denied, setDenied] = useState(false),
		[profiles, setProfiles] = useState<{ id: string; name: string }[]>([]),
		[profilePage, setProfilePage] = useState(1),
		[moreProfiles, setMoreProfiles] = useState(false);
	useEffect(() => {
		if (context !== "seller") return;
		const controller = new AbortController();
		void fulfilment<{ count: number; results: { id: string; name: string }[] }>(
			context,
			`profiles/?page=${profilePage}`,
			undefined,
			controller.signal,
		)
			.then((value) => {
				if (controller.signal.aborted) return;
				setProfiles((old) => [
					...new Map(
						[...old, ...value.results].map((row) => [row.id, row]),
					).values(),
				]);
				setMoreProfiles(profilePage * 20 < value.count);
			})
			.catch((error) => {
				if (!controller.signal.aborted) {
					setError(true);
					if (accessLost(error)) setDenied(true);
				}
			});
		return () => controller.abort();
	}, [context, profilePage]);
	useVisiblePoll(
		async (signal) => {
			if (denied) return;
			try {
				const value = await fulfilment<{ count: number; results: Summary[] }>(
					context,
					`orders/?page=${page}&state=${state}&q=${encodeURIComponent(search)}${seller ? `&seller=${seller}` : ""}`,
					undefined,
					signal,
				);
				if (signal.aborted) return;
				setData(value);
				setError(false);
			} catch (error) {
				if (signal.aborted) return;
				setData(null);
				setError(true);
				if (accessLost(error)) {
					setDenied(true);
					setProfiles([]);
				}
				throw error;
			}
		},
		[context, seller, page, state, search, denied, revision],
	);
	if (denied) return <p role="alert">{t.noAccess}</p>;
	if (context === "seller") {
		const s = sellerSalesCopy[locale],
			l = deliveryListCopy[locale],
			filtered = Boolean(state || search),
			listFilters = { page: String(page), state, q: search },
			visibleProfiles =
				seller && !profiles.some((profile) => profile.id === seller)
					? [...profiles, { id: seller, name: s.business }]
					: profiles;
		const href = (changes: Record<string, string> = {}) =>
			salesHref(locale, "fulfilment", seller, undefined, undefined, {
				...listFilters,
				...changes,
			});
		return (
			<SalesFrame seller>
				<SalesHeader
					locale={locale}
					section="fulfilment"
					description={sellerSalesCopy[locale].fulfilmentDescription}
					title={l.title}
					seller={seller}
					business={
						<div className="space-y-3">
							<SalesBusinessSelect
								locale={locale}
								value={seller}
								profiles={visibleProfiles}
								all
								onChange={(value) =>
									router.push(salesHref(locale, "fulfilment", value))
								}
							/>
							{moreProfiles && (
								<button
									type="button"
									className={salesAction}
									disabled={profilePage >= 10000}
									onClick={() => setProfilePage((value) => value + 1)}
								>
									{s.moreBusinesses}
								</button>
							)}
						</div>
					}
				/>
				<section className="min-w-0 space-y-4">
					<form
						className="flex flex-wrap items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							router.push(href({ page: "1", q: searchDraft.trim() }));
						}}
					>
						<div className="relative min-w-0 flex-1 sm:max-w-md">
							<Search
								className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
								aria-hidden="true"
							/>
							<Input
								type="search"
								aria-label={l.search}
								placeholder={l.search}
								value={searchDraft}
								maxLength={100}
								dir="auto"
								onChange={(event) => setSearchDraft(event.target.value)}
								className="h-10 rounded-xl bg-surface ps-9"
							/>
						</div>
						<Button type="submit" variant="outline" className="h-10 rounded-xl">
							{l.searchAction}
						</Button>
						{(filtered || searchDraft) && (
							<Button
								type="button"
								variant="ghost"
								className="h-10 rounded-xl"
								onClick={() => {
									setSearchDraft("");
									router.push(href({ page: "1", state: "", q: "" }));
								}}
							>
								{s.clear}
							</Button>
						)}
					</form>
					<nav
						aria-label={l.status}
						className="flex max-w-full gap-1 overflow-x-auto border-0 border-b border-solid border-border"
					>
						{[
							["", l.all],
							["not_dispatched", l.pending],
							["dispatched", l.transit],
							["delivered", l.delivered],
							["blocked", l.blocked],
						].map(([value, label]) => (
							<Link
								key={value}
								href={href({ page: "1", state: value })}
								aria-current={state === value ? "page" : undefined}
								className={`shrink-0 border-0 border-b-2 border-solid px-3 py-3 text-sm no-underline focus-visible:outline-2 focus-visible:outline-action ${state === value ? "border-action font-semibold text-action" : "border-transparent text-muted hover:text-foreground"}`}
							>
								{label}
							</Link>
						))}
					</nav>
				</section>
				{error ? (
					<section role="alert" className={salesPanel}>
						<p className="m-0 text-sm">{t.error}</p>
						<Button
							variant="outline"
							onClick={() => setRevision((value) => value + 1)}
						>
							<RotateCw className="size-4" aria-hidden="true" />
							{t.refresh}
						</Button>
					</section>
				) : !data ? (
					<p role="status">{t.loading}</p>
				) : data.results.length ? (
					<SellerDeliveryList
						locale={locale}
						rows={data.results}
						filters={listFilters}
					/>
				) : (
					<SalesEmpty locale={locale} filtered={filtered} />
				)}
				{data && !error && (
					<SalesPagination
						locale={locale}
						page={page}
						count={data.count}
						onPage={(value) => router.push(href({ page: String(value) }))}
					/>
				)}
			</SalesFrame>
		);
	}
	return (
		<BuyerDeliveries
			locale={locale}
			seller={seller}
			page={page}
			state={state}
			search={search}
			data={data}
			error={error}
			searchDraft={searchDraft}
			setSearchDraft={setSearchDraft}
			onReload={() => setRevision((value) => value + 1)}
		/>
	);
}
