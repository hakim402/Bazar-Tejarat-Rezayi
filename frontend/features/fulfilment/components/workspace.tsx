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
import { action, control, panel } from "../../orders/components/controls";
import { fulfilment, fulfilmentHref } from "../api";
import { fulfilmentCopy } from "../copy";
import type { Context, Summary } from "../types";
import { DeliverySummary } from "./summary";
import { DeliveryDetail } from "./detail";
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
			{context === "seller" && (
				<div className={panel}>
					<label>
						{t.selectBusiness}
						<select
							className={control}
							aria-label={t.selectBusiness}
							value={seller}
							onChange={(event) =>
								router.push(
									fulfilmentHref(
										locale,
										context,
										undefined,
										event.target.value,
									),
								)
							}
						>
							<option value="">{t.allBusinesses}</option>
							{profiles.map((profile) => (
								<option key={profile.id} value={profile.id}>
									{profile.name}
								</option>
							))}
							{seller && !profiles.some((profile) => profile.id === seller) && (
								<option value={seller}>{seller}</option>
							)}
						</select>
					</label>
					{moreProfiles && (
						<button
							type="button"
							className={action}
							onClick={() => setProfilePage((value) => value + 1)}
						>
							{t.next}
						</button>
					)}
				</div>
			)}
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
								href={fulfilmentHref(
									locale,
									context,
									row.id,
									context === "seller" ? row.seller : undefined,
								)}
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
