"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../../../../../../components/ui/icon";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "../../../../../../components/shadcn/dialog";
import { Input } from "../../../../../../components/shadcn/input";
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
	const dialogId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [target, setTarget] = useState<HTMLElement | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");

	const open = useCallback(() => {
		if (isOpen) {
			inputRef.current?.focus();
			return;
		}
		// Do not cover another modal, including an unsaved-navigation review.
		if (
			document.querySelector(
				'dialog[open], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
			)
		)
			return;
		setQuery("");
		setIsOpen(true);
	}, [isOpen]);

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
		setIsOpen(false);
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
						title={t.jumpTo}
						aria-haspopup="dialog"
						aria-controls={dialogId}
						aria-expanded={isOpen}
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
			<Dialog
				open={isOpen}
				onOpenChange={(next) => {
					setIsOpen(next);
					if (!next) setQuery("");
				}}
			>
				<DialogContent
					id={dialogId}
					dir={direction(locale)}
					showCloseButton={false}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						inputRef.current?.focus();
					}}
					onKeyDown={(event) => {
						if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
						event.preventDefault();
						const links = Array.from(
							event.currentTarget.querySelectorAll<HTMLAnchorElement>(
								"a[data-jump-page]",
							),
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
					}}
					className="block w-[min(36rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden rounded-card border border-border bg-surface p-0 text-foreground shadow-lifted"
				>
					<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
						<DialogTitle className="text-body font-semibold">
							{t.jumpTo}
						</DialogTitle>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							aria-label={t.close}
							title={t.close}
							className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-info hover:text-foreground"
						>
							<Icon name="close" />
						</button>
					</div>
					<div className="flex items-center gap-2 border-b border-border px-4 py-3">
						<Icon name="search" className="size-5 text-muted" />
						<Input
							ref={inputRef}
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t.jumpPlaceholder}
							aria-label={t.jumpPlaceholder}
							className="h-12 min-w-0 flex-1 appearance-none rounded-xl border-border bg-page px-4 text-base shadow-none md:text-base"
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
										onNavigate={() => {
											setIsOpen(false);
											setQuery("");
										}}
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
				</DialogContent>
			</Dialog>
		</>
	);
}