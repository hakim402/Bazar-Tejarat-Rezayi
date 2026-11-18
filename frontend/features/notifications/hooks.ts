"use client";
import { useCallback, useEffect, useState } from "react";
import type { Context } from "../messaging/api";
import { useVisiblePoll } from "../messaging/hooks";
import { notification, type Counts } from "./api";

// One shared unread poll for the header bell and dashboard sidebar badges.
export function useUnreadCount(
	context: Context | null,
	seller = "",
	enabled = true,
) {
	const [counts, setCounts] = useState<Counts | null>(null);
	const [error, setError] = useState(false);
	const [revision, setRevision] = useState(0);
	const reload = useCallback(() => setRevision((value) => value + 1), []);
	useVisiblePoll(
		async (signal) => {
			if (!context) return;
			try {
				const value = await notification<Counts>(
					context,
					`unread/${seller ? `?seller=${encodeURIComponent(seller)}` : ""}`,
					undefined,
					"GET",
					{ signal },
				);
				if (!signal.aborted) {
					setCounts(value);
					setError(false);
				}
			} catch (failure) {
				if (signal.aborted) return;
				setCounts(null);
				setError(true);
				throw failure;
			}
		},
		[context, seller, revision],
		enabled && !!context,
	);
	useEffect(() => {
		if (!context) {
			setCounts(null);
			setError(false);
		}
	}, [context]);
	return { count: counts?.unread_notices ?? 0, counts, error, reload };
}
