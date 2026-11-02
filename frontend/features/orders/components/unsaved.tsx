"use client";
import { useCallback, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { useUnsavedNavigation } from "../../../components/layout/navigation-guard";
import { action } from "./controls";
export function useCommerceGuard(locale: Locale, dirty: boolean) {
	const [pending, setPending] = useState<(() => void) | null>(null),
		focus = useRef<HTMLElement | null>(null),
		t = catalogueCopy[locale];
	const guard = useCallback((next: () => void) => {
		focus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setPending(() => next);
	}, []);
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
					setPending(null);
					focus.current?.focus();
				}}
			>
				{t.cancel}
			</button>
		</div>
	) : null;
	return { choose, feedback };
}
