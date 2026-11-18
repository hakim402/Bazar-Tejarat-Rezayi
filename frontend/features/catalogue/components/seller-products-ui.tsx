"use client";
import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useUnsavedNavigation } from "../../../components/layout/navigation-guard";
import { DiscardDialog } from "../../../components/ui/discard-dialog";
import { Icon } from "../../../components/ui/icon";
import { sellerProductsCopy } from "../../../lib/i18n/seller-products";
import type { Locale } from "../../../lib/i18n/locales";
import {
	sellerHref,
	uuidPattern,
	type QueryReader,
} from "../../../lib/routes/account-routes";

export function productHref(
	locale: Locale,
	path: string,
	seller?: string | null,
	filters?: QueryReader,
	changes: Record<string, string> = {},
) {
	return sellerHref(
		locale,
		path,
		seller && uuidPattern.test(seller) ? seller : null,
		{
			get: (key) => {
				const value = filters?.get(key) ?? "";
				if (
					key === "state" &&
					["draft", "submitted", "rejected", "withdrawn", "live"].includes(
						value,
					)
				)
					return value;
				if (
					key === "page" &&
					/^\d+$/.test(value) &&
					Number(value) >= 1 &&
					Number(value) <= 10000
				)
					return value;
				return null;
			},
		},
		changes,
	);
}
export const productLink =
	"inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-solid border-border bg-surface px-3.5 py-2 text-sm font-semibold text-foreground no-underline transition-colors hover:bg-info motion-reduce:transition-none";
export function ProductsPage({
	locale,
	title,
	description,
	back,
	actions,
	narrow = false,
	children,
}: {
	locale: Locale;
	title: string;
	description?: string;
	back?: string;
	actions?: ReactNode;
	narrow?: boolean;
	children: ReactNode;
}) {
	const t = sellerProductsCopy[locale];
	return (
		<div
			className={`min-w-0 space-y-5 ${narrow ? "mx-auto w-full max-w-4xl" : ""}`}
			data-testid="seller-products-page"
		>
			<header className="space-y-4">
				{back && (
					<Link
						href={back}
						className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted no-underline hover:text-action"
					>
						<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
						{t.title}
					</Link>
				)}
				<div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-2">
						<h1 className="text-page-title font-bold text-foreground wrap-anywhere">
							{title}
						</h1>
						{description && (
							<p className="max-w-2xl text-base leading-relaxed text-muted">
								{description}
							</p>
						)}
					</div>
					{actions && (
						<div className="flex min-w-0 shrink-0 flex-wrap gap-2">
							{actions}
						</div>
					)}
				</div>
			</header>
			{children}
		</div>
	);
}
export function useProductGuard(locale: Locale, dirty: boolean) {
	const t = sellerProductsCopy[locale];
	const [pending, setPending] = useState<(() => void) | null>(null);
	const focus = useRef<HTMLElement | null>(null);
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
	const cancel = () => {
		setPending(null);
		focus.current?.focus();
	};
	const feedback = (
		<DiscardDialog
			locale={locale}
			open={pending !== null}
			title={t.dirtyTitle}
			help={t.dirtyHelp}
			cancelLabel={t.stay}
			confirmLabel={t.discard}
			onCancel={cancel}
			onConfirm={() => {
				const next = pending;
				setPending(null);
				next?.();
			}}
		/>
	);
	const reset = useCallback(() => {
		setPending(null);
	}, []);
	return { choose, feedback, reset };
}
