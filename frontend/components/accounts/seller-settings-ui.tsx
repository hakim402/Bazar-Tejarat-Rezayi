"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { direction, type Locale } from "../../lib/i18n/locales";
import { sellerShellCopy } from "../../lib/i18n/seller-shell";
import { Card, CardContent, CardHeader } from "../shadcn/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../shadcn/dialog";
import { sellerSettingsCopy } from "../../lib/i18n/seller-settings";
import { useUnsavedNavigation } from "../layout/navigation-guard";
import { DiscardDialog } from "../ui/discard-dialog";
import { Icon, type IconName } from "../ui/icon";
import { pageBannerClass } from "../ui/page-header";

export const settingsControl =
	"w-full min-w-0 min-h-12 rounded-xl border border-control bg-surface px-3.5 py-3 text-base text-foreground shadow-sm focus:border-action disabled:cursor-not-allowed disabled:opacity-50";
export const settingsSecondary =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground no-underline transition-colors hover:bg-info motion-reduce:transition-none";
export const settingsDestinations = [
	{ path: "profile", key: "profile", icon: "user-circle" },
	{ path: "password", key: "password", icon: "shield-lock" },
	{ path: "link", key: "link", icon: "link" },
	{ path: "settings", key: "overview", icon: "gear" },
] as const;
export const businessSettingsDestinations = [
	{ path: "settings/store", key: "store", icon: "store" },
	{ path: "settings/checkout", key: "checkout", icon: "truck" },
] as const;
export type SettingsPath =
	| (typeof settingsDestinations)[number]["path"]
	| (typeof businessSettingsDestinations)[number]["path"];

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
	const business = businessSettingsDestinations.some(
		(item) => item.path === page,
	);
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
			<header className={pageBannerClass}>
				<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div className="min-w-0 space-y-2">
						<p
							className={`${business ? "m-0" : ""} text-xs font-semibold tracking-wide text-action`}
						>
							{business ? t.businessScope : t.accountScope}
						</p>
						<h1
							className={`${business ? "m-0" : ""} text-page-title font-bold text-foreground`}
						>
							{title ?? t[key]}
						</h1>
						<p
							className={`${business ? "m-0 text-sm" : "text-base"} max-w-2xl leading-relaxed text-muted`}
						>
							{description ?? help}
						</p>
					</div>
					{actions && (
						<div className="w-full min-w-0 lg:w-72 lg:shrink-0">{actions}</div>
					)}
				</div>
			</header>
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

export function BusinessSection({
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
		<Card
			id={id}
			className={`min-w-0 gap-0 rounded-2xl border-solid border-border py-0 shadow-none ${className}`}
		>
			<CardHeader className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:flex-wrap sm:p-5">
				<div className="min-w-0 flex-1 space-y-1">
					<h2 className="m-0 flex items-center gap-2 text-base font-semibold">
						{icon && (
							<Icon name={icon} className="size-4 shrink-0 text-muted" />
						)}
						{title}
					</h2>
					{description && (
						<p className="m-0 max-w-2xl text-sm leading-relaxed text-muted">
							{description}
						</p>
					)}
				</div>
				{actions}
			</CardHeader>
			<CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
				{children}
			</CardContent>
		</Card>
	);
}

export function BusinessDialog({
	locale,
	title,
	description,
	trigger,
	open,
	onOpenChange,
	busy = false,
	children,
}: {
	locale: Locale;
	title: string;
	description?: string;
	trigger?: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	busy?: boolean;
	children: ReactNode;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) onOpenChange?.(next);
			}}
		>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent
				dir={direction(locale)}
				closeLabel={sellerShellCopy[locale].close}
				showCloseButton={!busy}
				className="max-h-[85dvh] max-w-2xl overflow-y-auto overscroll-contain p-4 motion-reduce:animate-none motion-reduce:transition-none sm:p-6 [&_[data-slot=dialog-close]]:size-11"
				onEscapeKeyDown={(event) => {
					if (busy) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (busy) event.preventDefault();
				}}
			>
				<DialogHeader className="pe-10 text-start">
					<DialogTitle className="m-0 text-lg leading-snug">
						{title}
					</DialogTitle>
					<DialogDescription className={description ? "m-0" : "sr-only"}>
						{description ?? title}
					</DialogDescription>
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
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
