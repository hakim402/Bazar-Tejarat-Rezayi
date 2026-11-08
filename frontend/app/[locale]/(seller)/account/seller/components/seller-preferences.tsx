"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useNavigation } from "../../../../../../components/layout/navigation-guard";
import { useSite } from "../../../../../../features/site/context";
import {
	languageNames,
	locales,
	localizePath,
	type Locale,
} from "../../../../../../lib/i18n/locales";
import { messages } from "../../../../../../lib/i18n/messages";
import { SellerSelect } from "./seller-select";

export function SellerPreferences({
	locale,
	drawer = false,
}: {
	locale: Locale;
	drawer?: boolean;
}) {
	const t = messages[locale];
	const path = usePathname();
	const navigate = useNavigation();
	const site = useSite();
	const [theme, setTheme] = useState<string>(site?.default_theme ?? "system");

	useEffect(() => {
		const root = document.documentElement;
		const sync = () => setTheme(root.dataset.theme ?? "system");
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, []);

	return (
		<div
			className={`flex min-w-0 items-center gap-2 ${drawer ? "" : "sm:max-xl:[&_[role=combobox]]:w-11 sm:max-xl:[&_[role=combobox]]:px-0 sm:max-xl:[&_[role=combobox]>span]:sr-only sm:max-xl:[&_[role=combobox]>svg:last-child]:hidden"}`}
		>
			<SellerSelect
				label={t.language}
				value={locale}
				icon="globe"
				compact
				side={drawer ? "top" : "bottom"}
				options={locales.map((value) => ({
					value,
					label: languageNames[value],
					lang: value,
				}))}
				onChange={(value) => {
					const href =
						localizePath(path, value as Locale) +
						location.search +
						location.hash;
					navigate(() => {
						// biome-ignore lint/suspicious/noDocumentCookie: matches the existing locale preference contract.
						document.cookie = `rezayi-locale=${value}; Path=/; SameSite=Lax; Max-Age=31536000`;
						location.assign(href);
					});
				}}
			/>
			<SellerSelect
				label={t.theme}
				value={theme}
				icon={theme === "dark" ? "moon" : "sun"}
				compact
				side={drawer ? "top" : "bottom"}
				options={[
					{ value: "system", label: t.system },
					{ value: "light", label: t.light },
					{ value: "dark", label: t.dark },
				]}
				onChange={(value) => {
					document.documentElement.dataset.theme = value;
					try {
						localStorage.setItem("rezayi-theme", value);
					} catch {}
				}}
			/>
		</div>
	);
}
