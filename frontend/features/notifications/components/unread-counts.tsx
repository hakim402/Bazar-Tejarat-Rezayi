"use client";
import Link from "next/link";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon, type IconName } from "../../../components/ui/icon";
import { notification, type Counts } from "../api";
import type { Context } from "../../messaging/api";
import { communicationCopy } from "../../messaging/copy";
import { useVisiblePoll, accessLost } from "../../messaging/hooks";
import { clearDrafts } from "../../messaging/drafts";
export function CountStrip({
	context,
	locale,
	seller,
	onDenied,
	variant,
}: {
	context: Context;
	locale: Locale;
	seller?: string;
	onDenied?: (error: unknown) => void;
	variant?: "buyer";
}) {
	const [counts, setCounts] = useState<Counts | null>(null),
		[error, setError] = useState<unknown>(null);
	const t = communicationCopy[locale];
	const noticeHref = `/${locale}/account/${context}/notifications${seller ? `?seller=${seller}` : ""}`;
	useVisiblePoll(
		async (signal) => {
			try {
				const data = await notification<Counts>(
					context,
					`unread/${seller ? `?seller=${seller}` : ""}`,
					undefined,
					"GET",
					{ signal },
				);
				if (signal.aborted) return;
				setCounts(data);
				setError(null);
			} catch (e) {
				if (signal.aborted) return;
				setCounts(null);
				setError(e);
				if (accessLost(e)) {
					clearDrafts();
					onDenied?.(e);
				}
				throw e;
			}
		},
		[context, seller],
	);
	if (variant === "buyer") {
		const messagesHref = `/${locale}/account/${context}/messages${seller ? `?seller=${seller}` : ""}`;
		return (
			<section className="grid gap-3 sm:grid-cols-2" aria-label={t.unread}>
				{error ? (
					<span className="text-sm text-muted">{t.failed}</span>
				) : counts ? (
					<>
						<BuyerCount
							locale={locale}
							icon="mail"
							label={t.threadCount}
							value={counts.unread_threads}
							href={messagesHref}
						/>
						<BuyerCount
							locale={locale}
							icon="bell"
							label={t.noticeCount}
							value={counts.unread_notices}
							href={noticeHref}
						/>
					</>
				) : (
					<span className="text-sm text-muted">{t.loading}</span>
				)}
			</section>
		);
	}
	return (
		<section className="flex items-center gap-2" aria-label={t.unread}>
			{error ? (
				<span className="text-sm text-muted">{t.failed}</span>
			) : counts ? (
				<>
					<CountBadge
						locale={locale}
						icon="mail"
						label={t.threadCount}
						value={counts.unread_threads}
					/>
					<CountBadge
						locale={locale}
						icon="bell"
						label={t.noticeCount}
						value={counts.unread_notices}
						href={noticeHref}
					/>
				</>
			) : (
				<span className="text-sm text-muted">{t.loading}</span>
			)}
		</section>
	);
}

function CountBadge({
	locale,
	icon,
	label,
	value,
	href,
}: {
	locale: Locale;
	icon: IconName;
	label: string;
	value: number;
	href?: string;
}) {
	const text = `${label}: ${new Intl.NumberFormat(locale).format(value)}`;
	const base =
		"relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-action";
	const inner = (
		<>
			<Icon name={icon} className="size-5" />
			{value > 0 && (
				<span
					className="absolute -end-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-bold leading-5 text-on-primary tabular-nums"
					dir="ltr"
				>
					{new Intl.NumberFormat(locale).format(value)}
				</span>
			)}
		</>
	);
	if (href)
		return (
			<Link
				prefetch={false}
				href={href}
				className={`${base} no-underline transition-colors hover:border-action hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none`}
				title={text}
				aria-label={text}
			>
				{inner}
			</Link>
		);
	return (
		<span role="img" className={base} title={text} aria-label={text}>
			{inner}
		</span>
	);
}

function BuyerCount({
	locale,
	icon,
	label,
	value,
	href,
}: {
	locale: Locale;
	icon: IconName;
	label: string;
	value: number;
	href: string;
}) {
	const text = `${label}: ${new Intl.NumberFormat(locale).format(value)}`;
	return (
		<Link
			prefetch={false}
			href={href}
			title={text}
			aria-label={text}
			className="flex items-center gap-3 rounded-xl border border-solid border-border bg-surface p-3 no-underline transition-colors hover:border-action hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
		>
			<span
				className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-page text-action"
				aria-hidden="true"
			>
				<Icon name={icon} className="size-5" />
			</span>
			<span className="min-w-0">
				<span className="block text-xs font-medium text-muted">{label}</span>
				<span className="block text-xl font-bold tabular-nums text-foreground">
					{new Intl.NumberFormat(locale).format(value)}
				</span>
			</span>
		</Link>
	);
}
