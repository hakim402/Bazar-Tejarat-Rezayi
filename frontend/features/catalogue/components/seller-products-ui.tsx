"use client";
import Link from "next/link";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useUnsavedNavigation } from "../../../components/layout/navigation-guard";
import { Button } from "./product-controls";
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
	const dialog = useRef<HTMLDialogElement>(null),
		focus = useRef<HTMLElement | null>(null);
	const guard = useCallback((next: () => void) => {
		focus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setPending(() => next);
	}, []);
	useUnsavedNavigation(dirty, guard);
	useEffect(() => {
		if (pending && !dialog.current?.open) dialog.current?.showModal();
	}, [pending]);
	const choose = useCallback(
		(next: () => void) => {
			if (dirty) guard(next);
			else next();
		},
		[dirty, guard],
	);
	const cancel = () => {
		dialog.current?.close();
		setPending(null);
		focus.current?.focus();
	};
	const feedback = pending ? (
		<dialog
			ref={dialog}
			aria-labelledby="product-discard-title"
			aria-describedby="product-discard-help"
			onCancel={(event) => {
				event.preventDefault();
				cancel();
			}}
			className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-border bg-surface p-6 text-foreground shadow-lifted backdrop:bg-black/50"
		>
			<span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-warning-surface text-warning">
				<Icon name="alert-triangle" />
			</span>
			<h2 id="product-discard-title" className="text-xl font-semibold">
				{t.dirtyTitle}
			</h2>
			<p
				id="product-discard-help"
				className="mt-2 text-base leading-relaxed text-muted"
			>
				{t.dirtyHelp}
			</p>
			<div className="mt-6 flex flex-col gap-3 sm:flex-row">
				<Button variant="secondary" autoFocus onClick={cancel}>
					{t.stay}
				</Button>
				<Button
					onClick={() => {
						const next = pending;
						dialog.current?.close();
						setPending(null);
						next();
					}}
				>
					{t.discard}
				</Button>
			</div>
		</dialog>
	) : null;
	const reset = useCallback(() => {
		dialog.current?.close();
		setPending(null);
	}, []);
	return { choose, feedback, reset };
}
