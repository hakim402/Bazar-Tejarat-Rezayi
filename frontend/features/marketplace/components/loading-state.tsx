import { headers } from "next/headers";
import { isLocale, defaultLocale } from "../../../lib/i18n/locales";
import { marketplaceCopy } from "../copy";
export async function LoadingState() {
	const requested = (await headers()).get("x-rezayi-locale"),
		locale = isLocale(requested) ? requested : defaultLocale;
	return (
		<div
			className="mx-auto w-[95%] rounded-card border border-border bg-surface p-5"
			aria-busy="true"
		>
			<p role="status">{marketplaceCopy[locale].loading}</p>
		</div>
	);
}
