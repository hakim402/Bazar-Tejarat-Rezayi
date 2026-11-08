"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerMessagesCopy } from "../../../lib/i18n/seller-messages";
import { Icon } from "../../../components/ui/icon";
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
	type Conversation,
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
import {
	messageListState,
	sellerMessagesHref,
	messageAction,
	messagePanel,
	SellerMessagesHeader,
	SellerMessagesEmpty,
} from "./seller-messages-ui";
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
	if (session.loading || !session.session) {
		const feedback = session.loading ? (
			<p role="status">{t.loading}</p>
		) : (
			<div className="space-y-4">
				<Failure locale={locale} error={session.error} />
				<Link
					className={
						context === "seller" && mode === "messages" ? messageAction : action
					}
					href={authHref(
						locale,
						`${context}-sign-in`,
						new URLSearchParams({
							return:
								context === "seller" && mode === "messages"
									? sellerMessagesHref(
											locale,
											search.get("seller") ?? "",
											conversation,
											search,
											!!conversation,
										)
									: `/${locale}/account/${context}/messages`,
						}),
					)}
				>
					{t.signIn}
				</Link>
			</div>
		);
		return context === "seller" && mode === "messages" ? (
			<div className="min-w-0 space-y-6" data-seller-messages>
				<SellerMessagesHeader
					locale={locale}
					selected=""
					profiles={[]}
					thread={!!conversation}
				/>
				<div className={messagePanel}>{feedback}</div>
			</div>
		) : (
			feedback
		);
	}
	const identity = session.session.identity.id,
		account = session.session.accounts[0].id;
	return (
		<>
			<p role="status" hidden={online} className="text-warning">
				{t.offline}
			</p>
			{context === "seller" && mode === "messages" ? (
				<SellerMessagesScope
					key={`${identity}:${account}:${locale}:${search.get("seller") ?? ""}:${conversation ?? ""}`}
					identity={`${identity}:${account}`}
					locale={locale}
					conversation={conversation}
				/>
			) : (
				<Scope
					key={`${identity}:${account}:${locale}:${context}:${search.get("seller") ?? ""}:${conversation ?? ""}:${mode}:${search.get("product") ?? ""}`}
					identity={`${identity}:${account}`}
					locale={locale}
					context={context}
					conversation={conversation}
					mode={mode}
				/>
			)}
		</>
	);
}
function SellerMessagesScope({
	identity,
	locale,
	conversation,
}: {
	identity: string;
	locale: Locale;
	conversation?: string;
}) {
	const t = communicationCopy[locale],
		search = useSearchParams(),
		router = useRouter(),
		navigate = useNavigation(),
		selected = search.get("seller") ?? "";
	const [profiles, setProfiles] = useState<Profiles | null>(null),
		[resolved, setResolved] = useState(false),
		[failure, setFailure] = useState<unknown>(null),
		[retry, setRetry] = useState(0);
	const routeParams = useRef(search);
	useEffect(() => {
		routeParams.current = search;
	}, [search]);
	useEffect(() => {
		const controller = new AbortController();
		let alive = true;
		if (retry > 0) setProfiles(null);
		setResolved(false);
		setFailure(null);
		void (async () => {
			if (
				(selected && !uuidPattern.test(selected)) ||
				(conversation && !uuidPattern.test(conversation))
			)
				throw new AccountError(404);
			let page = 1;
			const all: Profiles["results"] = [];
			let latest: Profiles;
			do {
				if (page > 10000) throw new Error("Messaging profile page limit");
				latest = await messaging<Profiles>(
					"seller",
					`profiles/?page=${page}`,
					undefined,
					{ signal: controller.signal },
				);
				if (!alive || controller.signal.aborted) return;
				all.push(...latest.results);
				page++;
			} while (all.length < latest.count && latest.results.length);
			if (!all.every((profile) => uuidPattern.test(profile.id)))
				throw new AccountError(404);
			setProfiles({ ...latest, results: all });
			if (!all.length) return;
			if (conversation) {
				// Resolve scope before history mounts and sends read acknowledgements.
				const detail = await messaging<Conversation>(
					"seller",
					`conversations/${conversation}/`,
					undefined,
					{ signal: controller.signal },
				);
				if (!alive || controller.signal.aborted) return;
				if (
					detail.id.toLowerCase() !== conversation.toLowerCase() ||
					!uuidPattern.test(detail.seller) ||
					!all.some((profile) => profile.id === detail.seller)
				)
					throw new AccountError(404);
				if (selected !== detail.seller) {
					router.replace(
						sellerMessagesHref(
							locale,
							detail.seller,
							conversation,
							routeParams.current,
							true,
						),
					);
					return;
				}
			} else if (!selected) {
				router.replace(
					sellerMessagesHref(locale, all[0].id, undefined, routeParams.current),
				);
				return;
			} else if (!all.some((profile) => profile.id === selected)) {
				throw new AccountError(404);
			}
			setResolved(true);
		})().catch((error) => {
			if (!alive || controller.signal.aborted) return;
			if (accessLost(error)) clearDrafts();
			setFailure(error);
		});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [selected, conversation, locale, router, retry]);
	const list = messageListState(search);
	return (
		<div
			className="min-w-0 space-y-6"
			data-testid="communication-workspace"
			data-seller-messages
		>
			<SellerMessagesHeader
				locale={locale}
				selected={selected}
				profiles={profiles?.results ?? []}
				thread={!!conversation}
				onChange={(value) => {
					if (
						!uuidPattern.test(value) ||
						!profiles?.results.some((profile) => profile.id === value)
					)
						return;
					// A deliberate business change always starts a fresh inbox context.
					navigate(() => router.push(sellerMessagesHref(locale, value)));
				}}
			/>
			{failure ? (
				<div className={messagePanel}>
					<Failure locale={locale} error={failure} />
					<button
						className={messageAction}
						type="button"
						onClick={() => setRetry((value) => value + 1)}
					>
						{t.retry}
					</button>
				</div>
			) : !profiles ? (
				<p role="status" className={messagePanel}>
					{t.loading}
				</p>
			) : !profiles.results.length ? (
				<SellerMessagesEmpty locale={locale} noBusiness />
			) : !resolved ? (
				<p role="status" className={messagePanel}>
					{t.loading}
				</p>
			) : (
				<>
					<div className="rounded-2xl border border-border bg-surface p-3 shadow-sm [&_section]:gap-3 [&_section>span]:rounded-xl [&_section>span]:bg-page [&_section>span]:px-3 [&_section>span]:py-2 [&_bdi]:font-semibold [&_bdi]:tabular-nums">
						<CountStrip
							context="seller"
							locale={locale}
							seller={selected}
							onDenied={setFailure}
						/>
					</div>
					{conversation ? (
						<Thread
							identity={identity}
							context="seller"
							locale={locale}
							id={conversation}
							seller={selected}
						/>
					) : (
						<InboxList
							key={`${list.page}:${list.unread}`}
							locale={locale}
							context="seller"
							seller={selected}
						/>
					)}
				</>
			)}
		</div>
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
				latest = await (mode === "notifications"
					? (
							context: Context,
							path: string,
							data?: unknown,
							options?: { signal?: AbortSignal },
						) => notification<Profiles>(context, path, data, "GET", options)
					: messaging<Profiles>)(
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
	const list = messageListState(search),
		page = context === "seller" ? list.page : Number(search.get("page") ?? 1),
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
	if (context === "seller") {
		const copy = sellerMessagesCopy[locale],
			number = new Intl.NumberFormat(locale);
		const change = (values: { page?: number; unread?: boolean }) =>
			router.push(
				sellerMessagesHref(locale, seller, undefined, search, false, values),
			);
		return (
			<section className="min-w-0 space-y-4" aria-label={t.messages}>
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 shadow-sm">
					<fieldset className="flex min-w-0 flex-wrap gap-2 border-0 p-0">
						<legend className="sr-only">{t.messages}</legend>
						{[false, true].map((onlyUnread) => (
							<button
								key={String(onlyUnread)}
								type="button"
								aria-pressed={unread === onlyUnread}
								className={`${messageAction} ${unread === onlyUnread ? "border-action! bg-info!" : ""}`}
								onClick={() => change({ page: 1, unread: onlyUnread })}
							>
								<Icon name={onlyUnread ? "mail" : "inbox"} className="size-4" />
								{onlyUnread ? t.unread : t.all}
							</button>
						))}
					</fieldset>
					<p className="text-sm text-muted">
						{copy.page}{" "}
						<bdi className="font-semibold tabular-nums text-foreground">
							{number.format(page)}
						</bdi>
					</p>
				</div>
				{error ? (
					<Failure locale={locale} error={error} />
				) : !data ? (
					<p role="status" className={messagePanel}>
						{t.loading}
					</p>
				) : (
					<>
						<p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
							<span>
								{copy.returned}:{" "}
								<bdi className="font-semibold tabular-nums text-foreground">
									{number.format(data.results.length)}
								</bdi>
							</span>
							<span>
								{copy.total}:{" "}
								<bdi className="font-semibold tabular-nums text-foreground">
									{number.format(data.count)}
								</bdi>
							</span>
						</p>
						{!data.results.length ? (
							<SellerMessagesEmpty
								locale={locale}
								unread={unread}
								laterPage={page > 1}
							>
								{page > 1 && (
									<button
										type="button"
										className={messageAction}
										onClick={() => change({ page: 1 })}
									>
										{copy.firstPage}
									</button>
								)}
							</SellerMessagesEmpty>
						) : (
							<ul className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
								{data.results.map((row) => (
									<li
										key={row.id}
										className="border-b border-border last:border-0"
									>
										<Link
											prefetch={false}
											className="flex min-h-11 min-w-0 items-start gap-3 p-4 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action motion-reduce:transition-none sm:gap-4"
											href={sellerMessagesHref(
												locale,
												row.seller,
												row.id,
												search,
											)}
										>
											<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-info text-action">
												<Icon name="box" className="size-5" />
											</span>
											<div className="min-w-0 flex-1 space-y-1.5">
												<div className="flex flex-wrap items-center justify-between gap-2">
													<strong
														className="min-w-0 break-words text-base"
														dir="auto"
													>
														{row.snapshot.title}
													</strong>
													{row.unread && (
														<span className="rounded-full bg-info px-2.5 py-1 text-xs font-semibold text-action">
															{t.unread}
														</span>
													)}
												</div>
												<p
													className="break-words text-sm text-muted"
													dir="auto"
												>
													{row.snapshot.seller} ·{" "}
													<bdi dir="ltr">{row.snapshot.currency}</bdi>
												</p>
												<time
													dateTime={row.updated_at}
													className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted"
												>
													<Icon name="clock" className="size-3.5" />
													<bdi>{localTimestamp(row.updated_at, locale)}</bdi>
													<span>· {t.timezone}</span>
												</time>
											</div>
											<Icon name="chevron" className="mt-3 size-4 text-muted" />
										</Link>
									</li>
								))}
							</ul>
						)}
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3">
							<p className="text-sm text-muted">
								{copy.page}{" "}
								<bdi className="tabular-nums">{number.format(page)}</bdi>
							</p>
							<div className="flex flex-wrap gap-2">
								<button
									className={messageAction}
									type="button"
									disabled={page <= 1}
									onClick={() => change({ page: page - 1 })}
								>
									{t.previous}
								</button>
								<button
									className={messageAction}
									type="button"
									disabled={page >= 10000 || page * 20 >= data.count}
									onClick={() => change({ page: page + 1 })}
								>
									{t.next}
								</button>
							</div>
						</div>
					</>
				)}
			</section>
		);
	}
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
