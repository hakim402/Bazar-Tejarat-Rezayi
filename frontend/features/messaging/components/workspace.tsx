"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { uuidPattern } from "../../../lib/routes/account-routes";
import { authHref } from "../../../lib/routes/auth-routes";
import { useNavigation } from "../../../components/layout/navigation-guard";
import { AccountError } from "../../../lib/api/private-client";
import { communicationCopy } from "../copy";
import {
	messaging,
	threadHref,
	localTimestamp,
	type Context,
	type Inbox,
	type Profiles,
} from "../api";
import {
	useCommunicationSession,
	useVisiblePoll,
	useOnlineState,
	accessLost,
} from "../hooks";
import { clearDrafts } from "../drafts";
import { CountStrip } from "../../notifications/components/unread-counts";
import { notification } from "../../notifications/api";
import { NoticeList } from "../../notifications/components/notification-list";
import { Thread } from "./thread";
import { Enquiry } from "./enquiry";
import { control, action, Failure } from "./controls";
export function CommunicationWorkspace({
	locale,
	context,
	conversation,
	mode = "messages",
}: {
	locale: Locale;
	context: Context;
	conversation?: string;
	mode?: "messages" | "notifications";
}) {
	const online = useOnlineState();
	const session = useCommunicationSession(context),
		t = communicationCopy[locale],
		search = useSearchParams();
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return (
			<div className="space-y-4">
				<Failure locale={locale} error={session.error} />
				<Link
					className={action}
					href={authHref(
						locale,
						`${context}-sign-in`,
						new URLSearchParams({
							return: `/${locale}/account/${context}/messages`,
						}),
					)}
				>
					{t.signIn}
				</Link>
			</div>
		);
	const identity = session.session.identity.id,
		account = session.session.accounts[0].id;
	return (
		<>
			<p role="status" hidden={online} className="text-warning">
				{t.offline}
			</p>
			<Scope
				key={`${identity}:${account}:${locale}:${context}:${search.get("seller") ?? ""}:${conversation ?? ""}:${mode}:${search.get("product") ?? ""}`}
				identity={`${identity}:${account}`}
				locale={locale}
				context={context}
				conversation={conversation}
				mode={mode}
			/>
		</>
	);
}
function Scope({
	identity,
	locale,
	context,
	conversation,
	mode,
}: {
	identity: string;
	locale: Locale;
	context: Context;
	conversation?: string;
	mode: "messages" | "notifications";
}) {
	const t = communicationCopy[locale],
		search = useSearchParams(),
		router = useRouter(),
		navigate = useNavigation();
	const selected = context === "seller" ? (search.get("seller") ?? "") : "",
		product = context === "buyer" ? search.get("product") : null;
	const [profiles, setProfiles] = useState<Profiles | null>(null),
		[failure, setFailure] = useState<unknown>(null);
	useEffect(() => {
		if (context !== "seller") return;
		const controller = new AbortController();
		let alive = true;
		void (async () => {
			let page = 1;
			const all: Profiles["results"] = [];
			let latest: Profiles;
			do {
				latest = await (mode === "notifications" ? (context: Context, path: string, data?: unknown, options?: {signal?:AbortSignal}) => notification<Profiles>(context,path,data,"GET",options) : messaging<Profiles>)(
					"seller",
					`profiles/?page=${page}`,
					undefined,
					{ signal: controller.signal },
				);
				all.push(...latest.results);
				page++;
			} while (all.length < latest.count && latest.results.length);
			if (!alive) return;
			setProfiles({ ...latest, results: all });
			if (!selected && all[0])
				router.replace(`/${locale}/account/seller/${mode}?seller=${all[0].id}`);
		})().catch((error) => {
			if (alive) {
				if (accessLost(error)) clearDrafts();
				setFailure(error);
			}
		});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [context, selected, locale, mode, router]);
	if (product && !uuidPattern.test(product))
		return <p role="alert">{t.noAccess}</p>;
	if (context === "seller" && selected && !uuidPattern.test(selected))
		return <p role="alert">{t.noAccess}</p>;
	const content: ReactNode =
		context === "seller" && !profiles ? (
			<p role="status">{t.loading}</p>
		) : context === "seller" && !profiles?.results.length ? (
			<p role="status">{t.noBusiness}</p>
		) : context === "seller" &&
			!profiles?.results.some((p) => p.id === selected) ? (
			<p role="alert">{t.denied}</p>
		) : conversation ? (
			<Thread
				identity={identity}
				context={context}
				locale={locale}
				id={conversation}
				seller={selected}
			/>
		) : product ? (
			<Enquiry identity={identity} locale={locale} product={product} />
		) : mode === "notifications" ? (
			<NoticeList locale={locale} context={context} seller={selected} />
		) : (
			<InboxList locale={locale} context={context} seller={selected} />
		);
	return (
		<div className="min-w-0 space-y-5" data-testid="communication-workspace">
			<h1 className="text-3xl font-bold">
				{mode === "notifications" ? t.notifications : t.messages}
			</h1>
			{context === "seller" && profiles?.results.length ? (
				<label className="block max-w-xl space-y-2">
					<span className="font-bold">{t.business}</span>
					<select
						className={control}
						value={selected}
						onChange={(e) => {
							const value = e.target.value;
							navigate(() =>
								router.push(
									`/${locale}/account/seller/${mode}?seller=${value}`,
								),
							);
						}}
					>
						<option value="">{t.choose}</option>
						{profiles.results.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</label>
			) : null}
			{failure ? (
				<Failure locale={locale} error={failure} />
			) : (
				<>
					{(context === "buyer" || selected) && (
						<CountStrip
							context={context}
							locale={locale}
							seller={selected}
							onDenied={setFailure}
						/>
					)}{" "}
					{content}
				</>
			)}
		</div>
	);
}
function InboxList({
	locale,
	context,
	seller,
}: {
	locale: Locale;
	context: Context;
	seller: string;
}) {
	const t = communicationCopy[locale],
		search = useSearchParams(),
		router = useRouter(),
		path = usePathname();
	const page = Number(search.get("page") ?? 1),
		unread = search.get("unread") === "true";
	const [data, setData] = useState<Inbox | null>(null),
		[error, setError] = useState<unknown>(null);
	const select = (values: Record<string, string>) => {
		const q = new URLSearchParams(search);
		for (const [k, v] of Object.entries(values)) v ? q.set(k, v) : q.delete(k);
		router.push(`${path}?${q}`);
	};
	useVisiblePoll(
		async (signal) => {
			if (!Number.isInteger(page) || page < 1 || page > 10000) {
				setError(new AccountError(400));
				return;
			}
			try {
				const q = new URLSearchParams({
					page: String(page),
					unread: String(unread),
				});
				if (seller) q.set("seller", seller);
				const value = await messaging<Inbox>(
					context,
					`conversations/?${q}`,
					undefined,
					{ signal },
				);
				if (signal.aborted) return;
				setData(value);
				setError(null);
			} catch (e) {
				if (signal.aborted) return;
				setData(null);
				setError(e);
				if (accessLost(e)) clearDrafts();
				throw e;
			}
		},
		[context, seller, page, unread],
	);
	return (
		<section className="space-y-4" aria-label={t.messages}>
			<label className="inline-flex min-h-11 items-center gap-3">
				<input
					type="checkbox"
					checked={unread}
					onChange={(e) =>
						select({ unread: e.target.checked ? "true" : "", page: "" })
					}
				/>
				{t.unread}
			</label>
			{error ? (
				<Failure locale={locale} error={error} />
			) : !data ? (
				<p role="status">{t.loading}</p>
			) : !data.results.length ? (
				<p>{t.empty}</p>
			) : (
				<ul className="space-y-3">
					{data.results.map((row) => (
						<li
							key={row.id}
							className="rounded-card border border-border bg-surface p-4"
						>
							<Link
								prefetch={false}
								className="block min-h-11 space-y-2 text-foreground no-underline"
								href={threadHref(locale, context, row.id, seller)}
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<strong className="break-words" dir="auto">
										{row.snapshot.title}
									</strong>
									{row.unread && (
										<span className="rounded-control bg-info px-2 py-1 text-sm font-bold text-action">
											{t.unread}
										</span>
									)}
								</div>
								<p className="break-words text-sm text-muted" dir="auto">
									{row.snapshot.seller}
								</p>
								<time dateTime={row.updated_at} className="text-sm text-muted">
									<bdi>{localTimestamp(row.updated_at, locale)}</bdi> ·{" "}
									{t.timezone}
								</time>
							</Link>
						</li>
					))}
				</ul>
			)}
			{data && (
				<div className="flex flex-wrap gap-3">
					<button
						className={action}
						type="button"
						disabled={page <= 1}
						onClick={() => select({ page: String(page - 1) })}
					>
						{t.previous}
					</button>
					<button
						className={action}
						type="button"
						disabled={page * 20 >= data.count}
						onClick={() => select({ page: String(page + 1) })}
					>
						{t.next}
					</button>
				</div>
			)}
		</section>
	);
}
