"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { buyerOverviewCopy } from "../../../../../../lib/i18n/buyer-overview";
import { authHref } from "../../../../../../lib/routes/auth-routes";
import { Icon } from "../../../../../../components/ui/icon";
import { StatCard } from "../../../../../../components/ui/stat-card";
import { DashboardCard, cardClass } from "../../../../../../components/ui/dashboard-card";
import { EmptyState } from "../../../../../../components/ui/empty-state";
import { ViewAllLink } from "../../../../../../components/ui/view-all-link";
import { StatusBadge, statusVariant } from "../../../../../../components/ui/status-badge";
import { localTimestamp } from "../../../../../../features/messaging/api";
import { commerceCopy } from "../../../../../../features/orders/copy";
import { communicationCopy } from "../../../../../../features/messaging/copy";
import { aftercareCopy } from "../../../../../../features/aftercare/copy";
import { fulfilmentCopy } from "../../../../../../features/fulfilment/copy";
import { paymentCopy } from "../../../../../../features/payments/copy";
import { negotiationCopy } from "../../../../../../features/negotiations/copy";
import { commerce, type Order, type Page } from "../../../../../../features/orders/api";
import { notification, type Notices, type Counts } from "../../../../../../features/notifications/api";
import { fulfilment } from "../../../../../../features/fulfilment/api";
import { payment } from "../../../../../../features/payments/api";
import { useBuyerAccount } from "./buyer-account";
import { paymentState } from "../../../../../../features/payments/copy";
import { fulfilmentState } from "../../../../../../features/fulfilment/copy";

type Notice = Notices["results"][number];

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

function noticeHref(locale: Locale, row: Notice) {
	if (row.kind === "aftercare")
		return `/${locale}/account/buyer/cancellations/${row.aftercare ?? ""}`;
	if (row.fulfilment)
		return `/${locale}/account/buyer/deliveries/${row.fulfilment}`;
	if (row.payment)
		return `/${locale}/account/buyer/payments/${row.payment}`;
	if (row.negotiation)
		return `/${locale}/account/buyer/negotiations/${row.negotiation}`;
	if (row.invoice)
		return `/${locale}/account/buyer/invoices/${row.invoice}`;
	if (row.conversation)
		return `/${locale}/account/buyer/messages/${row.conversation}`;
	return `/${locale}/account/buyer/notifications`;
}

export function BuyerOverview({ locale }: { locale: Locale }) {
	const t = buyerOverviewCopy[locale];
	const { session } = useBuyerAccount();
	const [orders, setOrders] = useState<Page<Order> | null>(null);
	const [ordersError, setOrdersError] = useState(false);
	const [notifications, setNotifications] = useState<Notices | null>(null);
	const [notificationsError, setNotificationsError] = useState(false);
	const [unread, setUnread] = useState<Counts | null>(null);
	const [unreadError, setUnreadError] = useState(false);
	const [deliveries, setDeliveries] = useState<number | null>(null);
	const [deliveriesError, setDeliveriesError] = useState(false);
	const [payments, setPayments] = useState<number | null>(null);
	const [paymentsError, setPaymentsError] = useState(false);

	useEffect(() => {
		if (!session) return;
		let current = true;
		const controller = new AbortController();
		void commerce<Page<Order>>(
			`orders/buyer/orders/?page=1&locale=${locale}`,
			undefined,
			"GET",
			controller.signal,
		)
			.then((value) => {
				if (current) setOrders(value);
			})
			.catch(() => {
				if (current) setOrdersError(true);
			});
		void notification<Notices>(
			"buyer",
			"?page=1",
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((value) => {
				if (current) setNotifications(value);
			})
			.catch(() => {
				if (current) setNotificationsError(true);
			});
		void notification<Counts>(
			"buyer",
			"unread/",
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((value) => {
				if (current) setUnread(value);
			})
			.catch(() => {
				if (current) setUnreadError(true);
			});
		void fulfilment<{ count: number }>(
			"buyer",
			"orders/?page=1",
			undefined,
			controller.signal,
		)
			.then((value) => {
				if (current) setDeliveries(value.count);
			})
			.catch(() => {
				if (current) setDeliveriesError(true);
			});
		void payment<{ count: number }>(
			"buyer",
			"orders/?page=1",
			undefined,
			controller.signal,
		)
			.then((value) => {
				if (current) setPayments(value.count);
			})
			.catch(() => {
				if (current) setPaymentsError(true);
			});
		return () => {
			current = false;
			controller.abort();
		};
	}, [session, locale]);

	if (!session) {
		return (
			<section className="min-w-0 space-y-6">
				<h1 className="text-3xl font-bold">{t.title}</h1>
				<div className={cardClass}>
					<EmptyState
						icon="user-circle"
						title={t.signInTitle}
						description={t.signInDescription}
						action={
							<Link
								href={authHref(locale, "buyer-sign-in")}
								className={primaryButton}
							>
								{t.signInAction}
							</Link>
						}
					/>
				</div>
			</section>
		);
	}

	const profile = session.identity;
	const account = session.accounts.find((a) => a.context === "buyer");
	const displayName = profile.display_name.trim() || t.profileCard;
	const email = profile.email;
	const verified = profile.email_verified;
	const status = account?.status ?? "basic";

	return (
		<section className="min-w-0 space-y-6" dir={direction(locale)}>
			<div>
				<h1 className="text-3xl font-bold">{t.title}</h1>
				<p className="mt-2 text-muted">{t.description}</p>
			</div>

			<div className={cardClass}>
				<div className="flex items-start gap-4">
					<div
						aria-hidden="true"
						className="flex size-14 shrink-0 items-center justify-center rounded-full bg-info text-lg font-semibold text-action"
					>
						<bdi>
							{displayName
								.split(/\s+/)
								.map((p) => Array.from(p)[0])
								.join("")
								.toLocaleUpperCase(locale) || (
								<Icon name="user-circle" className="size-7" />
							)}
						</bdi>
					</div>
					<div className="min-w-0 flex-1 space-y-1">
						<p className="text-lg font-semibold">
							<bdi>{displayName}</bdi>
						</p>
						{email && (
							<p className="text-sm text-muted">
								<bdi>{email}</bdi>{" "}
								<span
									className={`ms-2 inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-xs font-medium ${
										verified
											? "bg-success/10 text-success"
											: "bg-warning/10 text-warning"
									}`}
								>
									<Icon
										name={verified ? "check-circle" : "alert-triangle"}
										className="size-3"
									/>
									{verified ? t.verified : t.unverified}
								</span>
							</p>
						)}
						<p className="text-sm text-muted">
							{t.accountStatus}:{" "}
							<span className="font-medium">
								{status === "company"
									? t.statusCompany
									: status === "pending"
										? t.statusPending
										: t.statusIndividual}
							</span>
						</p>
					</div>
					<Link
						href={`/${locale}/account/buyer/profile`}
						className={secondaryButton}
					>
						<Icon name="gear" className="size-4" />
						{t.viewSettings}
					</Link>
				</div>
			</div>

			<div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					icon="shopping-bag"
					label={t.kpiOrders}
					value={
						ordersError ? (
							<span className="text-caption text-danger">{t.kpiUnavailable}</span>
						) : orders ? (
							orders.count
						) : (
							<span className="text-muted">…</span>
						)
					}
					href={`/${locale}/account/buyer/orders`}
					locale={locale}
				/>
				<StatCard
					icon="truck"
					label={t.kpiDeliveries}
					value={
						deliveriesError ? (
							<span className="text-caption text-danger">{t.kpiUnavailable}</span>
						) : deliveries !== null ? (
							deliveries
						) : (
							<span className="text-muted">…</span>
						)
					}
					href={`/${locale}/account/buyer/deliveries`}
					locale={locale}
				/>
				<StatCard
					icon="wallet"
					label={t.kpiPayments}
					value={
						paymentsError ? (
							<span className="text-caption text-danger">{t.kpiUnavailable}</span>
						) : payments !== null ? (
							payments
						) : (
							<span className="text-muted">…</span>
						)
					}
					href={`/${locale}/account/buyer/payments`}
					locale={locale}
				/>
				<StatCard
					icon="mail"
					label={t.kpiUnread}
					value={
						unreadError ? (
							<span className="text-caption text-danger">{t.kpiUnavailable}</span>
						) : unread ? (
							unread.unread_threads
						) : (
							<span className="text-muted">…</span>
						)
					}
					href={`/${locale}/account/buyer/messages`}
					locale={locale}
				/>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<DashboardCard
					title={t.recentOrders}
					action={
						orders && orders.count > 0 ? (
							<ViewAllLink
								href={`/${locale}/account/buyer/orders`}
								label={t.viewAllOrders}
							/>
						) : undefined
					}
				>
					{ordersError ? (
						<EmptyState
							icon="alert-triangle"
							title={t.kpiUnavailable}
							description={t.kpiUnavailableHint}
							borderless
						/>
					) : !orders ? (
						<p role="status" className="py-4 text-muted">
							{t.loading}
						</p>
					) : orders.results.length === 0 ? (
						<EmptyState
							icon="shopping-bag"
							title={t.recentOrdersEmpty}
							borderless
						/>
					) : (
						<ul className="space-y-3">
							{orders.results.slice(0, 5).map((order) => (
								<li key={order.id} className={listItemClass}>
									<div className="flex min-w-0 items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<Link
												href={`/${locale}/account/buyer/orders/${order.id}`}
												className="font-semibold text-action no-underline hover:underline"
											>
												<bdi>{order.number}</bdi>
											</Link>
											<p className="mt-1 text-sm text-muted">
												<bdi>{order.snapshot.seller}</bdi>
											</p>
										</div>
										<div className="shrink-0 text-end">
											<p className="font-semibold">
												<bdi>
													{order.goods_total} {order.currency}
												</bdi>
											</p>
											<div className="mt-1 flex flex-wrap gap-1">
												<StatusBadge variant={statusVariant(order.dimensions.financial)}>
													{paymentState(locale, order.dimensions.financial)}
												</StatusBadge>
												<StatusBadge variant={statusVariant(order.dimensions.fulfilment)}>
													{fulfilmentState(locale, order.dimensions.fulfilment)}
												</StatusBadge>
											</div>
										</div>
									</div>
									<p className="mt-2 text-caption text-muted">
										<time dateTime={order.accepted_at}>
											<bdi>{localTimestamp(order.accepted_at, locale)}</bdi>
										</time>
									</p>
								</li>
							))}
						</ul>
					)}
				</DashboardCard>

				<DashboardCard
					title={t.recentNotifications}
					action={
						notifications && notifications.count > 0 ? (
							<ViewAllLink
								href={`/${locale}/account/buyer/notifications`}
								label={t.viewAllNotifications}
							/>
						) : undefined
					}
				>
					{notificationsError ? (
						<EmptyState
							icon="alert-triangle"
							title={t.kpiUnavailable}
							description={t.kpiUnavailableHint}
							borderless
						/>
					) : !notifications ? (
						<p role="status" className="py-4 text-muted">
							{t.loading}
						</p>
					) : notifications.results.length === 0 ? (
						<EmptyState
							icon="bell"
							title={t.recentNotificationsEmpty}
							borderless
						/>
					) : (
						<ul className="space-y-2">
							{notifications.results.slice(0, 5).map((row) => (
								<li key={row.id}>
									<Link
										href={noticeHref(locale, row)}
										className={notificationLinkClass}
									>
										<span className="flex min-w-0 flex-wrap items-center gap-2">
											<span className="min-w-0 break-words font-medium">
												{noticeLabel(locale, row)}
											</span>
											{!row.read && (
												<span className="rounded-control bg-info px-2 py-0.5 text-caption text-action">
													{communicationCopy[locale].unread}
												</span>
											)}
										</span>
										<span className="break-words text-caption text-muted">
											<time dateTime={row.created_at}>
												<bdi>{localTimestamp(row.created_at, locale)}</bdi>
											</time>
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</DashboardCard>
			</div>

			<DashboardCard title={t.quickActions}>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Link href={`/${locale}`} className={quickActionPrimary}>
						<Icon name="store" className="size-5" />
						{t.browseMarketplace}
					</Link>
					<Link href={`/${locale}/cart`} className={quickActionSecondary}>
						<Icon name="cart" className="size-5" />
						{t.viewCart}
					</Link>
					<Link
						href={`/${locale}/account/buyer/messages`}
						className={quickActionSecondary}
					>
						<Icon name="mail" className="size-5" />
						{t.viewMessages}
					</Link>
					<Link
						href={`/${locale}/account/buyer/settings`}
						className={quickActionSecondary}
					>
						<Icon name="gear" className="size-5" />
						{t.viewSettings}
					</Link>
				</div>
			</DashboardCard>
		</section>
	);
}

const primaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary no-underline transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";
const secondaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 py-2 text-sm font-semibold text-action no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";
const listItemClass =
	"rounded-control border border-border bg-page p-3 transition-colors hover:bg-info";
const notificationLinkClass =
	"flex min-h-11 flex-col gap-1 rounded-control px-3 py-2 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";
const quickActionPrimary =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 py-3 text-sm font-semibold text-on-primary no-underline transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";
const quickActionSecondary =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 py-3 text-sm font-semibold text-action no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";
