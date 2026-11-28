"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { Button } from "../../../components/shadcn/button";
import { Badge } from "../../../components/shadcn/badge";
import { Card } from "../../../components/shadcn/card";
import { Icon, type IconName } from "../../../components/ui/icon";
import { EmptyState } from "../../../components/ui/empty-state";
import { pageBannerClass } from "../../../components/ui/page-header";
import { PAGE_SIZE, Pager } from "../../../components/pager";
import { OwnReports } from "../../messaging/components/report";
import { Failure, failureMessage } from "../../messaging/components/ui";
import {
	type Context,
	threadHref,
	localTimestamp,
	reportTargetHref,
} from "../../messaging/api";
import { communicationCopy } from "../../messaging/copy";
import { useVisiblePoll, accessLost } from "../../messaging/hooks";
import { clearDrafts } from "../../messaging/drafts";
import { fulfilmentHref } from "../../fulfilment/api";
import { fulfilmentCopy } from "../../fulfilment/copy";
import { aftercareHref } from "../../aftercare/api";
import { aftercareCopy } from "../../aftercare/copy";
import { paymentHref } from "../../payments/api";
import { paymentCopy } from "../../payments/copy";
import { requestHref } from "../../negotiations/api";
import { negotiationCopy } from "../../negotiations/copy";
import { invoiceHref } from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import { notification, type Notices } from "../api";
import { reviewNoticeDetails } from "../review-presentation";
import { reviewFlowCopy } from "@/lib/i18n/review-flow";
import { notificationCopy } from "../copy";
import { CountStrip } from "./unread-counts";

type Notice = Notices["results"][number];
const noticeAppearance: Record<
	Notice["kind"],
	{ icon: IconName; color: string }
> = {
	business_review: { icon: "shield", color: "text-action" },
	product_review: { icon: "box", color: "text-action" },
	message: { icon: "mail", color: "text-warning" },
	report_status: { icon: "shield", color: "text-warning" },
	order_accepted: { icon: "receipt", color: "text-success" },
	negotiation: { icon: "handshake", color: "text-action" },
	payment: { icon: "wallet", color: "text-action" },
	fulfilment: { icon: "truck", color: "text-action" },
	aftercare: { icon: "return", color: "text-warning" },
};

function noticeDetails(row: Notice, locale: Locale, context: Context) {
	const t = communicationCopy[locale];
	const review = reviewNoticeDetails(row, locale, context);
	if (review) return review;
	const seller = context === "seller" ? (row.seller ?? undefined) : undefined;
	const href =
		row.kind === "report_status" && (row.product || row.store || row.order)
			? reportTargetHref(
					locale,
					context,
					row.product ? "product" : row.store ? "store" : "order",
					row.product ?? row.store ?? row.order ?? "",
					row.seller ?? undefined,
				)
			: row.kind === "aftercare"
				? aftercareHref(locale, context, row.aftercare ?? undefined, seller)
				: row.fulfilment
					? fulfilmentHref(locale, context, row.fulfilment, seller)
					: row.payment
						? paymentHref(locale, context, row.payment, seller)
						: row.negotiation
							? requestHref(locale, context, row.negotiation, seller)
							: row.invoice
								? invoiceHref(locale, context, row.invoice, seller)
								: threadHref(
										locale,
										context,
										row.conversation ?? "",
										row.seller ?? undefined,
									);
	const title =
		row.kind === "aftercare"
			? aftercareCopy[locale].title
			: row.kind === "fulfilment"
				? fulfilmentCopy[locale][
						context === "buyer" ? "buyerTitle" : "sellerTitle"
					]
				: row.kind === "payment"
					? paymentCopy[locale].title
					: row.kind === "negotiation"
						? negotiationCopy[locale].title +
							" · " +
							(row.action && row.action in negotiationCopy[locale]
								? negotiationCopy[locale][
										row.action as keyof typeof negotiationCopy.en
									]
								: negotiationCopy[locale].request)
						: row.kind === "order_accepted"
							? commerceCopy[locale].accepted +
								" · " +
								commerceCopy[locale].invoices
							: row.kind === "message"
								? t.newMessage
								: t.reportStatus;
	return { href, title };
}

function relativeTimestamp(value: string, locale: Locale) {
	const seconds = (new Date(value).getTime() - Date.now()) / 1000;
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["year", 31536000],
		["month", 2592000],
		["week", 604800],
		["day", 86400],
		["hour", 3600],
		["minute", 60],
		["second", 1],
	];
	const [unit, size] =
		units.find(([, size]) => Math.abs(seconds) >= size) ??
		units[units.length - 1];
	return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
		Math.round(seconds / size),
		unit,
	);
}

export function NotificationsHeader({
	locale,
	children,
	banner = false,
}: {
	locale: Locale;
	children?: ReactNode;
	banner?: boolean;
}) {
	const t = communicationCopy[locale];
	return (
		<header
			className={`${banner ? `${pageBannerClass} ` : ""}flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
		>
			<div className="min-w-0">
				<h1 className="m-0 text-2xl font-bold">{t.notifications}</h1>
				<p className="m-0 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
					{t.notificationsHelp}
				</p>
			</div>
			{children}
		</header>
	);
}

function WaveDivider() {
	const id = useId();
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			className="block h-2 w-full shrink-0 text-border"
			width="100%"
			height="8"
		>
			<defs>
				<pattern id={id} width="24" height="8" patternUnits="userSpaceOnUse">
					<path d="M0 4 Q6 -2 12 4 T24 4" fill="none" stroke="currentColor" />
				</pattern>
			</defs>
			<rect width="100%" height="8" fill={`url(#${id})`} />
		</svg>
	);
}

function NoticeItem({
	row,
	locale,
	context,
	busy,
	onRead,
}: {
	row: Notice;
	locale: Locale;
	context: Context;
	busy: boolean;
	onRead: (id: string) => void;
}) {
	const t = communicationCopy[locale],
		{ href, title } = noticeDetails(row, locale, context);
	const appearance = noticeAppearance[row.kind];
	return (
		<li className="group relative flex items-start gap-3 pb-7 last:pb-0 sm:gap-4">
			<span
				aria-hidden="true"
				className="absolute start-5 top-10 bottom-0 w-px bg-border group-last:hidden"
			/>
			<span
				aria-hidden="true"
				className={`relative flex size-10 shrink-0 items-center justify-center rounded-full border border-solid border-border bg-surface ${appearance.color}`}
			>
				<Icon name={appearance.icon} className="size-5" />
			</span>
			<div className="min-w-0 flex-1 pt-0.5">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<Link
						prefetch={false}
						href={href}
						className="min-w-0 text-sm font-semibold leading-6 text-foreground no-underline hover:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:text-base"
					>
						{title}
					</Link>
					{!row.read && (
						<Badge
							variant="secondary"
							className="rounded-full border-0 bg-info text-action"
						>
							{t.unread}
						</Badge>
					)}
					<time
						dateTime={row.created_at}
						title={`${localTimestamp(row.created_at, locale)} · ${t.timezone}`}
						className="basis-full text-xs text-muted sm:ms-auto sm:basis-auto sm:ps-3"
					>
						<bdi>{relativeTimestamp(row.created_at, locale)}</bdi>
					</time>
				</div>
				<p className="m-0 mt-1 text-sm leading-relaxed text-muted">
					{row.kind === "business_review" || row.kind === "product_review"
						? row.title
						: notificationCopy[locale][row.kind]}
				</p>
				{(row.kind === "business_review" || row.kind === "product_review") &&
					row.reason && (
						<p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm text-muted">
							{reviewFlowCopy[locale].reason} · {row.reason}
						</p>
					)}
			</div>
			{!row.read && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-11 shrink-0 rounded-full text-muted hover:text-action"
					disabled={busy}
					onClick={() => onRead(row.id)}
					aria-label={`${t.markRead}: ${title}`}
					title={t.markRead}
				>
					<Icon name="check-circle" className="size-4" />
				</Button>
			)}
		</li>
	);
}

export function NoticeList({
	locale,
	context,
	seller,
	onDenied,
}: {
	locale: Locale;
	context: Context;
	seller: string;
	onDenied?: (error: unknown) => void;
}) {
	const t = communicationCopy[locale],
		copy = notificationCopy[locale],
		search = useSearchParams(),
		router = useRouter(),
		path = usePathname(),
		page = Number(search.get("page") ?? 1);
	const [data, setData] = useState<Notices | null>(null),
		[error, setError] = useState<unknown>(null),
		[reload, setReload] = useState(0),
		[busy, setBusy] = useState(false);
	const owned = useRef<object | null>(null),
		alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			owned.current = null;
		};
	}, []);
	useVisiblePoll(
		async (signal) => {
			try {
				if (!Number.isInteger(page) || page < 1 || page > 10000)
					throw new AccountError(400);
				const value = await notification<Notices>(
					context,
					`?page=${page}${seller ? `&seller=${seller}` : ""}`,
					undefined,
					"GET",
					{ signal },
				);
				if (signal.aborted) return;
				setData(value);
				setError(null);
			} catch (e) {
				if (signal.aborted) return;
				setData(null);
				setError(e);
				if (accessLost(e)) {
					clearDrafts();
					onDenied?.(e);
				}
				throw e;
			}
		},
		[context, seller, page, reload],
	);
	async function mark(id: string) {
		if (owned.current) return;
		const owner = {};
		owned.current = owner;
		setBusy(true);
		try {
			await notification(context, `${id}/read/`, {});
			if (alive.current && owned.current === owner) {
				setReload((v) => v + 1);
				toast.success(t.noticeRead);
			}
		} catch (e) {
			if (alive.current && owned.current === owner) {
				if (accessLost(e)) {
					clearDrafts();
					setData(null);
					onDenied?.(e);
				} else toast.error(failureMessage(locale, e));
				setError(e);
			}
		} finally {
			if (alive.current && owned.current === owner) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	const select = (next: number) => {
		if (next === page) return;
		const q = new URLSearchParams(search);
		q.set("page", String(next));
		router.push(`${path}?${q}`);
	};
	const current = data?.page === page ? data : null;
	const content = error ? (
		<Failure locale={locale} error={error} />
	) : !current ? (
		<div
			role="status"
			className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted"
		>
			<Icon name="bell" className="size-5" />
			{t.loading}
		</div>
	) : !current.results.length ? (
		<EmptyState
			borderless
			icon="bell"
			title={t.emptyNotices}
			description={page > 1 ? undefined : copy.empty}
			action={
				page > 1 ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => select(1)}
					>
						{t.firstPage}
					</Button>
				) : undefined
			}
		/>
	) : (
		<ul className="m-0 list-none p-0">
			{current.results.map((row) => (
				<NoticeItem
					key={row.id}
					row={row}
					locale={locale}
					context={context}
					busy={busy}
					onRead={(id) => void mark(id)}
				/>
			))}
		</ul>
	);
	return (
		<section className="min-w-0 space-y-4" aria-label={t.notifications}>
			<Card className="gap-0 overflow-hidden rounded-2xl border border-solid border-border py-0 shadow-none">
				<div className="flex items-center justify-between gap-4 px-4 py-5 sm:px-6">
					<div className="min-w-0 space-y-1">
						<h2 className="m-0 text-base font-semibold">{copy.inbox}</h2>
						<CountStrip
							locale={locale}
							context={context}
							seller={seller}
							variant="summary"
							onDenied={onDenied}
							refreshKey={reload}
						/>
					</div>
					<Icon name="inbox" className="size-6 shrink-0 text-muted" />
				</div>
				<WaveDivider />
				<div className="px-4 py-6 sm:px-6">{content}</div>
				{current && !error && current.count > 0 && (
					<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-border px-4 py-3 sm:px-6">
						<p className="m-0 text-xs text-muted">
							{copy.total}:{" "}
							<bdi className="font-medium tabular-nums text-foreground">
								{new Intl.NumberFormat(locale).format(current.count)}
							</bdi>
						</p>
						{current.count > PAGE_SIZE && (
							<Pager
								locale={locale}
								page={page}
								count={current.count}
								pageSize={PAGE_SIZE}
								onPage={select}
								labels={{ prev: t.previous, next: t.next, page: t.page }}
							/>
						)}
					</div>
				)}
			</Card>
			<OwnReports locale={locale} context={context} />
		</section>
	);
}
