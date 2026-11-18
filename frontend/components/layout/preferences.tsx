"use client";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
	languageNames,
	locales,
	localizePath,
	type Locale,
} from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { useSite } from "../../features/site/context";
import { storefrontCopy } from "../../features/storefront/copy";
import { useNavigation } from "./navigation-guard";
import { Icon } from "../ui/icon";

const themeOptions = [
	{ value: "system", icon: "monitor" as const },
	{ value: "light", icon: "sun" as const },
	{ value: "dark", icon: "moon" as const },
];

export function Preferences({ locale }: { locale: Locale }) {
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

	function changeLocale(next: Locale, returnFocus?: HTMLElement) {
		if (next === locale) return;
		const href = localizePath(path, next) + location.search + location.hash;
		navigate(() => {
			// biome-ignore lint/suspicious/noDocumentCookie: supports browsers without Cookie Store API.
			document.cookie = `rezayi-locale=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
			location.assign(href);
		}, returnFocus);
	}

	function changeTheme(value: string) {
		setTheme(value);
		document.documentElement.dataset.theme = value;
		try {
			localStorage.setItem("rezayi-theme", value);
		} catch {}
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="space-y-2.5">
				<p className="text-[0.7rem] font-semibold text-muted">{t.language}</p>
				<div
					className="grid grid-cols-2 gap-1.5"
					role="radiogroup"
					aria-label={t.language}
				>
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
								<input
									type="radio"
									name={`${groupId}-language`}
									value={code}
									checked={active}
									onChange={(event) => changeLocale(code, event.currentTarget)}
									className="absolute inset-0 size-full cursor-pointer opacity-0"
								/>
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
				<p className="text-[0.7rem] font-semibold text-muted">{t.theme}</p>
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
								<input
									type="radio"
									name={`${groupId}-theme`}
									value={value}
									checked={active}
									aria-label={t[value as "system" | "light" | "dark"]}
									onChange={() => changeTheme(value)}
									className="absolute inset-0 size-full cursor-pointer opacity-0"
								/>
								<Icon name={icon} className="size-[1.1rem]" />
							</label>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// The home page globe popover, shared by every shell so locale and theme
// controls exist once for the whole application.
export function PreferencesMenu({ locale }: { locale: Locale }) {
	const t = storefrontCopy[locale];
	const root = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const details = root.current;
		if (!details) return;
		const closeOutside = (event: Event) => {
			if (
				details.open &&
				event.target instanceof Node &&
				!details.contains(event.target)
			)
				details.open = false;
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("focusin", closeOutside);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("focusin", closeOutside);
		};
	}, []);
	return (
		<details
			ref={root}
			className="group/preferences relative"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					if (root.current) root.current.open = false;
					root.current?.querySelector("summary")?.focus();
				}
			}}
		>
			<summary
				aria-label={t.preferences}
				className="flex size-9 list-none items-center justify-center rounded-full text-muted hover:bg-info desktop:size-11 [&::-webkit-details-marker]:hidden"
			>
				<Icon name="globe" />
			</summary>
			<div className="absolute end-0 top-full z-40 mt-3 hidden w-72 max-w-[85vw] rounded-2xl border border-border bg-surface p-5 shadow-card group-open/preferences:block max-[767px]:fixed max-[767px]:inset-x-3 max-[767px]:top-16 max-[767px]:w-auto max-[767px]:max-w-none">
				<div className="mb-4 flex items-center gap-2">
					<span className="flex size-8 items-center justify-center rounded-lg bg-info text-action">
						<Icon name="sliders" className="size-4" />
					</span>
					<p className="text-sm font-bold">{t.preferences}</p>
				</div>
				<Preferences locale={locale} />
			</div>
		</details>
	);
}
