import type { ReactNode } from "react";
import type { Locale } from "../lib/i18n/locales";
import { PublicShell } from "./layout/public-shell";
export function Shell({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	return (
		<PublicShell locale={locale} site={null}>
			{children}
		</PublicShell>
	);
}
