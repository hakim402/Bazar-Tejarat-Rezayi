"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
	languageNames,
	locales,
	localizePath,
	type Locale,
} from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
export function Preferences({ locale }: { locale: Locale }) {
	const t = messages[locale];
	const path = usePathname();
	const [theme, setTheme] = useState("system");
	useEffect(() => {
		try {
			const value = localStorage.getItem("rezayi-theme");
			if (value && ["light", "dark", "system"].includes(value)) setTheme(value);
		} catch {}
	}, []);
	function changeTheme(value: string) {
		setTheme(value);
		document.documentElement.dataset.theme = value;
		try {
			localStorage.setItem("rezayi-theme", value);
		} catch {}
	}
	return (
		<div className="preferences">
			<label>
				{t.language}
				<select
					aria-label={t.language}
					value={locale}
					onChange={(event) =>
						window.location.assign(
							localizePath(path, event.target.value as Locale) +
								window.location.search +
								window.location.hash,
						)
					}
				>
					{locales.map((value) => (
						<option key={value} value={value} lang={value}>
							{languageNames[value]}
						</option>
					))}
				</select>
			</label>
			<label>
				{t.theme}
				<select
					aria-label={t.theme}
					value={theme}
					onChange={(event) => changeTheme(event.target.value)}
				>
					<option value="system">{t.system}</option>
					<option value="light">{t.light}</option>
					<option value="dark">{t.dark}</option>
				</select>
			</label>
		</div>
	);
}
