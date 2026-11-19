"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { sellerMessagesCopy } from "../../../lib/i18n/seller-messages";
import { PAGE_SIZE, Pager } from "../../../components/pager";
import { uuidPattern } from "../../../lib/routes/account-routes";
import { authHref } from "../../../lib/routes/auth-routes";
import { useNavigation } from "../../../components/layout/navigation-guard";
import { AccountError } from "../../../lib/api/private-client";
import { communicationCopy } from "../copy";
import {
	messaging,
	threadHref,
	shortTimestamp,
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
import {
	NoticeList,
	NotificationsHeader,
} from "../../notifications/components/notification-list";
import { SellerSelect } from "../../../components/seller-select";
import { Card } from "../../../components/shadcn/card";
import { Thread } from "./thread";
import { Enquiry } from "./enquiry";
import {
	panel,
	actionBtn,
	badge,
	help,
	ProductAvatar,
	Segmented,
	Failure,
} from "./ui";
import { EmptyState } from "../../../components/ui/empty-state";
import {
	messageListState,
	sellerMessagesHref,
	SellerMessagesHeader,
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
					className={actionBtn}
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
									: mode === "notifications"
										? `/${locale}/account/${context}/notifications${context === "seller" && search.get("seller") ? `?seller=${encodeURIComponent(search.get("seller") ?? "")}` : ""}`
										: `/${locale}/account/${context}/messages`,
						}),
					)}
				>
					{t.signIn}
				</Link>
			</div>
		);
		return context === "seller" && mode === "messages" ? (
			<div className="min-w-0 space-y-4" data-seller-messages>
				<SellerMessagesHeader
					locale={locale}
					selected=""
					profiles={[]}
					thread={!!conversation}
				/>
				<div className={`${panel} p-4`}>{feedback}</div>
			</div>
		) : mode === "notifications" ? (
			<div className="min-w-0 space-y-5">
				<NotificationsHeader locale={locale} banner={context === "seller"} />
				<Card className="gap-0 border border-solid border-border p-5 shadow-none">
					{feedback}
				</Card>
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
	const detailOpen = !!conversation;
	return (
		<div
			className="min-w-0 space-y-4"
			data-testid="communication-workspace"
			data-seller-messages
		>
			<SellerMessagesHeader
				locale={locale}
				selected={selected}
				profiles={profiles?.results ?? []}
				thread={detailOpen}
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
				<div className={`${panel} space-y-3 p-4`}>
					<Failure locale={locale} error={failure} />
					<button
						className={actionBtn}
						type="button"
						onClick={() => setRetry((value) => value + 1)}
					>
						{t.retry}
					</button>
				</div>
			) : !profiles ? (
				<p role="status" className={`${panel} p-4`}>
					{t.loading}
				</p>
			) : !profiles.results.length ? (
				<EmptyState icon="lock" title={t.noBusiness} />
			) : !resolved ? (
				<p role="status" className={`${panel} p-4`}>
					{t.loading}
				</p>
			) : (
				<div
					className={`${panel} grid min-w-0 overflow-hidden lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]`}
				>
					<aside
						className={`min-w-0 lg:border-e lg:border-border ${detailOpen ? "hidden lg:block" : "block"}`}
					>
						<InboxList
							embedded
							locale={locale}
							context="seller"
							seller={selected}
							onDenied={setFailure}
						/>
					</aside>
					<section
						className={`min-w-0 p-3 sm:p-4 ${detailOpen ? "block" : "hidden lg:block"}`}
					>
						{conversation ? (
							<Thread
								identity={identity}
								context="seller"
								locale={locale}
								id={conversation}
								seller={selected}
							/>
						) : (
							<EmptyState icon="mail" title={t.selectConversation} />
						)}
					</section>
				</div>
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
				if (page > 10000) throw new Error("Messaging profile page limit");
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
				if (!alive || controller.signal.aborted) return;
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

	const sellerSelect =
		context === "seller" && profiles?.results.length ? (
			<div className="w-full shrink-0 sm:w-64">
				<SellerSelect
					dir={direction(locale)}
					label={t.business}
					icon="store"
					value={selected}
					options={profiles.results.map((profile) => ({
						value: profile.id,
						label: profile.name,
					}))}
					onChange={(value) =>
						navigate(() =>
							router.push(`/${locale}/account/seller/${mode}?seller=${value}`),
						)
					}
				/>
			</div>
		) : null;

	if (mode === "notifications") {
		return (
			<div className="min-w-0 space-y-4" data-testid="communication-workspace">
				<NotificationsHeader locale={locale} banner={context === "seller"}>
					{sellerSelect}
				</NotificationsHeader>
				{failure ? (
					<Failure locale={locale} error={failure} />
				) : context === "seller" && !profiles ? (
					<p role="status">{t.loading}</p>
				) : context === "seller" && !profiles?.results.length ? (
					<p role="status">{t.noBusiness}</p>
				) : context === "seller" &&
					!profiles?.results.some((p) => p.id === selected) ? (
					<p role="alert">{t.denied}</p>
				) : (
					<NoticeList
						locale={locale}
						context={context}
						seller={selected}
						onDenied={setFailure}
					/>
				)}
			</div>
		);
	}

	const detailOpen = !!conversation || !!product;
	const detail: ReactNode = conversation ? (
		<Thread
			identity={identity}
			context={context}
			locale={locale}
			id={conversation}
			seller={selected}
		/>
	) : product ? (
		<Enquiry identity={identity} locale={locale} product={product} />
	) : (
		<EmptyState icon="mail" title={t.selectConversation} />
	);
	return (
		<div className="min-w-0 space-y-4" data-testid="communication-workspace">
			<header className={`${panel} px-3 py-2 sm:px-4`}>
				<h1 className="text-lg font-bold tracking-tight">{t.messages}</h1>
				<p className="truncate text-xs text-muted">{t.enquiryNote}</p>
			</header>
			{failure ? (
				<Failure locale={locale} error={failure} />
			) : (
				<div
					className={`${panel} grid min-w-0 overflow-hidden lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]`}
				>
					<aside
						className={`min-w-0 lg:border-e lg:border-border ${detailOpen ? "hidden lg:block" : "block"}`}
					>
						<InboxList
							embedded
							locale={locale}
							context={context}
							seller={selected}
							onDenied={setFailure}
						/>
					</aside>
					<section
						className={`min-w-0 p-3 sm:p-4 ${detailOpen ? "block" : "hidden lg:block"}`}
					>
						{detail}
					</section>
				</div>
			)}
		</div>
	);
}

function InboxList({
	locale,
	context,
	seller,
	embedded = false,
	onDenied,
}: {
	locale: Locale;
	context: Context;
	seller: string;
	embedded?: boolean;
	onDenied?: (error: unknown) => void;
}) {
	const t = communicationCopy[locale],
		copy = sellerMessagesCopy[locale],
		search = useSearchParams(),
		router = useRouter(),
		path = usePathname(),
		number = new Intl.NumberFormat(locale);
	const list = messageListState(search),
		page = list.page,
		unread = list.unread;
	const [data, setData] = useState<Inbox | null>(null),
		[error, setError] = useState<unknown>(null);
	const change = (values: { page?: number; unread?: boolean }) => {
		if (context === "seller") {
			router.push(
				sellerMessagesHref(locale, seller, undefined, search, false, values),
			);
			return;
		}
		const q = new URLSearchParams(search);
		if (values.page !== undefined)
			values.page > 1 ? q.set("page", String(values.page)) : q.delete("page");
		if (values.unread !== undefined)
			values.unread ? q.set("unread", "true") : q.delete("unread");
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
		<section
			className={embedded ? "min-w-0" : "min-w-0 space-y-3"}
			aria-label={t.messages}
		>
			<div
				className={
					embedded
						? "flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4"
						: "flex flex-wrap items-center justify-between gap-2"
				}
			>
				<Segmented
					value={unread ? "unread" : "all"}
					onChange={(value) => change({ page: 1, unread: value === "unread" })}
					options={[
						{ value: "all", label: t.all, icon: "inbox" },
						{ value: "unread", label: t.unread, icon: "mail" },
					]}
					ariaLabel={t.messages}
				/>
				{embedded && (
					<CountStrip
						context={context}
						locale={locale}
						seller={seller}
						onDenied={onDenied}
					/>
				)}
			</div>
			{error ? (
				<div className={embedded ? "px-3 pb-3 sm:px-4" : ""}>
					<Failure locale={locale} error={error} />
				</div>
			) : !data ? (
				<p
					role="status"
					className={
						embedded ? `${panel} mx-3 mb-3 p-4 sm:mx-4` : `${panel} p-4`
					}
				>
					{t.loading}
				</p>
			) : (
				<>
					{!embedded && (
						<p className={`${help} flex flex-wrap gap-x-4 gap-y-1`}>
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
					)}
					{!data.results.length ? (
						<div className={embedded ? "px-3 pb-3 sm:px-4" : ""}>
							<EmptyState
								icon={unread ? "mail" : "inbox"}
								title={t.empty}
								description={page > 1 ? copy.emptyPageHelp : undefined}
								action={
									page > 1 ? (
										<button
											type="button"
											className={actionBtn}
											onClick={() => change({ page: 1 })}
										>
											{t.firstPage}
										</button>
									) : undefined
								}
							/>
						</div>
					) : (
						<ul
							className={
								embedded
									? "m-0 list-none divide-y divide-border overflow-hidden p-0"
									: `${panel} m-0 list-none divide-y divide-border overflow-hidden p-0`
							}
						>
							{data.results.map((row) => (
								<li key={row.id}>
									<Link
										prefetch={false}
										className="flex min-w-0 items-start gap-3 py-3 pe-3 ps-2 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action motion-reduce:transition-none sm:pe-4"
										href={
											context === "seller"
												? sellerMessagesHref(locale, row.seller, row.id, search)
												: threadHref(locale, context, row.id, seller)
										}
									>
										<ProductAvatar
											locale={locale}
											product={row.snapshot.product}
											label={row.snapshot.title}
										/>
										<div className="min-w-0 flex-1 space-y-1">
											<div className="flex items-baseline justify-between gap-2">
												<strong
													className="min-w-0 truncate text-sm font-semibold"
													dir="auto"
												>
													{row.snapshot.title}
												</strong>
												<time
													dateTime={row.updated_at}
													className="shrink-0 text-xs text-muted"
												>
													<bdi>{shortTimestamp(row.updated_at, locale)}</bdi>
												</time>
											</div>
											<p className="truncate text-sm text-muted" dir="auto">
												{row.snapshot.seller} ·{" "}
												<bdi dir="ltr">{row.snapshot.currency}</bdi>
											</p>
										</div>
										{row.unread && <span className={badge}>{t.unread}</span>}
									</Link>
								</li>
							))}
						</ul>
					)}
					{embedded ? (
						data.count > PAGE_SIZE && (
							<Pager
								locale={locale}
								page={page}
								count={data.count}
								pageSize={PAGE_SIZE}
								onPage={(n) => change({ page: n })}
								labels={{ prev: t.previous, next: t.next, page: t.page }}
								className="flex items-center justify-end gap-1 px-3 py-3 sm:px-4"
							/>
						)
					) : (
						<Pager
							locale={locale}
							page={page}
							count={data.count}
							pageSize={PAGE_SIZE}
							onPage={(n) => change({ page: n })}
							labels={{ prev: t.previous, next: t.next, page: t.page }}
							className="flex flex-wrap items-center justify-between gap-2"
						/>
					)}
				</>
			)}
		</section>
	);
}
