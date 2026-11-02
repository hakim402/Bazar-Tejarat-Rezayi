"use client";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
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
}: {
	context: Context;
	locale: Locale;
	seller?: string;
	onDenied?: (error: unknown) => void;
}) {
	const [counts, setCounts] = useState<Counts | null>(null),
		[error, setError] = useState<unknown>(null);
	const t = communicationCopy[locale];
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
	return (
		<section className="flex flex-wrap gap-4 text-sm" aria-label={t.unread}>
			{error ? (
				<span>{t.failed}</span>
			) : counts ? (
				<>
					<span>
						{t.threadCount}: <bdi>{counts.unread_threads}</bdi>
					</span>
					<span>
						{t.noticeCount}: <bdi>{counts.unread_notices}</bdi>
					</span>
				</>
			) : (
				<span>{t.loading}</span>
			)}
		</section>
	);
}
