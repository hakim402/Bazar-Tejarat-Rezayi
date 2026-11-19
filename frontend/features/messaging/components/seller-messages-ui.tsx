"use client";

import Link from "next/link";
import { SellerSelect } from "../../../components/seller-select";
import { Icon } from "../../../components/ui/icon";
import { pageBannerClass } from "../../../components/ui/page-header";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { sellerMessagesCopy } from "../../../lib/i18n/seller-messages";
import {
	sellerHref,
	uuidPattern,
	type QueryReader,
} from "../../../lib/routes/account-routes";
import type { Profiles } from "../api";
import { communicationCopy } from "../copy";
import { badge } from "./ui";

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
	const smallIcon =
		"inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-action transition-colors hover:border-action hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";
	return (
		<header className={`${pageBannerClass} flex flex-wrap items-center gap-4`}>
			<div className="min-w-0 flex-1">
				<h1 className="text-page-title font-bold">{common.messages}</h1>
				<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
					{thread ? t.threadHelp : t.help}
				</p>
			</div>
			{!!profiles.length && onChange && (
				<div className="w-full min-w-0 sm:w-56">
					<SellerSelect
						dir={direction(locale)}
						label={t.business}
						value={selected}
						options={profiles.map((row) => ({
							value: row.id,
							label: row.name,
						}))}
						onChange={onChange}
						icon="store"
					/>
				</div>
			)}
			{profile && (
				<nav
					aria-label={t.businessManagement}
					className="flex shrink-0 gap-1.5"
				>
					<Link
						prefetch={false}
						className={smallIcon}
						title={t.businessManagement}
						aria-label={t.businessManagement}
						href={sellerHref(locale, "organizations", selected)}
					>
						<Icon name="store" className="size-4" />
					</Link>
					<Link
						prefetch={false}
						className={smallIcon}
						title={t.settings}
						aria-label={t.settings}
						href={sellerHref(locale, "settings", selected)}
					>
						<Icon name="gear" className="size-4" />
					</Link>
				</nav>
			)}
			{profile && (
				<span className={badge}>
					<bdi>
						{profile.kind === "individual"
							? t.individual
							: profile.kind === "company"
								? t.company
								: t.businessKind}
					</bdi>
					· {profile.messaging ? t.messagingAccess : common.noAccess}
				</span>
			)}
		</header>
	);
}
