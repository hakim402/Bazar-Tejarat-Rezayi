"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "../../../components/ui/icon";
import { Button } from "../../../components/shadcn/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../../components/shadcn/dialog";
import { useEffect, useRef, useState } from "react";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { apiOrigin } from "../../../lib/api/client";
import { AccountError } from "../../../lib/api/private-client";
import {
	messaging,
	localTimestamp,
	type Context,
	type Conversation,
	type History,
	type Message,
	type Sent,
	type ImageRef,
} from "../api";
import { communicationCopy } from "../copy";
import { useVisiblePoll, accessLost } from "../hooks";
import { clearDrafts, scopeKey } from "../drafts";
import { MessageMenu } from "./message-menu";
import { Composer } from "./composer";
import { panel, actionBtn, badge, Avatar, Failure } from "./ui";
import { sellerMessagesHref } from "./seller-messages-ui";
import { ConversationInfo } from "./info-dialog";
import { usePublicProduct } from "../product";
import { mediaUrl } from "../../marketplace/api";

export function Thread({
	identity,
	locale,
	context,
	id,
	seller,
}: {
	identity: string;
	locale: Locale;
	context: Context;
	id: string;
	seller: string;
}) {
	const search = useSearchParams(),
		t = communicationCopy[locale],
		[detail, setDetail] = useState<Conversation | null>(null),
		[rows, setRows] = useState<Message[]>([]),
		[error, setError] = useState<unknown>(null),
		[older, setOlder] = useState(false),
		[busy, setBusy] = useState(false),
		[reload, setReload] = useState(0),
		[newMessages, setNewMessages] = useState(false),
		[displayed, setDisplayed] = useState(0);
	const pane = useRef<HTMLElement>(null),
		live = useRef<object | null>({}),
		current = useRef<Message[]>([]),
		proof = useRef({ max: 0, receipt: "", at: 0 }),
		acked = useRef(0),
		olderBusy = useRef(false);
	useEffect(() => {
		live.current = {};
		return () => {
			live.current = null;
		};
	}, []);
	const merge = (data: History) => {
		const map = new Map(current.current.map((x) => [x.id, x]));
		for (const row of data.results) map.set(row.id, row);
		const values = [...map.values()].sort((a, b) => a.sequence - b.sequence);
		current.current = values;
		setRows(values);
		if (data.latest >= proof.current.max)
			proof.current = {
				max: data.latest,
				receipt: data.receipt,
				at: Date.now(),
			};
	};
	useVisiblePoll(
		async (signal) => {
			try {
				const d = await messaging<Conversation>(
					context,
					`conversations/${id}/`,
					undefined,
					{ signal },
				);
				if (signal.aborted) return;
				if (context === "seller" && d.seller !== seller)
					throw new AccountError(404);
				const newest = current.current.at(-1)?.sequence;
				const after =
					newest && Date.now() - proof.current.at < 45 * 60 * 1000
						? newest
						: undefined;
				const h = await messaging<History>(
					context,
					`conversations/${id}/messages/${after ? `?after=${after}` : ""}`,
					undefined,
					{ signal },
				);
				if (signal.aborted) return;
				setDetail(d);
				setError(null);
				const initial = current.current.length === 0,
					atBottom =
						!!pane.current &&
						pane.current.scrollHeight -
							pane.current.scrollTop -
							pane.current.clientHeight <
							40;
				merge(h);
				if (initial) setOlder(h.has_more);
				if (initial || atBottom)
					requestAnimationFrame(() => {
						if (!signal.aborted && pane.current)
							pane.current.scrollTop = pane.current.scrollHeight;
					});
				else if (h.results.some((row) => row.sequence > (newest ?? 0)))
					setNewMessages(true);
			} catch (e) {
				if (signal.aborted) return;
				setError(e);
				if (accessLost(e)) {
					clearDrafts();
					setDetail(null);
					setRows([]);
					current.current = [];
				}
				throw e;
			}
		},
		[context, id, seller, reload],
	);
	useEffect(() => {
		if (!rows.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (document.hidden) return;
				for (const entry of entries)
					if (entry.isIntersecting) {
						const seq = Number((entry.target as HTMLElement).dataset.sequence);
						setDisplayed((old) => Math.max(old, seq));
					}
			},
			{ threshold: 0.1 },
		);
		for (const element of pane.current?.querySelectorAll("[data-sequence]") ??
			[])
			observer.observe(element);
		return () => observer.disconnect();
	}, [rows]);
	useEffect(() => {
		if (
			!displayed ||
			!rows.length ||
			displayed <= acked.current ||
			document.hidden ||
			!proof.current.receipt
		)
			return;
		const mine = live.current,
			controller = new AbortController();
		const timer = setTimeout(() => {
			void messaging(
				context,
				`conversations/${id}/read/`,
				{ sequence: displayed, receipt: proof.current.receipt },
				{ signal: controller.signal },
			)
				.then(() => {
					if (mine && live.current === mine)
						acked.current = Math.max(acked.current, displayed);
				})
				.catch((e) => {
					if (mine && live.current === mine && !controller.signal.aborted) {
						setError(e);
						if (accessLost(e)) {
							clearDrafts();
							setDetail(null);
							setRows([]);
							current.current = [];
						}
					}
				});
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [displayed, context, id, rows]);
	async function earlier() {
		if (olderBusy.current) return;
		olderBusy.current = true;
		setBusy(true);
		const mine = live.current,
			controller = new AbortController();
		try {
			const before = current.current[0]?.sequence;
			if (!before) return;
			const h = await messaging<History>(
				context,
				`conversations/${id}/messages/?before=${before}`,
				undefined,
				{ signal: controller.signal },
			);
			if (!mine || live.current !== mine) return;
			const previous = pane.current?.scrollHeight ?? 0;
			merge(h);
			setOlder(h.has_more);
			requestAnimationFrame(() => {
				if (live.current === mine && pane.current)
					pane.current.scrollTop += pane.current.scrollHeight - previous;
			});
		} catch (e) {
			if (mine && live.current === mine) {
				setError(e);
				if (accessLost(e)) {
					clearDrafts();
					setDetail(null);
					setRows([]);
					current.current = [];
				}
			}
		} finally {
			if (mine && live.current === mine) {
				olderBusy.current = false;
				setBusy(false);
			}
		}
	}
	const isSeller = context === "seller",
		buyer = isSeller
			? (rows.filter((row) => !row.own).at(-1)?.author ?? null)
			: null,
		lastAt = rows.at(-1)?.created_at ?? null;
	return (
		<section
			className="flex min-w-0 flex-col gap-3"
			aria-label={t.messages}
			data-testid="message-thread"
		>
			<Link
				prefetch={false}
				className={`${actionBtn} lg:hidden`}
				href={
					context === "seller"
						? sellerMessagesHref(locale, seller, undefined, search, true)
						: `/${locale}/account/${context}/messages${seller ? `?seller=${seller}` : ""}`
				}
			>
				<Icon name="arrow" className="size-4 ltr:rotate-180" />
				{t.back}
			</Link>
			{!!error && <Failure locale={locale} error={error} />}
			{!detail && !error && (
				<p role="status" className={`${panel} p-4`}>
					{t.loading}
				</p>
			)}
			{detail && (
				<>
					<ThreadHeader
						locale={locale}
						snapshot={detail.snapshot}
						buyer={buyer}
						isSeller={isSeller}
						updatedAt={lastAt}
						unread={detail.unread}
						readonly={!detail.can_send}
					/>
					{older && (
						<button
							type="button"
							className={actionBtn}
							disabled={busy}
							onClick={() => void earlier()}
						>
							<Icon name="history" className="size-4" />
							{t.older}
						</button>
					)}
					<section
						ref={pane}
						/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable history must be reachable by keyboard. */
						tabIndex={0}
						className="max-h-[38rem] min-w-0 space-y-3 overflow-y-auto rounded-2xl border border-border bg-page p-3 focus-visible:outline-2 focus-visible:outline-action sm:p-4"
						aria-label={t.messages}
						data-testid="message-history"
					>
						{rows.map((row) => (
							<article
								key={row.id}
								data-sequence={row.own ? undefined : row.sequence}
								className={`w-fit min-w-0 max-w-[95%] space-y-2 border p-3 text-sm leading-relaxed shadow-sm sm:max-w-[85%] ${
									row.own
										? "ms-auto rounded-2xl rounded-ee-sm border-transparent bg-info text-foreground"
										: "me-auto rounded-2xl rounded-es-sm border-border bg-surface text-foreground"
								}`}
							>
								<header className="flex flex-wrap items-center justify-between gap-2 text-xs">
									<strong
										className="min-w-0 [overflow-wrap:anywhere]"
										dir="auto"
									>
										{row.own ? t.you : row.author}
									</strong>
									<span className="flex shrink-0 items-center gap-1">
										<time className="text-muted" dateTime={row.created_at}>
											<bdi>{localTimestamp(row.created_at, locale)}</bdi>
										</time>
										<MessageMenu
											context={context}
											id={row.id}
											locale={locale}
											onDenied={(error) => {
												clearDrafts();
												setError(error);
												setDetail(null);
												setRows([]);
												current.current = [];
											}}
										/>
									</span>
								</header>
								{row.body && (
									<p
										dir="auto"
										className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
									>
										{row.body}
									</p>
								)}
								{!!row.images.length && (
									<div className="flex flex-wrap gap-2">
										{row.images.map((image) => (
											<ProtectedImage
												key={image.id}
												context={context}
												image={image}
												locale={locale}
											/>
										))}
									</div>
								)}
							</article>
						))}
					</section>
					<div aria-live="polite">
						{newMessages && (
							<button
								type="button"
								className={actionBtn}
								onClick={() => {
									pane.current?.scrollTo({
										top: pane.current.scrollHeight,
										behavior: window.matchMedia(
											"(prefers-reduced-motion: reduce)",
										).matches
											? "auto"
											: "smooth",
									});
									setNewMessages(false);
								}}
							>
								<Icon name="arrow-down" className="size-4" />
								{t.newMessages}
							</button>
						)}
					</div>
					<Composer
						key={`${identity}:${context}:${seller}:${id}`}
						locale={locale}
						draftKey={scopeKey(identity, context, seller, id)}
						uploadPath={`messaging/${context}/conversations/${id}/uploads/`}
						allowed={detail.can_send && !error}
						send={(value, signal) =>
							messaging<Sent>(context, `conversations/${id}/messages/`, value, {
								signal,
							})
						}
						onDenied={(error) => {
							setError(error);
							setDetail(null);
							setRows([]);
							current.current = [];
						}}
						onSaved={() => setReload((v) => v + 1)}
					/>
				</>
			)}
		</section>
	);
}

function ThreadHeader({
	locale,
	snapshot,
	buyer,
	isSeller,
	updatedAt,
	unread,
	readonly,
}: {
	locale: Locale;
	snapshot: Conversation["snapshot"];
	buyer: string | null;
	isSeller: boolean;
	updatedAt: string | null;
	unread: boolean;
	readonly: boolean;
}) {
	const t = communicationCopy[locale],
		product = usePublicProduct(locale, snapshot.product);
	const cover = product?.images[0],
		logo = product?.store.logo,
		shop = product?.store.name ?? snapshot.seller,
		title = product?.body.title ?? snapshot.title;
	return (
		<header className={`${panel} flex flex-wrap items-center gap-3 p-3 sm:p-4`}>
			{cover ? (
				// biome-ignore lint/performance/noImgElement: cached public marketplace cover used as the conversation image.
				<img
					src={mediaUrl(cover.url)}
					alt={cover.alt}
					className="size-12 shrink-0 rounded-xl border border-border object-cover"
				/>
			) : (
				<Avatar label={title} className="size-12 rounded-xl text-sm" />
			)}
			<div className="min-w-0 flex-1 space-y-0.5">
				<h2 className="truncate text-base font-bold" dir="auto">
					{isSeller ? (buyer ?? title) : title}
				</h2>
				<p className="truncate text-xs text-muted" dir="auto">
					{isSeller ? title : shop} · <bdi dir="ltr">{snapshot.currency}</bdi>
				</p>
			</div>
			<span className="flex shrink-0 items-center gap-2">
				<span className="flex items-center gap-2 rounded-full border border-border bg-page py-1 pe-3 ps-1">
					{logo ? (
						// biome-ignore lint/performance/noImgElement: cached public store logo rendered as a small profile chip.
						<img
							src={mediaUrl(logo.url)}
							alt={logo.alt}
							className="size-7 rounded-full object-cover"
						/>
					) : (
						<Avatar label={shop} className="size-7 text-[0.625rem]" />
					)}
					<span className="max-w-32 truncate text-xs font-semibold" dir="auto">
						{shop}
					</span>
				</span>
				<ConversationInfo
					locale={locale}
					snapshot={snapshot}
					buyer={buyer}
					updatedAt={updatedAt}
					unread={unread}
				/>
				{readonly && (
					<span role="status" className={`${badge} text-warning`}>
						{t.readonly}
					</span>
				)}
			</span>
		</header>
	);
}

function ProtectedImage({
	context,
	image,
	locale,
}: {
	context: Context;
	image: ImageRef;
	locale: Locale;
}) {
	const t = communicationCopy[locale],
		[error, setError] = useState(false);
	const url = `${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/messaging/${context}/attachments/${image.id}/`;
	return (
		<div className="max-w-full">
			{error ? (
				<p role="alert">{t.failed}</p>
			) : (
				<Dialog>
					<DialogTrigger asChild>
						<button
							type="button"
							className="min-h-11 min-w-11 max-w-full cursor-pointer rounded-xl border border-border bg-surface p-1 transition-colors hover:border-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
							aria-label={t.enlarge}
						>
							{/* biome-ignore lint/performance/noImgElement: authenticated no-store bytes must bypass the public image optimizer. */}
							<img
								loading="lazy"
								referrerPolicy="no-referrer"
								src={url}
								alt={t.images}
								width={image.width}
								height={image.height}
								className="size-24 rounded-lg object-cover"
								onError={() => setError(true)}
							/>
						</button>
					</DialogTrigger>
					<DialogContent
						dir={direction(locale)}
						showCloseButton={false}
						className="max-h-[90dvh] max-w-[92vw] gap-3 overflow-auto rounded-2xl p-4"
					>
						<DialogHeader className="sr-only">
							<DialogTitle>{t.enlarge}</DialogTitle>
						</DialogHeader>
						{/* biome-ignore lint/performance/noImgElement: private authenticated bytes must bypass the public image optimizer. */}
						<img
							referrerPolicy="no-referrer"
							src={url}
							alt={t.images}
							width={image.width}
							height={image.height}
							className="max-h-[72dvh] max-w-full object-contain"
						/>
						<DialogFooter>
							<DialogClose asChild>
								<Button
									type="button"
									variant="secondary"
									className="rounded-lg"
								>
									{t.close}
								</Button>
							</DialogClose>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
