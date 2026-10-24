"use client";
import Link from "next/link";
import { accessCopy } from "../../lib/i18n/access";
import { useRef, useState } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { Icon, type IconName } from "../../components/ui/icon";
import { Preferences } from "../../components/layout/preferences";
import { categories, categoryHref } from "./data";
import { storefrontCopy } from "./copy";
export function StorefrontNavigation({ locale }: { locale: Locale }) {
	const t = storefrontCopy[locale],
		[query, setQuery] = useState("");
	const [notice, setNotice] = useState("");
	const preferences = useRef<HTMLDetailsElement>(null);
	const matches = categories.filter(({ id }) =>
		t.categoryNames[id]
			.toLocaleLowerCase(locale)
			.includes(query.trim().toLocaleLowerCase(locale)),
	);
	function closeMenus() {
		if (preferences.current) preferences.current.open = false;
	}
	return (
		<>
			<div className="relative order-last flex w-full min-w-0 items-center gap-2 desktop:order-none desktop:flex-1 desktop:gap-3">
				<search aria-label={t.search} className="min-w-0 flex-1">
					<form
						onSubmit={(event) => event.preventDefault()}
						className="flex min-h-12 items-center gap-2 rounded-2xl bg-page px-3 ring-1 ring-inset ring-border/50 focus-within:ring-action"
					>
						<Icon name="search" className="size-5 text-muted" />
						<input
							type="search"
							aria-label={t.search}
							placeholder={t.placeholder}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") setQuery("");
							}}
							className="min-h-12 w-full min-w-0 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted focus-visible:outline-none"
						/>
					</form>
				</search>
				<Link
					href={`/${locale}/sell`}
					className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control px-2 text-xs font-medium text-foreground no-underline hover:bg-info desktop:px-3 desktop:text-sm"
				>
					<Icon name="store" className="size-4" />
					<span>{accessCopy[locale].becomeSeller}</span>
				</Link>
				{query.trim() && (
					<div className="absolute inset-x-0 top-full z-40 mt-3 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-card">
						<p className="px-3 py-2 text-xs text-muted">{t.demo}</p>
						{matches.length ? (
							matches.map(({ id, icon }) => (
								<a
									key={id}
									href={categoryHref(locale, id)}
									onClick={() => setQuery("")}
									className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-foreground no-underline hover:bg-info"
								>
									<Icon name={icon} className="size-4" />
									{t.categoryNames[id]}
								</a>
							))
						) : (
							<p role="status" className="p-3 text-sm text-muted">
								{t.noResults}
							</p>
						)}
					</div>
				)}
			</div>
			<div className="relative ms-auto flex shrink-0 items-center gap-1 desktop:ms-0 desktop:gap-2">
				{(
					[
						["bell", t.notifications],
						["heart", t.wishlist],
						["cart", t.cart],
					] as [IconName, string][]
				).map(([icon, label]) => (
					<button
						key={icon}
						type="button"
						aria-label={`${label} — ${t.soon}`}
						aria-disabled="true"
						title={`${label} — ${t.soon}`}
						onClick={() => setNotice(`${label} — ${t.soon}`)}
						className={`${icon === "bell" ? "hidden min-[420px]:flex" : "flex"} size-9 items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-info hover:text-action desktop:size-11`}
					>
						<Icon name={icon} />
					</button>
				))}
				<details
					ref={preferences}
					className="group/preferences relative"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							closeMenus();
							preferences.current?.querySelector("summary")?.focus();
						}
					}}
				>
					<summary
						aria-label={t.preferences}
						className="flex size-9 list-none items-center justify-center rounded-full text-muted hover:bg-info desktop:size-11 [&::-webkit-details-marker]:hidden"
					>
						<Icon name="globe" />
					</summary>
					<div className="absolute end-0 top-full z-40 mt-3 hidden w-64 max-w-[85vw] rounded-2xl border border-border bg-surface p-4 shadow-card group-open/preferences:block max-[767px]:fixed max-[767px]:inset-x-3 max-[767px]:top-16 max-[767px]:w-auto max-[767px]:max-w-none">
						<p className="mb-3 text-sm font-bold">{t.preferences}</p>
						<Preferences locale={locale} />
					</div>
				</details>
				{notice && (
					<div
						role="status"
						className="absolute end-0 top-full z-40 mt-3 flex w-64 max-w-[85vw] items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-sm shadow-card"
					>
						<span>{notice}</span>
						<button
							type="button"
							aria-label={t.close}
							onClick={() => setNotice("")}
							className="flex size-11 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-foreground"
						>
							<Icon name="close" className="size-4" />
						</button>
					</div>
				)}
			</div>
		</>
	);
}
