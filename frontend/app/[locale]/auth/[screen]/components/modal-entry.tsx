"use client";
import { canonicalReviewUrl } from "../../../../../lib/api/review-origin";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../../../lib/i18n/locales";
import type { AuthScreen } from "../../../../../lib/i18n/auth-screens";
/** Compatibility entry only: public credentials are rendered exclusively by the shared modal. */
export function ModalEntry({
	locale,
	screen,
}: {
	locale: Locale;
	screen: AuthScreen;
}) {
	const router = useRouter(),
		search = useSearchParams();
	useEffect(() => {
		if (
			canonicalReviewUrl(
				window.location.href,
				window.location.host,
				process.env.NEXT_PUBLIC_API_URL,
			)
		)
			return;
		const url = new URL(window.location.href);
		const seller =
			screen.startsWith("seller") || search.get("context") === "seller";
		url.pathname = `/${locale}${seller ? "/sell" : ""}`;
		url.searchParams.set("auth", screen);
		router.replace(url.pathname + url.search + url.hash);
	}, [locale, screen, search, router]);
	return null;
}
