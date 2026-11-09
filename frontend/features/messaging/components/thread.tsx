"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "../../../components/ui/icon";
import { sellerMessagesCopy } from "../../../lib/i18n/seller-messages";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
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
	type ImageRef,} from "../api";
import { communicationCopy } from "../copy";
import { useVisiblePoll, accessLost } from "../hooks";
import { clearDrafts, scopeKey } from "../drafts";
import { ReportForm as MessageReport } from "./report";
import { Composer } from "./composer";
import { action, Failure } from "./controls";
import {
	messageAction,
	messagePanel,
	sellerMessagesHref,
} from "./seller-messages-ui";
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
		sellerPresentation = context === "seller",
		copy = sellerMessagesCopy[locale],
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
	return (
		<section
			className="min-w-0 space-y-4"
			aria-label={t.messages}
			data-testid="message-thread"
		>
			<Link
				prefetch={false}
				className={context === "seller" ? messageAction : action}
				href={
					sellerPresentation
						? sellerMessagesHref(locale, seller, undefined, search, true)
						: `/${locale}/account/${context}/messages${seller ? `?seller=${seller}` : ""}`
				}
			>
				{sellerPresentation && (
					<Icon name="arrow" className="size-4 ltr:rotate-180" />
				)}
				{t.back}
			</Link>
			{!!error && <Failure locale={locale} error={error} />}
			{!detail && !error && <p role="status">{t.loading}</p>}
			{detail && (
				<>
					<header
						className={
							sellerPresentation
								? messagePanel
								: "space-y-2 rounded-card border border-border bg-surface p-4"
						}
					>
						{sellerPresentation && (
							<p className="flex items-center gap-2 text-xs font-semibold text-muted">
								<Icon name="box" className="size-4" />
								{copy.snapshot}
							</p>
						)}
						<h2 className="break-words text-xl font-bold" dir="auto">
							{detail.snapshot.title}
						</h2>
						<p
							dir="auto"
							className={sellerPresentation ? "text-sm text-muted" : undefined}
						>
							{detail.snapshot.seller} ·{" "}
							<bdi dir="ltr">{detail.snapshot.currency}</bdi>
						</p>
						{detail.can_send ? (
							<Link
								prefetch={false}
								className={
									sellerPresentation
										? messageAction
										: "inline-flex min-h-11 items-center"
								}
								href={`/${locale}/products/${detail.snapshot.product}`}
							>
								{sellerPresentation && <Icon name="eye" className="size-4" />}
								{t.product}
							</Link>
						) : (
							<p role="status" className="text-warning">
								{t.readonly}
							</p>
						)}
						<p className="text-sm text-muted">{t.timezone}</p>
					</header>
					{older && (
						<button
							type="button"
							className={context === "seller" ? messageAction : action}
							disabled={busy}
							onClick={() => void earlier()}
						>
							{t.older}
						</button>
					)}
					<section
						ref={pane}
						className={
							sellerPresentation
								? "max-h-[38rem] min-w-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-page p-3 focus-visible:outline-2 focus-visible:outline-action sm:p-5"
								: "max-h-[38rem] min-w-0 space-y-4 overflow-y-auto rounded-card border border-border bg-page p-3 desktop:p-5"
						}
						tabIndex={sellerPresentation ? 0 : undefined}
						aria-label={t.messages}
						data-testid="message-history"
					>
						{rows.map((row) => (
							<article
								key={row.id}
								data-sequence={row.own ? undefined : row.sequence}
								className={
									sellerPresentation
										? `w-fit min-w-0 max-w-[95%] space-y-3 rounded-2xl border border-border p-3 text-sm leading-relaxed shadow-sm sm:max-w-[85%] sm:p-4 ${row.own ? "ms-auto bg-info" : "me-auto bg-surface"}`
										: `min-w-0 space-y-3 rounded-card border border-border p-4 ${row.own ? "ms-4 bg-info desktop:ms-12" : "me-4 bg-surface desktop:me-12"}`
								}
							>
								<header className="flex flex-wrap items-center justify-between gap-2 text-sm">
									<strong
										className="min-w-0 [overflow-wrap:anywhere]"
										dir="auto"
									>
										{row.own ? t.you : row.author}
									</strong>
									<time
										className={
											sellerPresentation
												? "min-w-0 text-xs text-muted [overflow-wrap:anywhere]"
												: "min-w-0 [overflow-wrap:anywhere]"
										}
										dateTime={row.created_at}
									>
										<bdi>{localTimestamp(row.created_at, locale)}</bdi>
									</time>
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
									<div className="flex flex-wrap gap-3">
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
								<MessageReport
									key={row.id}
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
							</article>
						))}
					</section>
					{newMessages && (
						<button
							type="button"
							className={context === "seller" ? messageAction : action}
							onClick={() => {
								pane.current?.scrollTo({
									top: pane.current.scrollHeight,
									behavior:
										sellerPresentation &&
										window.matchMedia("(prefers-reduced-motion: reduce)")
											.matches
											? "auto"
											: "smooth",
								});
								setNewMessages(false);
							}}
						>
							{t.newMessages}
						</button>
					)}
					<Composer
						key={`${identity}:${context}:${seller}:${id}`}
						locale={locale}
						presentation={sellerPresentation ? "seller" : undefined}
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
function ProtectedImage({
	context,
	image,
	locale,
}: {
	context: Context;
	image: ImageRef;
	locale: Locale;
}) {
	const dialog = useRef<HTMLDialogElement>(null),
		t = communicationCopy[locale],
		[error, setError] = useState(false),
		[open, setOpen] = useState(false);
	const url = `${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/messaging/${context}/attachments/${image.id}/`;
	return (
		<div className="max-w-full">
			{error ? (
				<p role="alert">{t.failed}</p>
			) : (
				<button
					type="button"
					className={
						context === "seller"
							? "min-h-11 min-w-11 max-w-full rounded-xl border border-border bg-surface p-2 transition-colors hover:border-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
							: "min-h-11 max-w-full rounded-control border border-border p-2"
					}
					aria-label={t.enlarge}
					onClick={() => {
						setOpen(true);
						dialog.current?.showModal();
					}}
				>
					{/* biome-ignore lint/performance/noImgElement: authenticated no-store bytes must bypass the public image optimizer. */}
					<img
						loading="lazy"
						referrerPolicy="no-referrer"
						src={url}
						alt={t.images}
						width={image.width}
						height={image.height}
						className="max-h-48 max-w-full object-contain"
						onError={() => setError(true)}
					/>
				</button>
			)}
			<dialog
				ref={dialog}
				onClose={() => setOpen(false)}
				className={
					context === "seller"
						? "max-h-[90dvh] max-w-[92vw] space-y-3 overflow-auto rounded-2xl border border-border bg-surface p-4 text-foreground shadow-lifted backdrop:bg-black/50"
						: "max-h-[90dvh] max-w-[92vw] space-y-3 rounded-card border border-border bg-surface p-4 text-foreground backdrop:bg-black/50"
				}
				aria-label={t.enlarge}
			>
				<button
					type="button"
					className={context === "seller" ? messageAction : action}
					onClick={() => dialog.current?.close()}
				>
					{t.close}
				</button>
				{open && (
					// biome-ignore lint/performance/noImgElement: private authenticated bytes must bypass the public image optimizer.
					<img
						referrerPolicy="no-referrer"
						src={url}
						alt={t.images}
						width={image.width}
						height={image.height}
						className="max-h-[72dvh] max-w-full object-contain"
					/>
				)}
			</dialog>
		</div>
	);
}
