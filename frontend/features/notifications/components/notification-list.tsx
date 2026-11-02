"use client";
import { requestHref } from "../../negotiations/api";
import { negotiationCopy } from "../../negotiations/copy";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { notification, type Notices } from "../api";
import { communicationCopy } from "../../messaging/copy";
import { type Context, threadHref, localTimestamp } from "../../messaging/api";
import { useVisiblePoll, accessLost } from "../../messaging/hooks";
import { clearDrafts } from "../../messaging/drafts";
import { action, Failure } from "../../messaging/components/controls";
import { AccountError } from "../../../lib/api/private-client";
import Link from "next/link";
import { invoiceHref } from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
export function NoticeList({
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
			if (alive.current && owned.current === owner) setReload((v) => v + 1);
		} catch (e) {
			if (alive.current && owned.current === owner) {
				if (accessLost(e)) {
					clearDrafts();
					setData(null);
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
		<section className="space-y-4" aria-label={t.notifications}>
			{error ? (
				<Failure locale={locale} error={error} />
			) : !data ? (
				<p role="status">{t.loading}</p>
			) : !data.results.length ? (
				<p>{t.emptyNotices}</p>
			) : (
				<ul className="space-y-3">
					{data.results.map((row) => (
						<li
							key={row.id}
							className="space-y-3 rounded-card border border-border bg-surface p-4"
						>
							<Link
								prefetch={false}
								className="inline-flex min-h-11 items-center gap-3 font-bold"
								href={
									row.negotiation
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
												)
								}
							>
								{row.kind === "negotiation"
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
											: t.reportStatus}
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
									className={action}
									disabled={busy}
									onClick={() => void mark(row.id)}
								>
									{t.markRead}
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{data && (
				<div className="flex flex-wrap gap-3">
					<button
						type="button"
						className={action}
						disabled={page <= 1}
						onClick={() => select(page - 1)}
					>
						{t.previous}
					</button>
					<button
						type="button"
						className={action}
						disabled={page * 20 >= data.count}
						onClick={() => select(page + 1)}
					>
						{t.next}
					</button>
				</div>
			)}
		</section>
	);
}
