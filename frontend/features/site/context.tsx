"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { siteCopy } from "../../lib/i18n/site";
import type { Site } from "./contract";
const Context = createContext<Site | null>(null);
export function SiteProvider({
	site,
	children,
}: {
	site: Site;
	children: ReactNode;
}) {
	return <Context.Provider value={site}>{children}</Context.Provider>;
}
export const useSite = () => useContext(Context);
export function SiteTagline({ locale }: { locale: Locale }) {
	const identity = useSite()?.identity;
	if (!identity?.tagline && !identity?.fallback) return null;
	return (
		<span className="mt-2 block max-w-xs text-sm text-muted">
			<span
				lang={identity.content_locale}
				dir={direction(identity.content_locale)}
			>
				{identity.tagline}
			</span>
			{identity.fallback && (
				<span className="mt-1 block" lang={locale} dir={direction(locale)}>
					{siteCopy[locale].fallback}
				</span>
			)}
		</span>
	);
}
