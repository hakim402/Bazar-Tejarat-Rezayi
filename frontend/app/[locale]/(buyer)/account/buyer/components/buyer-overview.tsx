"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { buyerOverviewCopy } from "../../../../../../lib/i18n/buyer-overview";
import { authHref } from "../../../../../../lib/routes/auth-routes";
import { Icon } from "../../../../../../components/ui/icon";
import { StatCard } from "../../../../../../components/ui/stat-card";
import {
	DashboardCard,
	cardClass,
} from "../../../../../../components/ui/dashboard-card";
import { EmptyState } from "../../../../../../components/ui/empty-state";
import { ViewAllLink } from "../../../../../../components/ui/view-all-link";
import {
	StatusBadge,
	statusVariant,
} from "../../../../../../components/ui/status-badge";
import {
	messaging,
	shortTimestamp,
	threadHref,
	type Inbox,
} from "../../../../../../features/messaging/api";
import { communicationCopy } from "../../../../../../features/messaging/copy";
import { ProductAvatar } from "../../../../../../features/messaging/components/ui";
import {
	commerce,
	type Order,
	type Page,
} from "../../../../../../features/orders/api";
import {
	ProductThumbnail,
	buyerLineImage,
} from "../../../../../../features/orders/components/order-ui";
import { useUnreadCount } from "../../../../../../features/notifications/hooks";
import { fulfilment } from "../../../../../../features/fulfilment/api";
import { payment } from "../../../../../../features/payments/api";
import { AccountBadge, useBuyerAccount } from "./buyer-account";
import { paymentState } from "../../../../../../features/payments/copy";
import { fulfilmentState } from "../../../../../../features/fulfilment/copy";

const rowLinkClass =
	"flex min-w-0 items-center gap-3 rounded-control px-2 py-2.5 text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";

export function BuyerOverview({ locale }: { locale: Locale }) {
	const t = buyerOverviewCopy[locale];
	const { session } = useBuyerAccount();
	const [orders, setOrders] = useState<Page<Order> | null>(null);
	const [ordersError, setOrdersError] = useState(false);
	const [conversations, setConversations] = useState<Inbox | null>(null);
	const [conversationsError, setConversationsError] = useState(false);
	const [deliveries, setDeliveries] = useState<number | null>(null);
	const [deliveriesError, setDeliveriesError] = useState(false);
	const [payments, setPayments] = useState<number | null>(null);
	const [paymentsError, setPaymentsError] = useState(false);
	const { counts: unread, error: unreadError } = useUnreadCount(
		session ? "buyer" : null,
	);

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
		void messaging<Inbox>("buyer", "conversations/?page=1", undefined, {
			signal: controller.signal,
		})
			.then((value) => {
				if (current) setConversations(value);
			})
			.catch(() => {
				if (current) setConversationsError(true);
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
				<h1 className="text-page-title font-bold">{t.title}</h1>
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
			<div className="rounded-card border border-border bg-info p-4 desktop:p-6">
				<h1 className="text-page-title font-bold">{t.title}</h1>
				<p className="mt-1 text-sm text-muted">{t.description}</p>
			</div>

			<div className="min-w-0 overflow-hidden rounded-card border border-transparent bg-surface shadow-card dark:border-border">
				<div className="h-1 bg-primary" aria-hidden="true" />
				<div className="flex items-start gap-4 p-4 desktop:p-6">
					<AccountBadge
						locale={locale}
						className="size-14 bg-primary text-lg text-on-primary"
					/>
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

			<div className="grid auto-rows-fr grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
				<StatCard
					compact
					icon="shopping-bag"
					label={t.kpiOrders}
					value={
						ordersError ? (
							<span className="text-caption text-danger">
								{t.kpiUnavailable}
							</span>
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
					compact
					icon="truck"
					label={t.kpiDeliveries}
					value={
						deliveriesError ? (
							<span className="text-caption text-danger">
								{t.kpiUnavailable}
							</span>
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
					compact
					icon="wallet"
					label={t.kpiPayments}
					value={
						paymentsError ? (
							<span className="text-caption text-danger">
								{t.kpiUnavailable}
							</span>
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
					compact
					icon="mail"
					label={t.kpiUnread}
					value={
						unreadError ? (
							<span className="text-caption text-danger">
								{t.kpiUnavailable}
							</span>
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
					icon="shopping-bag"
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
						<ul className="m-0 list-none divide-y divide-border p-0">
							{orders.results.slice(0, 5).map((order) => {
								const line = order.lines[0];
								return (
									<li key={order.id}>
										<Link
											href={`/${locale}/account/buyer/orders/${order.id}`}
											className={rowLinkClass}
										>
											<ProductThumbnail
												src={line ? buyerLineImage(order, line) : null}
												className="size-10 rounded-lg"
											/>
											<span className="min-w-0 flex-1">
												<span className="flex items-baseline justify-between gap-2">
													<bdi className="min-w-0 truncate text-sm font-semibold text-action">
														{order.number}
													</bdi>
													<bdi className="shrink-0 text-sm font-semibold tabular-nums">
														{order.goods_total} {order.currency}
													</bdi>
												</span>
												<span className="mt-0.5 flex items-baseline justify-between gap-2 text-caption text-muted">
													<span className="min-w-0 truncate" dir="auto">
														{order.snapshot.seller}
													</span>
													<time
														dateTime={order.accepted_at}
														className="shrink-0"
													>
														<bdi>
															{shortTimestamp(order.accepted_at, locale)}
														</bdi>
													</time>
												</span>
												<span className="mt-1.5 flex flex-wrap gap-1">
													<StatusBadge
														variant={statusVariant(order.dimensions.financial)}
													>
														{paymentState(locale, order.dimensions.financial)}
													</StatusBadge>
													<StatusBadge
														variant={statusVariant(order.dimensions.fulfilment)}
													>
														{fulfilmentState(
															locale,
															order.dimensions.fulfilment,
														)}
													</StatusBadge>
												</span>
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					)}
				</DashboardCard>

				<DashboardCard
					icon="mail"
					title={t.recentMessages}
					action={
						conversations && conversations.count > 0 ? (
							<ViewAllLink
								href={`/${locale}/account/buyer/messages`}
								label={t.viewAllMessages}
							/>
						) : undefined
					}
				>
					{conversationsError ? (
						<EmptyState
							icon="alert-triangle"
							title={t.kpiUnavailable}
							description={t.kpiUnavailableHint}
							borderless
						/>
					) : !conversations ? (
						<p role="status" className="py-4 text-muted">
							{t.loading}
						</p>
					) : conversations.results.length === 0 ? (
						<EmptyState icon="mail" title={t.recentMessagesEmpty} borderless />
					) : (
						<ul className="m-0 list-none divide-y divide-border p-0">
							{conversations.results.slice(0, 5).map((row) => (
								<li key={row.id}>
									<Link
										prefetch={false}
										href={threadHref(locale, "buyer", row.id)}
										className={rowLinkClass}
									>
										<ProductAvatar
											locale={locale}
											product={row.snapshot.product}
											label={row.snapshot.title}
										/>
										<span className="min-w-0 flex-1">
											<span className="flex items-baseline justify-between gap-2">
												<strong
													className="min-w-0 truncate text-sm font-semibold"
													dir="auto"
												>
													{row.snapshot.title}
												</strong>
												<time
													dateTime={row.updated_at}
													className="shrink-0 text-caption text-muted"
												>
													<bdi>{shortTimestamp(row.updated_at, locale)}</bdi>
												</time>
											</span>
											<span
												className="mt-0.5 block truncate text-caption text-muted"
												dir="auto"
											>
												{row.snapshot.seller}
											</span>
										</span>
										{row.unread && (
											<span className="shrink-0 rounded-full bg-info px-2 py-0.5 text-caption font-semibold text-action">
												{communicationCopy[locale].unread}
											</span>
										)}
									</Link>
								</li>
							))}
						</ul>
					)}
				</DashboardCard>
			</div>

			<DashboardCard icon="grid" title={t.quickActions}>
				<div className="grid auto-rows-fr grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
					<Link href={`/${locale}`} className={quickActionPrimary}>
						<span
							className={`${quickActionChip} bg-on-primary/15`}
							aria-hidden="true"
						>
							<Icon name="store" className="size-4 sm:size-5" />
						</span>
						{t.browseMarketplace}
					</Link>
					<Link href={`/${locale}/cart`} className={quickActionSecondary}>
						<span
							className={`${quickActionChip} bg-info text-action`}
							aria-hidden="true"
						>
							<Icon name="cart" className="size-4 sm:size-5" />
						</span>
						{t.viewCart}
					</Link>
					<Link
						href={`/${locale}/account/buyer/messages`}
						className={quickActionSecondary}
					>
						<span
							className={`${quickActionChip} bg-info text-action`}
							aria-hidden="true"
						>
							<Icon name="mail" className="size-4 sm:size-5" />
						</span>
						{t.viewMessages}
					</Link>
					<Link
						href={`/${locale}/account/buyer/settings`}
						className={quickActionSecondary}
					>
						<span
							className={`${quickActionChip} bg-info text-action`}
							aria-hidden="true"
						>
							<Icon name="gear" className="size-4 sm:size-5" />
						</span>
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
const quickActionPrimary =
	"flex min-h-11 flex-col items-center justify-center gap-1 rounded-control bg-primary px-1.5 py-2.5 text-center text-caption font-semibold text-on-primary no-underline shadow-sm transition-colors wrap-anywhere hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none sm:gap-2 sm:px-4 sm:py-4 sm:text-sm";
const quickActionSecondary =
	"flex min-h-11 flex-col items-center justify-center gap-1 rounded-control border border-border bg-surface px-1.5 py-2.5 text-center text-caption font-semibold text-action no-underline shadow-sm transition-colors wrap-anywhere hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none sm:gap-2 sm:px-4 sm:py-4 sm:text-sm";
const quickActionChip =
	"flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-10 sm:rounded-xl";
