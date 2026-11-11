"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { useUnsavedNavigation } from "../../../components/layout/navigation-guard";
import { action } from "./controls";
export function useCommerceGuard(locale: Locale, dirty: boolean) {
	const [pending, setPending] = useState<(() => void) | null>(null),
		focus = useRef<HTMLElement | null>(null),
		restoreFocus = useRef<HTMLElement | null>(null),
		t = catalogueCopy[locale];
	const guard = useCallback((next: () => void, returnFocus?: HTMLElement | null) => {
		focus.current = returnFocus ?? (
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null);
		setPending(() => next);
	}, []);
	useLayoutEffect(() => {
		if (pending || !restoreFocus.current) return;
		const previous = restoreFocus.current;
		restoreFocus.current = null;
		if (!previous.isConnected) return;
		let details = previous.closest("details");
		while (details) {
			details.open = true;
			details = details.parentElement?.closest("details") ?? null;
		}
		previous.focus();
	}, [pending]);
	useUnsavedNavigation(dirty, guard);
	const choose = useCallback(
		(next: () => void) => {
			if (dirty) guard(next);
			else next();
		},
		[dirty, guard],
	);
	const feedback = pending ? (
		<div
			role="alert"
			tabIndex={-1}
			ref={(node) => node?.focus()}
			className="space-y-3 rounded-card border border-warning bg-warning-surface p-4"
		>
			<p>{t.dirty}</p>
			<button
				type="button"
				className={action}
				onClick={() => {
					const next = pending;
					setPending(null);
					next();
				}}
			>
				{t.confirm}
			</button>{" "}
			<button
				type="button"
				className={action}
				onClick={() => {
					restoreFocus.current = focus.current;
					setPending(null);
				}}
			>
				{t.cancel}
			</button>
		</div>
	) : null;
	return { choose, feedback };
}
