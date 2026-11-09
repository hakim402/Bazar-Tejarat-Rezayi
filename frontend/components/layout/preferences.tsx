"use client";
import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import {
	languageNames,
	locales,
	localizePath,
	type Locale,
} from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { useSite } from "../../features/site/context";
import { useNavigation } from "./navigation-guard";
import { Icon } from "../ui/icon";
import { sellerShellCopy } from "../../lib/i18n/seller-shell";

const themeOptions = [
	{ value: "system", icon: "monitor" as const },
	{ value: "light", icon: "sun" as const },
	{ value: "dark", icon: "moon" as const },
];

export function Preferences({
	locale,
	compact = false,
}: {
	locale: Locale;
	compact?: boolean;
}) {
	const t = messages[locale],
		path = usePathname(),
		navigate = useNavigation();
	const site = useSite();
	const groupId = useId();
	const [theme, setTheme] = useState<string>(site?.default_theme ?? "system");
	useEffect(() => {
		try {
			const value = localStorage.getItem("rezayi-theme");
			if (value && ["light", "dark", "system"].includes(value)) setTheme(value);
		} catch {}
	}, []);
	useEffect(() => {
		if (!compact) return;
		const root = document.documentElement;
		const sync = () => setTheme(root.dataset.theme ?? "system");
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, [compact]);

	function changeLocale(next: Locale) {
		if (next === locale) return;
		const href =
			localizePath(path, next) + location.search + location.hash;
		navigate(() => {
			// biome-ignore lint/suspicious/noDocumentCookie: supports browsers without Cookie Store API.
			document.cookie = `rezayi-locale=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
			location.assign(href);
		});
	}

	function changeTheme(value: string) {
		setTheme(value);
		document.documentElement.dataset.theme = value;
		try {
			localStorage.setItem("rezayi-theme", value);
		} catch {}
	}

	if (compact) {
		return (
			<div className="flex items-center gap-2">
				<details className="group relative">
					<summary
						className="flex h-9 min-w-20 list-none cursor-pointer items-center justify-center gap-1.5 rounded-control border border-border bg-surface px-2 text-caption font-medium text-muted hover:bg-info"
						aria-label={t.language}
					>
						<Icon name="globe" className="size-3.5" />
						<bdi>{sellerShellCopy[locale].localeCode}</bdi>
						<Icon name="chevron-down" className="size-3" />
					</summary>
					<div className="absolute end-0 top-full z-50 mt-1.5 hidden w-40 rounded-xl border border-border bg-surface p-1.5 shadow-lifted group-open:block">
						{locales.map((code) => (
							<button
								key={code}
								type="button"
								lang={code}
								dir={code === "en" ? "ltr" : "rtl"}
								onClick={() => changeLocale(code)}
								className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors ${
									code === locale
										? "bg-action text-on-primary font-bold"
										: "text-foreground hover:bg-info"
								}`}
							>
								{languageNames[code]}
							</button>
						))}
					</div>
				</details>
				<details className="group relative">
					<summary
						className="flex h-9 w-9 list-none cursor-pointer items-center justify-center rounded-control border border-border bg-surface text-muted hover:bg-info"
						aria-label={`${t.theme}: ${theme === "dark" ? t.dark : theme === "light" ? t.light : t.system}`}
					>
						<Icon
							name={theme === "dark" ? "moon" : "sun"}
							className="size-4"
						/>
					</summary>
					<div className="absolute end-0 top-full z-50 mt-1.5 hidden rounded-xl border border-border bg-surface p-1.5 shadow-lifted group-open:block">
						{themeOptions.map(({ value, icon }) => (
							<button
								key={value}
								type="button"
								onClick={() => changeTheme(value)}
								className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
									value === theme
										? "bg-action text-on-primary font-bold"
										: "text-foreground hover:bg-info"
								}`}
							>
								<Icon name={icon} className="size-4" />
								{t[value as "system" | "light" | "dark"]}
							</button>
						))}
					</div>
				</details>
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="space-y-2.5">
				<p className="text-[0.7rem] font-semibold text-muted">
					{t.language}
				</p>
				<div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t.language}>
					{locales.map((code) => {
						const active = code === locale;
						return (
							<label
								key={code}
								lang={code}
								dir={code === "en" ? "ltr" : "rtl"}
								className={`relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-all focus-within:ring-2 focus-within:ring-action ${
									active
										? "bg-action text-on-primary shadow-sm"
										: "border border-border/70 bg-surface text-foreground hover:border-action/30 hover:bg-info"
								}`}
							>
								<input type="radio" name={`${groupId}-language`} value={code} checked={active} onChange={() => changeLocale(code)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
								{active && <Icon name="check" className="size-3.5" />}
								<span className={active ? "" : "ms-1"}>
									{languageNames[code]}
								</span>
							</label>
						);
					})}
				</div>
			</div>
			<div className="h-px bg-border/50" />
			<div className="space-y-2.5">
				<p className="text-[0.7rem] font-semibold text-muted">
					{t.theme}
				</p>
				<div
					className="flex w-full items-center justify-between"
					role="radiogroup"
					aria-label={t.theme}
				>
					{themeOptions.map(({ value, icon }) => {
						const active = value === theme;
						return (
							<label
								key={value}
								className={`relative flex size-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-300 focus-within:ring-2 focus-within:ring-action ${
									active
										? "bg-action text-on-primary shadow-sm"
										: "text-muted hover:bg-info hover:text-foreground"
								}`}
							>
								<input type="radio" name={`${groupId}-theme`} value={value} checked={active} aria-label={t[value as "system" | "light" | "dark"]} onChange={() => changeTheme(value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
								<Icon name={icon} className="size-[1.1rem]" />
							</label>
						);
					})}
				</div>
			</div>
		</div>
	);
}
