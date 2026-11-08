"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SellerSelect } from "../../../app/[locale]/(seller)/account/seller/components/seller-select";
import { Icon } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { sellerMessagesCopy } from "../../../lib/i18n/seller-messages";
import {
	sellerHref,
	uuidPattern,
	type QueryReader,
} from "../../../lib/routes/account-routes";
import type { Profiles } from "../api";
import { communicationCopy } from "../copy";

export function messageListState(params?: QueryReader, fromThread = false) {
	const raw = params?.get(fromThread ? "list_page" : "page");
	const page =
		raw && /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 10000
			? Number(raw)
			: 1;
	return {
		page,
		unread: params?.get(fromThread ? "list_unread" : "unread") === "true",
	};
}

// Inbox return context must not enter detail APIs or other workflows.
export function sellerMessagesHref(
	locale: Locale,
	seller = "",
	id?: string,
	params?: QueryReader,
	fromThread = false,
	changes: { page?: number; unread?: boolean } = {},
) {
	const list = { ...messageListState(params, fromThread), ...changes };
	const detail = id && uuidPattern.test(id) ? `/${id}` : "";
	const query = new URLSearchParams();
	if (uuidPattern.test(seller)) query.set("seller", seller);
	if (Number.isInteger(list.page) && list.page > 1 && list.page <= 10000)
		query.set(detail ? "list_page" : "page", String(list.page));
	if (list.unread === true)
		query.set(detail ? "list_unread" : "unread", "true");
	return `${sellerHref(locale, `messages${detail}`)}${query.size ? `?${query}` : ""}`;
}

export const messageAction =
	"inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-action no-underline shadow-sm transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
export const messageControl =
	"min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2 text-base text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50";
export const messagePanel =
	"min-w-0 space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6";

export function SellerMessagesHeader({
	locale,
	selected,
	profiles,
	thread = false,
	onChange,
}: {
	locale: Locale;
	selected: string;
	profiles: Profiles["results"];
	thread?: boolean;
	onChange?: (value: string) => void;
}) {
	const t = sellerMessagesCopy[locale],
		common = communicationCopy[locale];
	const profile = profiles.find((row) => row.id === selected);
	return (
		<header className="min-w-0 space-y-4">
			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
				<div className="min-w-0 space-y-2">
					<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
						{common.messages}
					</h1>
					<p className="max-w-2xl text-sm leading-relaxed text-muted">
						{thread ? t.threadHelp : t.help}
					</p>
				</div>
				{!!profiles.length && onChange && (
					<div className="min-w-0 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
						<div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-muted">
							<span>{t.business}</span>
							{profile && (
								<span className="rounded-full bg-info px-2.5 py-1 text-action">
									{profile.messaging ? t.messagingAccess : common.noAccess}
								</span>
							)}
						</div>
						<SellerSelect
							label={t.business}
							value={selected}
							options={profiles.map((row) => ({
								value: row.id,
								label: row.name,
							}))}
							onChange={onChange}
							icon="store"
						/>
						{profile && (
							<p className="text-xs text-muted">
								<bdi>
									{profile.kind === "individual"
										? t.individual
										: profile.kind === "company"
											? t.company
											: profile.kind}
								</bdi>
							</p>
						)}
					</div>
				)}
			</div>
			{profile && (
				<nav aria-label={t.businessManagement} className="flex flex-wrap gap-2">
					<Link
						prefetch={false}
						className={messageAction}
						href={sellerHref(locale, "organizations", selected)}
					>
						<Icon name="store" className="size-4" />
						{t.businessManagement}
					</Link>
					<Link
						prefetch={false}
						className={messageAction}
						href={sellerHref(locale, "settings", selected)}
					>
						<Icon name="gear" className="size-4" />
						{t.settings}
					</Link>
				</nav>
			)}
		</header>
	);
}

export function SellerMessageAttachments({
	locale,
	seller,
	hasImages,
	children,
}: {
	locale: Locale;
	seller: boolean;
	hasImages: boolean;
	children: ReactNode;
}) {
	if (!seller) return children;
	return (
		<details
			open={hasImages}
			className="rounded-xl border border-border bg-page p-3"
		>
			<summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg text-sm font-semibold text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action">
				<Icon name="image" className="size-4" />
				{sellerMessagesCopy[locale].attachments}
				<Icon name="chevron-down" className="ms-auto size-4" />
			</summary>
			<div className="space-y-3 pt-3">{children}</div>
		</details>
	);
}

export function SellerMessagesEmpty({
	locale,
	noBusiness = false,
	unread = false,
	laterPage = false,
	children,
}: {
	locale: Locale;
	noBusiness?: boolean;
	unread?: boolean;
	laterPage?: boolean;
	children?: ReactNode;
}) {
	const t = sellerMessagesCopy[locale];
	const title = noBusiness
		? t.noBusiness
		: unread
			? t.noUnread
			: laterPage
				? t.emptyPage
				: t.empty;
	const help = noBusiness
		? t.noBusinessHelp
		: unread
			? t.noUnreadHelp
			: laterPage
				? t.emptyPageHelp
				: t.emptyHelp;
	return (
		<section className={`${messagePanel} py-10! text-center`}>
			<span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-info text-action">
				<Icon name={noBusiness ? "lock" : "inbox"} className="size-6" />
			</span>
			<h2 className="text-lg font-semibold">{title}</h2>
			<p className="mx-auto max-w-lg text-sm leading-relaxed text-muted">
				{help}
			</p>
			{children}
		</section>
	);
}
