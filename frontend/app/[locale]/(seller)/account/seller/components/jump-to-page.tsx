"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../../../../../../components/ui/icon";
import { direction, type Locale } from "../../../../../../lib/i18n/locales";
import { sellerShellCopy } from "../../../../../../lib/i18n/seller-shell";

export interface SellerDestination {
	route: string;
	label: string;
	href: string;
	icon: IconName;
	active: boolean;
}

export interface SellerNavigationGroup {
	label: string;
	links: SellerDestination[];
}

export function JumpToPage({
	locale,
	groups,
	scope,
}: {
	locale: Locale;
	groups: SellerNavigationGroup[];
	scope: string | null;
}) {
	const t = sellerShellCopy[locale];
	const pathname = usePathname();
	const titleId = useId();
	const dialogId = useId();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const returnFocus = useRef<HTMLElement | null>(null);
	const [target, setTarget] = useState<HTMLElement | null>(null);
	const [query, setQuery] = useState("");

	const open = useCallback(() => {
		const dialog = dialogRef.current;
		if (!dialog || dialog.open) {
			inputRef.current?.focus();
			return;
		}
		// Do not cover another modal, including an unsaved-navigation review.
		if (document.querySelector("dialog[open]")) return;
		returnFocus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setQuery("");
		dialog.showModal();
		inputRef.current?.focus();
	}, []);

	useEffect(() => {
		setTarget(document.getElementById("seller-jump-to-page"));
		const handleKey = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				event.key.toLowerCase() === "k"
			) {
				event.preventDefault();
				open();
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [open]);

	useEffect(() => {
		// A new route or seller scope must not retain a previous search session.
		void pathname;
		void scope;
		dialogRef.current?.close();
		setQuery("");
	}, [pathname, scope]);

	const search = query.trim().toLocaleLowerCase(locale);
	const filtered = groups
		.map((group) => ({
			...group,
			links: group.links.filter((page) =>
				`${group.label} ${page.label} ${page.route}`
					.toLocaleLowerCase(locale)
					.includes(search),
			),
		}))
		.filter((group) => group.links.length > 0);

	return (
		<>
			{target &&
				createPortal(
					<button
						type="button"
						onClick={open}
						aria-label={t.jumpTo}
						aria-haspopup="dialog"
						aria-controls={dialogId}
						aria-keyshortcuts="Control+k Meta+k"
						className="flex min-h-11 min-w-11 w-11 cursor-pointer items-center justify-center gap-3 rounded-xl border border-border bg-page px-3 text-sm text-muted transition-colors hover:border-action hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none lg:w-full lg:max-w-2xl lg:justify-start lg:px-4"
					>
						<Icon name="search" className="size-4" />
						<span className="hidden min-w-0 flex-1 truncate text-start lg:block">
							{t.jumpTo}
						</span>
						<kbd
							dir="ltr"
							className="hidden shrink-0 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-xs lg:inline"
						>
							{t.shortcut}
						</kbd>
					</button>,
					target,
				)}
			<dialog
				ref={dialogRef}
				id={dialogId}
				dir={direction(locale)}
				tabIndex={-1}
				aria-labelledby={titleId}
				onCancel={(event) => {
					event.preventDefault();
					event.currentTarget.close();
				}}
				onClose={(event) => {
					if (event.currentTarget.open) return;
					setQuery("");
					if (returnFocus.current?.isConnected) returnFocus.current.focus();
				}}
				onClick={(event) => {
					if (event.target !== event.currentTarget) return;
					const rect = event.currentTarget.getBoundingClientRect();
					if (
						event.clientX < rect.left ||
						event.clientX > rect.right ||
						event.clientY < rect.top ||
						event.clientY > rect.bottom
					)
						event.currentTarget.close();
				}}
				onKeyDown={(event) => {
					const dialog = event.currentTarget;
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						const links = Array.from(
							dialog.querySelectorAll<HTMLAnchorElement>("a[data-jump-page]"),
						);
						if (!links.length) return;
						const index =
							document.activeElement instanceof HTMLAnchorElement
								? links.indexOf(document.activeElement)
								: -1;
						const next =
							event.key === "ArrowDown"
								? (index + 1) % links.length
								: index <= 0
									? links.length - 1
									: index - 1;
						links[next]?.focus();
						return;
					}
					if (event.key !== "Tab") return;
					const controls = Array.from(
						dialog.querySelectorAll<HTMLElement>("button, input, a[href]"),
					);
					const first = controls[0],
						last = controls[controls.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}}
				className="m-auto w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-card border border-border bg-surface p-0 text-foreground shadow-lifted backdrop:bg-overlay"
			>
				<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
					<h2 id={titleId} className="text-body font-semibold">
						{t.jumpTo}
					</h2>
					<button
						type="button"
						onClick={() => dialogRef.current?.close()}
						aria-label={t.close}
						className="flex min-h-11 min-w-11 items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-info hover:text-foreground"
					>
						<Icon name="close" />
					</button>
				</div>
				<div className="flex items-center gap-2 border-b border-border px-4 py-3">
					<Icon name="search" className="size-5 text-muted" />
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t.jumpPlaceholder}
						aria-label={t.jumpPlaceholder}
						className="min-h-12 min-w-0 flex-1 appearance-none rounded-xl border border-border bg-page px-4 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
					/>
				</div>
				<nav
					aria-label={t.navigation}
					className="max-h-[min(28rem,60dvh)] space-y-3 overflow-y-auto overscroll-contain p-3"
				>
					{filtered.map((group) => (
						<div key={group.label}>
							<p className="px-3 pb-1 text-caption font-semibold text-muted">
								{group.label}
							</p>
							{group.links.map((page) => (
								<Link
									key={page.route}
									href={page.href}
									data-jump-page
									onNavigate={() => dialogRef.current?.close()}
									aria-current={page.active ? "page" : undefined}
									className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-body text-foreground no-underline hover:bg-info focus-visible:bg-info aria-[current=page]:bg-info aria-[current=page]:font-semibold aria-[current=page]:text-action"
								>
									<Icon name={page.icon} className="size-5 text-muted" />
									<span>{page.label}</span>
								</Link>
							))}
						</div>
					))}
					{!filtered.length && (
						<p
							role="status"
							className="px-3 py-4 text-center text-caption text-muted"
						>
							{t.noPages}
						</p>
					)}
				</nav>
			</dialog>
		</>
	);
}
