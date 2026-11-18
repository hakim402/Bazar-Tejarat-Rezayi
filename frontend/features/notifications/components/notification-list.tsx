"use client";
import { OwnReports } from "../../messaging/components/report";
import { reportTargetHref } from "../../messaging/api";
import { fulfilmentHref } from "../../fulfilment/api";
import { aftercareHref } from "../../aftercare/api";
import { aftercareCopy } from "../../aftercare/copy";
import { fulfilmentCopy } from "../../fulfilment/copy";
import { paymentHref } from "../../payments/api";
import { paymentCopy } from "../../payments/copy";
import { requestHref } from "../../negotiations/api";
import { negotiationCopy } from "../../negotiations/copy";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { notification, type Notices } from "../api";
import { communicationCopy } from "../../messaging/copy";
import { type Context, threadHref, localTimestamp } from "../../messaging/api";
import { useVisiblePoll, accessLost } from "../../messaging/hooks";
import { clearDrafts } from "../../messaging/drafts";
import {
	actionBtn,
	Failure,
	failureMessage,
} from "../../messaging/components/ui";
import toast from "react-hot-toast";
import { AccountError } from "../../../lib/api/private-client";
import Link from "next/link";
import { invoiceHref } from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "../../../components/shadcn/button";
import { Badge } from "../../../components/shadcn/badge";
import { Icon, type IconName } from "../../../components/ui/icon";
import { EmptyState } from "../../../components/ui/empty-state";

function kindIcon(kind: string): IconName {
	switch (kind) {
		case "aftercare":
			return "return";
		case "fulfilment":
			return "truck";
		case "payment":
			return "wallet";
		case "negotiation":
			return "handshake";
		case "order_accepted":
			return "receipt";
		case "message":
			return "mail";
		case "report_status":
			return "shield";
		default:
			return "bell";
	}
}

export function NoticeList({
	locale,
	context,
	seller,
	variant,
}: {
	locale: Locale;
	context: Context;
	seller: string;
	variant?: "buyer";
}) {
	const t = communicationCopy[locale],
		search = useSearchParams(),
		router = useRouter(),
		path = usePathname(),
		page = Number(search.get("page") ?? 1);
	const buyer = variant === "buyer";
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
				} else {
					toast.error(failureMessage(locale, e));
				}
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
		const q = new URLSearchParams(search);
		q.set("page", String(next));
		router.push(`${path}?${q}`);
	};
	return (
		<section
			className={buyer ? "flex flex-col gap-4" : "space-y-4"}
			aria-label={t.notifications}
		>
			<OwnReports locale={locale} context={context} />
			{error ? (
				<Failure locale={locale} error={error} />
			) : !data ? (
				buyer ? (
					<div
						role="status"
						className="rounded-card border border-solid border-border bg-surface p-6 text-sm text-muted"
					>
						{t.loading}
					</div>
				) : (
					<p role="status">{t.loading}</p>
				)
			) : !data.results.length ? (
				buyer ? (
					<EmptyState icon="bell" title={t.emptyNotices} />
				) : (
					<p>{t.emptyNotices}</p>
				)
			) : (
				<ul
					className={
						buyer ? "m-0 flex list-none flex-col gap-3 p-0" : "space-y-3"
					}
				>
					{data.results.map((row) => {
						const href =
							row.kind === "report_status" &&
							(row.product || row.store || row.order)
								? reportTargetHref(
										locale,
										context,
										row.product ? "product" : row.store ? "store" : "order",
										row.product ?? row.store ?? row.order ?? "",
										row.seller,
									)
								: row.kind === "aftercare"
									? aftercareHref(
											locale,
											context,
											row.aftercare ?? undefined,
											context === "seller" ? row.seller : undefined,
										)
									: row.fulfilment
										? fulfilmentHref(
												locale,
												context,
												row.fulfilment,
												context === "seller" ? row.seller : undefined,
											)
										: row.payment
											? paymentHref(
													locale,
													context,
													row.payment,
													context === "seller" ? row.seller : undefined,
												)
											: row.negotiation
												? requestHref(
														locale,
														context,
														row.negotiation,
														context === "seller" ? row.seller : undefined,
													)
												: row.invoice
													? invoiceHref(
															locale,
															context,
															row.invoice,
															context === "seller" ? row.seller : undefined,
														)
													: threadHref(
															locale,
															context,
															row.conversation ?? "",
															row.seller,
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
						if (buyer)
							return (
								<li
									key={row.id}
									className="flex items-start gap-3 rounded-xl border border-solid border-border bg-surface p-4"
								>
									<span
										className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-page ${row.read ? "text-muted" : "text-action"}`}
										aria-hidden="true"
									>
										<Icon name={kindIcon(row.kind)} className="size-5" />
									</span>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<Link
												prefetch={false}
												href={href}
												className="min-w-0 text-sm font-semibold text-foreground no-underline hover:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
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
										</div>
										<p className="m-0 mt-1 text-xs text-muted">
											<bdi>{localTimestamp(row.created_at, locale)}</bdi> ·{" "}
											{t.timezone}
										</p>
									</div>
									{!row.read && (
										<Button
											type="button"
											variant="outline"
											size="icon"
											className="size-9 shrink-0 rounded-lg"
											disabled={busy}
											onClick={() => void mark(row.id)}
											aria-label={t.markRead}
											title={t.markRead}
										>
											<Icon name="check-circle" className="size-4" />
										</Button>
									)}
								</li>
							);
						return (
							<li
								key={row.id}
								className="space-y-3 rounded-card border border-border bg-surface p-4"
							>
								<Link
									prefetch={false}
									className="inline-flex min-h-11 items-center gap-3 font-bold"
									href={href}
								>
									{title}
									{!row.read && (
										<span className="rounded-control bg-info px-2 py-1 text-sm text-action">
											{t.unread}
										</span>
									)}
								</Link>
								<p className="text-sm text-muted">
									<bdi>{localTimestamp(row.created_at, locale)}</bdi> ·{" "}
									{t.timezone}
								</p>
								{!row.read && (
									<button
										type="button"
										className={actionBtn}
										disabled={busy}
										onClick={() => void mark(row.id)}
									>
										{t.markRead}
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{data &&
				(buyer ? (
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="rounded-lg"
							disabled={page <= 1}
							onClick={() => select(page - 1)}
						>
							{t.previous}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="rounded-lg"
							disabled={page * 20 >= data.count}
							onClick={() => select(page + 1)}
						>
							{t.next}
						</Button>
					</div>
				) : (
					<div className="flex flex-wrap gap-3">
						<button
							type="button"
							className={actionBtn}
							disabled={page <= 1}
							onClick={() => select(page - 1)}
						>
							{t.previous}
						</button>
						<button
							type="button"
							className={actionBtn}
							disabled={page * 20 >= data.count}
							onClick={() => select(page + 1)}
						>
							{t.next}
						</button>
					</div>
				))}
		</section>
	);
}
