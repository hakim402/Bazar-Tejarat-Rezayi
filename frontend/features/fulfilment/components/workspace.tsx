"use client";
import Link from "next/link";
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
import { action, control } from "../../orders/components/controls";
import { fulfilment, fulfilmentHref } from "../api";
import { fulfilmentCopy } from "../copy";
import type { Context, Summary } from "../types";
import { DeliverySummary } from "./summary";
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
	salesControl,
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
		[context, seller, page, state, search, denied],
	);
	if (denied) return <p role="alert">{t.noAccess}</p>;
	if (context === "seller") {
		const s = sellerSalesCopy[locale],
			filtered = Boolean(state || search),
			listFilters = { page: String(page), state, q: search },
			visibleProfiles =
				seller && !profiles.some((profile) => profile.id === seller)
					? [...profiles, { id: seller, name: seller }]
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
				<p className="text-sm leading-relaxed text-muted">{t.intro}</p>
				<form
					className={`${salesPanel} grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,15rem)]`}
					onSubmit={(event) => {
						event.preventDefault();
						router.push(href({ page: "1", q: searchDraft.trim() }));
					}}
				>
					<label className="min-w-0 space-y-2">
						<span>{t.search}</span>
						<input
							type="search"
							className={salesControl}
							value={searchDraft}
							maxLength={100}
							onChange={(event) => setSearchDraft(event.target.value)}
						/>
					</label>
					<label className="min-w-0 space-y-2">
						<span>{t.filter}</span>
						<select
							className={salesControl}
							value={state}
							onChange={(event) =>
								router.push(href({ page: "1", state: event.target.value }))
							}
						>
							{[
								["", t.all],
								["not_dispatched", t.not_dispatched],
								["dispatched", t.dispatched],
								["delivered", t.delivered],
								["blocked", t.blockers],
							].map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<div className="flex flex-wrap items-center gap-3 sm:col-span-2">
						<button type="submit" className={salesAction}>
							{t.search}
						</button>
						{(filtered || searchDraft) && (
							<button
								type="button"
								className={salesAction}
								onClick={() => {
									setSearchDraft("");
									router.push(href({ page: "1", state: "", q: "" }));
								}}
							>
								{s.clear}
							</button>
						)}
						{data && (
							<p className="text-sm text-muted" role="status">
								{s.results}:{" "}
								<bdi className="font-semibold tabular-nums text-foreground">
									{new Intl.NumberFormat(locale).format(data.count)}
								</bdi>
							</p>
						)}
					</div>
				</form>
				{error ? (
					<p role="alert">{t.error}</p>
				) : !data ? (
					<p role="status">{t.loading}</p>
				) : data.results.length ? (
					<ul className="grid min-w-0 gap-4 desktop:grid-cols-2">
						{data.results.map((row) => (
							<li key={row.id} className="min-w-0 space-y-3">
								<DeliverySummary {...{ locale, row }} seller compact />
								<Link
									className={salesAction}
									prefetch={false}
									href={salesHref(
										locale,
										"fulfilment",
										row.seller,
										row.id,
										undefined,
										listFilters,
									)}
								>
									{s.view} · <bdi>{row.number}</bdi>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<SalesEmpty locale={locale} filtered={filtered} />
				)}
				{data && (
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
		<div className="min-w-0 space-y-5">
			<h1 className="text-2xl font-bold">
				{context === "buyer" ? t.buyerTitle : t.sellerTitle}
			</h1>
			<p>{t.intro}</p>
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					router.push(
						fulfilmentHref(
							locale,
							context,
							undefined,
							seller,
							1,
							state,
							searchDraft.trim(),
						),
					);
				}}
			>
				<label>
					{t.search}
					<input
						type="search"
						className={control}
						value={searchDraft}
						maxLength={100}
						onChange={(event) => setSearchDraft(event.target.value)}
					/>
				</label>
				<button className={action} type="submit">
					{t.search}
				</button>
			</form>
			<label>
				{t.filter}
				<select
					className={control}
					value={state}
					onChange={(event) =>
						router.push(
							fulfilmentHref(
								locale,
								context,
								undefined,
								seller,
								1,
								event.target.value,
								search,
							),
						)
					}
				>
					{[
						["", t.all],
						["not_dispatched", t.not_dispatched],
						["dispatched", t.dispatched],
						["delivered", t.delivered],
						["blocked", t.blockers],
					].map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</label>
			{error ? (
				<p role="alert">{t.error}</p>
			) : !data ? (
				<p role="status">{t.loading}</p>
			) : data.results.length ? (
				<ul className="space-y-4">
					{data.results.map((row) => (
						<li key={row.id}>
							<Link
								className="block min-h-11 font-bold"
								prefetch={false}
								href={fulfilmentHref(locale, context, row.id, undefined)}
							>
								<bdi>{row.number}</bdi>
							</Link>
							<DeliverySummary {...{ locale, row }} />
						</li>
					))}
				</ul>
			) : (
				<p>{t.empty}</p>
			)}
			{data && (
				<div className="flex flex-wrap gap-3">
					<button
						type="button"
						className={action}
						disabled={page <= 1}
						onClick={() =>
							router.push(
								fulfilmentHref(
									locale,
									context,
									undefined,
									seller,
									page - 1,
									state,
									search,
								),
							)
						}
					>
						{t.previous}
					</button>
					<bdi>{page}</bdi>
					<button
						type="button"
						className={action}
						disabled={page * 20 >= data.count}
						onClick={() =>
							router.push(
								fulfilmentHref(
									locale,
									context,
									undefined,
									seller,
									page + 1,
									state,
									search,
								),
							)
						}
					>
						{t.next}
					</button>
				</div>
			)}
		</div>
	);
}
