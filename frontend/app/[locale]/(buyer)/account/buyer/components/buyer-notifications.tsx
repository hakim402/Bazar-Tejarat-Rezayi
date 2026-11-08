"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { Icon } from "../../../../../../components/ui/icon";
import { aftercareHref } from "../../../../../../features/aftercare/api";
import { aftercareCopy } from "../../../../../../features/aftercare/copy";
import { fulfilmentHref } from "../../../../../../features/fulfilment/api";
import { fulfilmentCopy } from "../../../../../../features/fulfilment/copy";
import { ACCOUNT_SESSION_CHANGED } from "../../../../../../features/identity/api/accounts";
import {
	localTimestamp,
	threadHref,
} from "../../../../../../features/messaging/api";
import { communicationCopy } from "../../../../../../features/messaging/copy";
import { requestHref } from "../../../../../../features/negotiations/api";
import { negotiationCopy } from "../../../../../../features/negotiations/copy";
import {
	notification,
	type Notices,
} from "../../../../../../features/notifications/api";
import { invoiceHref } from "../../../../../../features/orders/api";
import { commerceCopy } from "../../../../../../features/orders/copy";
import { paymentHref } from "../../../../../../features/payments/api";
import { paymentCopy } from "../../../../../../features/payments/copy";
import { AccountError } from "../../../../../../lib/api/private-client";
import { buyerShellCopy } from "../../../../../../lib/i18n/buyer-shell";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { useBuyerAccount } from "./buyer-account";

type Notice = Notices["results"][number];

function noticeHref(locale: Locale, row: Notice) {
	if (row.kind === "aftercare")
		return aftercareHref(locale, "buyer", row.aftercare ?? undefined);
	if (row.fulfilment) return fulfilmentHref(locale, "buyer", row.fulfilment);
	if (row.payment) return paymentHref(locale, "buyer", row.payment);
	if (row.negotiation)
		return requestHref(locale, "buyer", row.negotiation);
	if (row.invoice) return invoiceHref(locale, "buyer", row.invoice);
	return threadHref(locale, "buyer", row.conversation ?? "");
}

function noticeLabel(locale: Locale, row: Notice) {
	switch (row.kind) {
		case "aftercare":
			return aftercareCopy[locale].buyerTitle;
		case "fulfilment":
			return fulfilmentCopy[locale].buyerTitle;
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

export function BuyerNotifications({ locale }: { locale: Locale }) {
	const path = usePathname();
	const { session } = useBuyerAccount();
	const account = session?.accounts.find((value) => value.context === "buyer");

	return (
		<RecentBuyerNotifications
			key={JSON.stringify([
				locale,
				path,
				session?.identity.id,
				account?.id,
				!!session,
			])}
			locale={locale}
			authenticated={!!session}
		/>
	);
}

function RecentBuyerNotifications({
	locale,
	authenticated,
}: {
	locale: Locale;
	authenticated: boolean;
}) {
	const copy = buyerShellCopy[locale];
	const t = communicationCopy[locale];
	const errors = inventoryCopy[locale];
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<Notices | null>(null);
	const [error, setError] = useState<"denied" | "unavailable" | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLElement>(null);
	const opened = useRef(false);
	const request = useRef<AbortController | null>(null);
	const pendingFocus = useRef<"first" | "last" | null>(null);
	const panelId = useId();
	const headingId = `${panelId}-heading`;

	const cancel = useCallback(() => {
		request.current?.abort();
		request.current = null;
	}, []);

	const close = useCallback(
		(restoreFocus = false) => {
			opened.current = false;
			pendingFocus.current = null;
			cancel();
			setOpen(false);
			setData(null);
			setError(null);
			if (restoreFocus) trigger.current?.focus();
		},
		[cancel],
	);

	const refresh = useCallback(() => {
		if (!opened.current || !authenticated) return;
		cancel();
		if (panel.current?.contains(document.activeElement))
			trigger.current?.focus();
		setData(null);
		setError(null);
		const controller = new AbortController();
		request.current = controller;
		const current = () =>
			opened.current &&
			request.current === controller &&
			!controller.signal.aborted;
		void notification<Notices>(
			"buyer",
			"?page=1",
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((value) => {
				if (current()) setData(value);
			})
			.catch((failure: unknown) => {
				if (!current()) return;
				setData(null);
				setError(
					failure instanceof AccountError &&
						[401, 403, 404].includes(failure.status ?? 0)
						? "denied"
						: "unavailable",
				);
			})
			.finally(() => {
				if (request.current === controller) request.current = null;
			});
	}, [authenticated, cancel]);

	useEffect(() => {
		const sessionChanged = () => close();
		window.addEventListener(ACCOUNT_SESSION_CHANGED, sessionChanged);
		window.addEventListener("focus", refresh);
		return () => {
			opened.current = false;
			pendingFocus.current = null;
			cancel();
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, sessionChanged);
			window.removeEventListener("focus", refresh);
		};
	}, [cancel, close, refresh]);

	useEffect(() => {
		if (!open) return;
		const outside = (event: Event) => {
			if (event.target instanceof Node && !root.current?.contains(event.target))
				close();
		};
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			close(true);
		};
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open, close]);

	useEffect(() => {
		if (!open || !pendingFocus.current || (authenticated && !data && !error))
			return;
		const links = panel.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
		links?.[pendingFocus.current === "last" ? links.length - 1 : 0]?.focus();
		pendingFocus.current = null;
	}, [open, authenticated, data, error]);

	const show = () => {
		opened.current = true;
		setOpen(true);
		setData(null);
		setError(null);
		refresh();
	};

	const arrows = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const last = event.key === "ArrowUp";
		if (!opened.current) {
			pendingFocus.current = last ? "last" : "first";
			show();
			return;
		}
		pendingFocus.current = null;
		const links = Array.from(
			panel.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
		);
		if (!links.length) return;
		const index =
			document.activeElement instanceof HTMLAnchorElement
				? links.indexOf(document.activeElement)
				: -1;
		const next =
			index < 0
				? last
					? links.length - 1
					: 0
				: (index + (last ? -1 : 1) + links.length) % links.length;
		links[next]?.focus();
	};

	return (
		<div ref={root} dir={direction(locale)} className="shrink-0">
			<button
				ref={trigger}
				type="button"
				aria-label={copy.notifications}
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted transition-colors hover:bg-info hover:text-foreground aria-[expanded=true]:bg-info aria-[expanded=true]:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
				onClick={() => (opened.current ? close() : show())}
				onKeyDown={arrows}
			>
				<Icon name="bell" />
			</button>
			{open && (
				<section
					ref={panel}
					id={panelId}
					aria-labelledby={headingId}
					aria-busy={authenticated && !data && !error}
					className="fixed end-4 top-20 z-50 mt-2 max-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-card border border-border bg-surface p-3 text-start text-sm text-foreground shadow-lifted"
				>
					<h2
						id={headingId}
						className="break-words px-2 py-2 text-body font-semibold"
					>
						{copy.recentNotifications}
					</h2>
					{!authenticated || error ? (
						<div className="space-y-2 px-2 py-3">
							<p role="alert" className="break-words text-danger">
								{!authenticated || error === "denied"
									? copy.notificationsDenied
									: copy.notificationsUnavailable}
							</p>
							{authenticated && (
								<button
									type="button"
									onClick={refresh}
									className="min-h-11 rounded-control border border-border bg-surface px-3 py-2 font-medium text-action hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
								>
									{errors.retry}
								</button>
							)}
						</div>
					) : !data ? (
						<p role="status" className="px-2 py-4 text-muted">
							{t.loading}
						</p>
					) : !data.results.length ? (
						<p className="px-2 py-4 text-muted">{t.emptyNotices}</p>
					) : (
						<ul
							aria-label={copy.recentNotifications}
							className="space-y-1 py-1"
						>
							{data.results.slice(0, 5).map((row) => (
								<li key={row.id}>
									<Link
										prefetch={false}
										href={noticeHref(locale, row)}
										onKeyDown={arrows}
										onClick={() => close(true)}
										className="flex min-h-11 min-w-0 flex-col gap-1 rounded-control px-2 py-3 text-foreground no-underline hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
									>
										<span className="flex min-w-0 flex-wrap items-center gap-2">
											<span className="min-w-0 break-words font-medium">
												{noticeLabel(locale, row)}
											</span>
											{!row.read && (
												<span className="rounded-control bg-info px-2 py-1 text-caption text-action">
													{t.unread}
												</span>
											)}
										</span>
										<span className="break-words text-caption text-muted">
											<time dateTime={row.created_at}>
												<bdi>{localTimestamp(row.created_at, locale)}</bdi>
											</time>{" "}
											· {t.timezone}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
					<div className="mt-2 border-t border-border pt-2">
						<Link
							prefetch={false}
							href={`/${locale}/account/buyer/notifications`}
							onKeyDown={arrows}
							onClick={() => close(true)}
							className="flex min-h-11 items-center rounded-control px-2 py-2 font-medium text-action no-underline hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
						>
							{copy.viewNotifications}
						</Link>
					</div>
				</section>
			)}
		</div>
	);
}
