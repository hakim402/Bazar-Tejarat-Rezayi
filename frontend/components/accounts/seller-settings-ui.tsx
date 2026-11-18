"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { sellerSettingsCopy } from "../../lib/i18n/seller-settings";
import { sellerHref, uuidPattern } from "../../lib/routes/account-routes";
import { useUnsavedNavigation } from "../layout/navigation-guard";
import { DiscardDialog } from "../ui/discard-dialog";
import { Icon, type IconName } from "../ui/icon";

export const settingsControl =
	"w-full min-w-0 min-h-12 rounded-xl border border-control bg-surface px-3.5 py-3 text-base text-foreground shadow-sm focus:border-action disabled:cursor-not-allowed disabled:opacity-50";
export const settingsSecondary =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground no-underline transition-colors hover:bg-info motion-reduce:transition-none";
export const settingsDestinations = [
	{ path: "settings", key: "overview", icon: "gear" },
	{ path: "profile", key: "profile", icon: "user-circle" },
	{ path: "password", key: "password", icon: "shield-lock" },
	{ path: "link", key: "link", icon: "link" },
	{ path: "settings/store", key: "store", icon: "store" },
	{ path: "settings/checkout", key: "checkout", icon: "truck" },
] as const;
export type SettingsPath = (typeof settingsDestinations)[number]["path"];

export function SettingsPage({
	locale,
	page,
	title,
	description,
	actions,
	children,
}: {
	locale: Locale;
	page: SettingsPath;
	title?: string;
	description?: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	const t = sellerSettingsCopy[locale];
	const query = useSearchParams().get("seller");
	const seller = query && uuidPattern.test(query) ? query : null;
	const pathname = usePathname();
	const key =
		page === "settings/store"
			? "store"
			: page === "settings/checkout"
				? "checkout"
				: page === "settings"
					? "overview"
					: page;
	const help =
		page === "settings"
			? t.overviewHelp
			: page === "profile"
				? t.profileHelp
				: page === "password"
					? t.passwordHelp
					: page === "link"
						? t.linkHelp
						: page === "settings/store"
							? t.storeHelp
							: t.checkoutHelp;
	return (
		<div className="min-w-0 space-y-6" data-testid="seller-settings-page">
			<header className="space-y-4">
				{page !== "settings" && (
					<Link
						href={sellerHref(locale, "settings", seller)}
						className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted no-underline hover:text-action"
					>
						<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
						{t.back}
					</Link>
				)}
				<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0 space-y-2">
						<p className="text-xs font-semibold tracking-wide text-action">
							{t.title}
						</p>
						<h1 className="text-page-title font-bold text-foreground">
							{title ?? t[key]}
						</h1>
						<p className="max-w-2xl text-base leading-relaxed text-muted">
							{description ?? help}
						</p>
					</div>
					{actions && (
						<div className="w-full min-w-0 lg:w-72 lg:shrink-0">{actions}</div>
					)}
				</div>
			</header>
			<nav
				aria-label={t.title}
				className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-surface p-2 shadow-sm sm:grid-cols-3 xl:flex xl:flex-wrap"
			>
				{settingsDestinations.map((item) => {
					const active = pathname === sellerHref(locale, item.path);
					return (
						<Link
							key={item.path}
							href={sellerHref(locale, item.path, seller)}
							aria-current={active ? "page" : undefined}
							className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium no-underline transition-colors motion-reduce:transition-none ${active ? "bg-info text-action" : "text-muted hover:bg-page hover:text-foreground"}`}
						>
							<Icon name={item.icon} className="size-4" />
							<span className="min-w-0 wrap-anywhere">{t[item.key]}</span>
						</Link>
					);
				})}
			</nav>
			{children}
		</div>
	);
}

export function SettingsSection({
	title,
	description,
	icon,
	actions,
	children,
	id,
	className = "",
}: {
	title: string;
	description?: string;
	icon?: IconName;
	actions?: ReactNode;
	children: ReactNode;
	id?: string;
	className?: string;
}) {
	return (
		<section
			id={id}
			className={`min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm ${className}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-5 sm:px-6">
				<div className="flex min-w-0 items-start gap-3">
					{icon && (
						<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info text-action">
							<Icon name={icon} />
						</span>
					)}
					<div className="min-w-0">
						<h2 className="text-lg font-semibold text-foreground">{title}</h2>
						{description && (
							<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
								{description}
							</p>
						)}
					</div>
				</div>
				{actions}
			</div>
			<div className="min-w-0 space-y-5 p-4 sm:p-6">{children}</div>
		</section>
	);
}

export function SettingsActions({
	dirty,
	locale,
	children,
}: {
	dirty?: boolean;
	locale: Locale;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
			<span className="text-sm text-muted">
				{dirty ? sellerSettingsCopy[locale].unsaved : ""}
			</span>
			<div className="flex flex-wrap items-center gap-3 [&>button]:flex-1 sm:[&>button]:flex-none">
				{children}
			</div>
		</div>
	);
}

export function useSettingsGuard(locale: Locale, dirty: boolean) {
	const [pending, setPending] = useState<(() => void) | null>(null);
	const focus = useRef<HTMLElement | null>(null);
	const t = sellerSettingsCopy[locale];
	const guard = useCallback((next: () => void) => {
		focus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setPending(() => next);
	}, []);
	useUnsavedNavigation(dirty, guard);
	const cancel = () => {
		setPending(null);
		focus.current?.focus();
	};
	const choose = useCallback(
		(next: () => void) => {
			if (dirty) guard(next);
			else next();
		},
		[dirty, guard],
	);
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
	return { choose, feedback };
}
