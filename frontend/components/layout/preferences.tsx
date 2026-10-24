"use client";
import { useEffect, useState } from "react";
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
export function Preferences({ locale }: { locale: Locale }) {
	const t = messages[locale],
		path = usePathname(),
		navigate = useNavigation();
	const site = useSite();
	const [theme, setTheme] = useState<string>(site?.default_theme ?? "system");
	useEffect(() => {
		try {
			const value = localStorage.getItem("rezayi-theme");
			if (value && ["light", "dark", "system"].includes(value)) setTheme(value);
		} catch {}
	}, []);
	return (
		<div className="preferences flex min-w-0 flex-wrap items-center gap-2 text-sm">
			<label className="min-w-0 max-w-full">
				<span className="sr-only">{t.language}</span>
				<select
					className="min-h-11 max-w-full rounded-control border border-border bg-surface px-2 text-foreground"
					aria-label={t.language}
					value={locale}
					onChange={(event) => {
						const href =
							localizePath(path, event.target.value as Locale) +
							location.search +
							location.hash;
						navigate(() => {
							// biome-ignore lint/suspicious/noDocumentCookie: supports browsers without Cookie Store API.
							document.cookie = `rezayi-locale=${event.target.value}; Path=/; SameSite=Lax; Max-Age=31536000`;
							location.assign(href);
						});
					}}
				>
					{locales.map((value) => (
						<option key={value} value={value} lang={value}>
							{languageNames[value]}
						</option>
					))}
				</select>
			</label>
			<label className="min-w-0 max-w-full">
				<span className="sr-only">{t.theme}</span>
				<select
					className="min-h-11 max-w-full rounded-control border border-border bg-surface px-2 text-foreground"
					aria-label={t.theme}
					value={theme}
					onChange={(event) => {
						const value = event.target.value;
						setTheme(value);
						document.documentElement.dataset.theme = value;
						try {
							localStorage.setItem("rezayi-theme", value);
						} catch {}
					}}
				>
					<option value="system">{t.system}</option>
					<option value="light">{t.light}</option>
					<option value="dark">{t.dark}</option>
				</select>
			</label>
		</div>
	);
}
