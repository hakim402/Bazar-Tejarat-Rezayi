"use client";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { sellerHref } from "../../../../../../lib/routes/account-routes";
import { Icon } from "../../../../../../components/ui/icon";

interface PageItem {
	label: string;
	href: string;
	keywords: string[];
}

export function JumpToPage({ locale }: { locale: Locale }) {
	const t = inventoryCopy[locale];
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const pages: PageItem[] = [
		{
			label: t.overview,
			href: sellerHref(locale, ""),
			keywords: ["home", "dashboard"],
		},
		{
			label: t.products,
			href: sellerHref(locale, "catalogue"),
			keywords: ["catalogue", "products"],
		},
		{
			label: t.inventory,
			href: sellerHref(locale, "inventory"),
			keywords: ["stock", "inventory"],
		},
		{
			label: t.movements,
			href: sellerHref(locale, "inventory/movements"),
			keywords: ["history", "movements"],
		},
		{
			label: t.organization,
			href: sellerHref(locale, "organizations"),
			keywords: ["business", "team", "organization"],
		},
		{
			label: "Messages",
			href: sellerHref(locale, "messages"),
			keywords: ["messages", "inbox"],
		},
		{
			label: "Notifications",
			href: sellerHref(locale, "notifications"),
			keywords: ["notifications", "alerts"],
		},
		{
			label: "Negotiations",
			href: sellerHref(locale, "negotiations"),
			keywords: ["negotiations", "requests"],
		},
		{
			label: "Orders",
			href: sellerHref(locale, "orders"),
			keywords: ["orders", "sales"],
		},
		{
			label: "Fulfilment",
			href: sellerHref(locale, "fulfilment"),
			keywords: ["fulfilment", "delivery"],
		},
		{
			label: "Invoices",
			href: sellerHref(locale, "invoices"),
			keywords: ["invoices", "billing"],
		},
		{
			label: "Payments",
			href: sellerHref(locale, "payments"),
			keywords: ["payments", "money"],
		},
		{
			label: "Aftercare",
			href: sellerHref(locale, "aftercare"),
			keywords: ["aftercare", "cancellations"],
		},
		{
			label: t.profile,
			href: sellerHref(locale, "profile"),
			keywords: ["profile", "account"],
		},
		{
			label: "Settings",
			href: sellerHref(locale, "settings"),
			keywords: ["settings", "preferences"],
		},
		{
			label: t.password,
			href: sellerHref(locale, "password"),
			keywords: ["password", "security"],
		},
		{
			label: t.link,
			href: sellerHref(locale, "link"),
			keywords: ["link", "connected"],
		},
	];

	const filtered = query.trim()
		? pages.filter(
				(p) =>
					p.label.toLowerCase().includes(query.toLowerCase()) ||
					p.keywords.some((k) => k.includes(query.toLowerCase())),
			)
		: pages;

	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setOpen(true);
			}
			if (e.key === "Escape" && open) {
				setOpen(false);
				setQuery("");
			}
		}
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [open]);

	useEffect(() => {
		if (open) {
			inputRef.current?.focus();
		}
	}, [open]);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				onKeyUp={(e) => {
					if (e.key === "Enter" || e.key === " ") setOpen(true);
				}}
				className="flex min-h-10 items-center gap-2 rounded-sm border border-border bg-page px-3 text-caption text-muted transition-colors hover:border-action hover:text-foreground"
				aria-label={t.jumpTo}
			>
				<Icon name="search" className="size-4" />
				<span className="hidden sm:inline">{t.jumpPlaceholder}</span>
				<kbd className="hidden rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-mono sm:inline">
					⌘K
				</kbd>
			</button>
			{open && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center bg-ink/50 p-4 pt-20"
					onClick={() => {
						setOpen(false);
						setQuery("");
					}}
					onKeyUp={(e) => {
						if (e.key === "Escape") {
							setOpen(false);
							setQuery("");
						}
					}}
					role="dialog"
					aria-modal="true"
					aria-label={t.jumpTo}
				>
					<div
						className="w-full max-w-lg rounded-card border border-border bg-surface shadow-lifted"
						onClick={(e) => e.stopPropagation()}
						onKeyUp={(e) => e.stopPropagation()}
						role="document"
					>
						<div className="border-b border-border p-3">
							<input
								ref={inputRef}
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder={t.jumpPlaceholder}
								className="w-full bg-transparent text-body text-foreground placeholder:text-muted focus:outline-none"
								aria-label={t.jumpPlaceholder}
							/>
						</div>
						<div className="max-h-80 overflow-y-auto p-2">
							{filtered.map((page) => (
								<a
									key={page.href}
									href={page.href}
									className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-body text-foreground no-underline transition-colors hover:bg-info"
									onClick={() => {
										setOpen(false);
										setQuery("");
									}}
									aria-current={pathname === page.href ? "page" : undefined}
								>
									<Icon name="arrow" className="size-4 text-muted" />
									{page.label}
								</a>
							))}
							{!filtered.length && (
								<p className="px-3 py-4 text-center text-caption text-muted">
									No pages found
								</p>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
