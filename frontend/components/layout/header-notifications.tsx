"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Locale } from "../../lib/i18n/locales";
import { buyerShellCopy } from "../../lib/i18n/buyer-shell";
import { sellerShellCopy } from "../../lib/i18n/seller-shell";
import { headerCopy } from "../../lib/i18n/header";
import { sellerHref } from "../../lib/routes/account-routes";
import { AccessLink } from "../authentication/access-provider";
import { Icon, type IconName } from "../ui/icon";
import { aftercareHref } from "../../features/aftercare/api";
import { aftercareCopy } from "../../features/aftercare/copy";
import { fulfilmentHref } from "../../features/fulfilment/api";
import { fulfilmentCopy } from "../../features/fulfilment/copy";
import {
	localTimestamp,
	reportTargetHref,
	threadHref,
	type Context,
} from "../../features/messaging/api";
import { communicationCopy } from "../../features/messaging/copy";
import { accessLost } from "../../features/messaging/hooks";
import { requestHref } from "../../features/negotiations/api";
import { negotiationCopy } from "../../features/negotiations/copy";
import { notification, type Notices } from "../../features/notifications/api";
import { useUnreadCount } from "../../features/notifications/hooks";
import { invoiceHref } from "../../features/orders/api";
import { commerceCopy } from "../../features/orders/copy";
import { paymentHref } from "../../features/payments/api";
import { paymentCopy } from "../../features/payments/copy";
import { storefrontCopy } from "../../features/storefront/copy";
import { HeaderMenu } from "./header-menu";
import { useHeaderRole, useHeaderSession } from "./header-session";

type Notice = Notices["results"][number];

const kindIcon: Record<Notice["kind"], IconName> = {
	message: "mail",
	report_status: "shield",
	order_accepted: "check-circle",
	negotiation: "handshake",
	payment: "wallet",
	fulfilment: "truck",
	aftercare: "return",
};

function noticeHref(locale: Locale, context: Context, row: Notice) {
	const seller = context === "seller" ? row.seller : undefined;
	if (row.kind === "report_status" && (row.product || row.store || row.order))
		return reportTargetHref(
			locale,
			context,
			row.product ? "product" : row.store ? "store" : "order",
			row.product ?? row.store ?? row.order ?? "",
			row.seller,
		);
	if (row.kind === "aftercare")
		return aftercareHref(locale, context, row.aftercare ?? undefined, seller);
	if (row.fulfilment)
		return fulfilmentHref(locale, context, row.fulfilment, seller);
	if (row.payment) return paymentHref(locale, context, row.payment, seller);
	if (row.negotiation)
		return requestHref(locale, context, row.negotiation, seller);
	if (row.invoice) return invoiceHref(locale, context, row.invoice, seller);
	if (row.conversation)
		return threadHref(locale, context, row.conversation, seller);
	return `/${locale}/account/${context}/notifications`;
}

function noticeLabel(locale: Locale, context: Context, row: Notice) {
	switch (row.kind) {
		case "aftercare":
			return context === "buyer"
				? aftercareCopy[locale].buyerTitle
				: aftercareCopy[locale].sellerTitle;
		case "fulfilment":
			return context === "buyer"
				? fulfilmentCopy[locale].buyerTitle
				: fulfilmentCopy[locale].sellerTitle;
		case "payment":
			return paymentCopy[locale].title;
		case "negotiation": {
			const copy = negotiationCopy[locale];
			return `${copy.title} · ${
				row.action && row.action in copy
					? copy[row.action as keyof typeof negotiationCopy.en]
					: copy.request
			}`;
		}
		case "order_accepted":
			return `${commerceCopy[locale].accepted} · ${commerceCopy[locale].invoices}`;
		case "message":
			return communicationCopy[locale].newMessage;
		default:
			return communicationCopy[locale].reportStatus;
	}
}

export function HeaderNotifications({
	locale,
	className = "",
}: {
	locale: Locale;
	className?: string;
}) {
	const { loading: sessionLoading } = useHeaderSession();
	const role = useHeaderRole();
	const search = useSearchParams();
	const seller = role === "seller" ? (search.get("seller") ?? "") : "";
	const t = communicationCopy[locale];
	const shell =
		role === "seller" ? sellerShellCopy[locale] : buyerShellCopy[locale];
	const { count, reload: reloadCount } = useUnreadCount(
		role,
		seller,
		!sessionLoading,
	);
	const [list, setList] = useState<Notices | null>(null);
	const [listError, setListError] = useState<"denied" | "unavailable" | null>(
		null,
	);
	const [listReload, setListReload] = useState(0);
	const [marking, setMarking] = useState<string | null>(null);
	const opened = useRef(false);
	const request = useRef<AbortController | null>(null);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	useEffect(() => {
		void listReload;
		if (!opened.current || !role) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setList(null);
		setListError(null);
		void notification<Notices>(
			role,
			`?page=1${seller ? `&seller=${encodeURIComponent(seller)}` : ""}`,
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((value) => {
				if (request.current === controller && !controller.signal.aborted)
					setList(value);
			})
			.catch((failure: unknown) => {
				if (request.current !== controller || controller.signal.aborted) return;
				setListError(accessLost(failure) ? "denied" : "unavailable");
			})
			.finally(() => {
				if (request.current === controller) request.current = null;
			});
		return () => {
			controller.abort();
		};
	}, [role, seller, listReload]);
	const markRead = (id: string) => {
		if (!role || marking) return;
		setMarking(id);
		void notification(role, `${id}/read/`, {})
			.then(() => {
				if (!alive.current) return;
				toast.success(headerCopy[locale].markedRead);
				setListReload((value) => value + 1);
				reloadCount();
			})
			.catch(() => {
				if (alive.current) toast.error(headerCopy[locale].actionError);
			})
			.finally(() => {
				if (alive.current) setMarking(null);
			});
	};
	const rows = list?.results.slice(0, 6) ?? [];
	return (
		<HeaderMenu
			icon="bell"
			label={storefrontCopy[locale].notifications}
			count={count}
			className={className}
			triggerClassName="size-9 text-muted hover:text-action desktop:size-11"
			panelClassName="flex max-h-[min(30rem,calc(100dvh-7rem))] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden"
			panelLabel={shell.notifications}
			onOpen={() => {
				opened.current = true;
				setListReload((value) => value + 1);
			}}
			onClose={() => {
				opened.current = false;
				request.current?.abort();
			}}
		>
			{(close) => (
				<>
					<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
						<h2 className="min-w-0 text-sm font-bold">{shell.notifications}</h2>
						<button
							type="button"
							aria-label={shell.close}
							title={shell.close}
							onClick={() => close(true)}
							className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted transition-colors hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
						>
							<Icon name="close" className="size-4" />
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
						{!role ? (
							<div className="space-y-3 px-4 py-6 text-center">
								<span className="mx-auto flex size-12 items-center justify-center rounded-full bg-info text-action">
									<Icon name="bell" className="size-6" />
								</span>
								<p className="text-sm text-muted">
									{buyerShellCopy[locale].signInDescription}
								</p>
								<AccessLink
									locale={locale}
									screen="buyer-sign-in"
									className="inline-flex min-h-10 items-center justify-center rounded-control bg-primary px-4 text-sm font-bold text-on-primary no-underline shadow-sm transition-opacity hover:opacity-90"
								>
									{buyerShellCopy[locale].signIn}
								</AccessLink>
							</div>
						) : listError ? (
							<div className="space-y-3 px-4 py-5">
								<p role="alert" className="text-sm text-danger">
									{listError === "denied"
										? shell.notificationsDenied
										: shell.notificationsUnavailable}
								</p>
								<button
									type="button"
									onClick={() => setListReload((value) => value + 1)}
									className="inline-flex min-h-10 cursor-pointer items-center rounded-control border border-border bg-surface px-3 text-sm font-semibold text-action transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
								>
									{commerceCopy[locale].retry}
								</button>
							</div>
						) : !list ? (
							<ul
								role="status"
								aria-label={t.loading}
								className="m-0 list-none divide-y divide-border/60 p-0"
							>
								{[0, 1, 2].map((row) => (
									<li
										key={row}
										aria-hidden="true"
										className="flex items-center gap-3 px-4 py-3"
									>
										<span className="size-9 shrink-0 animate-pulse rounded-full bg-page motion-reduce:animate-none" />
										<span className="min-w-0 flex-1 space-y-2">
											<span className="block h-3.5 w-2/3 animate-pulse rounded bg-page motion-reduce:animate-none" />
											<span className="block h-3 w-1/2 animate-pulse rounded bg-page motion-reduce:animate-none" />
										</span>
									</li>
								))}
							</ul>
						) : !rows.length ? (
							<div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
								<span className="flex size-12 items-center justify-center rounded-full bg-info text-action">
									<Icon name="bell" className="size-6" />
								</span>
								<p className="text-sm text-muted">{t.emptyNotices}</p>
							</div>
						) : (
							<ul className="m-0 list-none divide-y divide-border/60 p-0">
								{rows.map((row) => (
									<li
										key={row.id}
										className={`flex items-start gap-1 px-2 py-1 transition-colors ${
											row.read ? "" : "bg-info/40"
										}`}
									>
										<Link
											prefetch={false}
											href={noticeHref(locale, role, row)}
											onClick={() => close()}
											className="flex min-w-0 flex-1 items-start gap-3 rounded-control px-2 py-2 no-underline transition-colors hover:bg-info focus-visible:bg-info focus-visible:outline-none"
										>
											<span
												className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
													row.read
														? "bg-page text-muted"
														: "bg-info text-action"
												}`}
											>
												<Icon
													name={kindIcon[row.kind] ?? "bell"}
													className="size-4"
												/>
											</span>
											<span className="min-w-0 flex-1">
												<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
													<span className="break-words text-sm font-semibold text-foreground">
														{noticeLabel(locale, role, row)}
													</span>
													{!row.read && (
														<span className="rounded-full bg-info px-1.5 py-0.5 text-[0.625rem] font-bold text-action">
															{t.unread}
														</span>
													)}
												</span>
												<span className="mt-0.5 block text-xs text-muted">
													<time dateTime={row.created_at}>
														<bdi>{localTimestamp(row.created_at, locale)}</bdi>
													</time>{" "}
													· {t.timezone}
												</span>
											</span>
										</Link>
										{!row.read && (
											<button
												type="button"
												aria-label={t.markRead}
												title={t.markRead}
												disabled={marking === row.id}
												onClick={() => markRead(row.id)}
												className="mt-2 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted transition-colors hover:bg-info hover:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:opacity-50"
											>
												<Icon name="check" className="size-4" />
											</button>
										)}
									</li>
								))}
							</ul>
						)}
					</div>
					{!!role && (
						<div className="shrink-0 border-t border-border bg-page/60 px-4 py-3">
							<Link
								prefetch={false}
								href={
									role === "seller"
										? sellerHref(locale, "notifications", seller)
										: `/${locale}/account/buyer/notifications`
								}
								onClick={() => close()}
								className="flex min-h-10 w-full items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-bold text-action no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
							>
								<Icon name="bell" className="size-4" />
								{shell.viewNotifications}
							</Link>
						</div>
					)}
				</>
			)}
		</HeaderMenu>
	);
}
