"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { commerceCopy } from "../copy";
import { AccountError } from "../../../lib/api/private-client";
export { action, control } from "../../messaging/components/controls";
export const panel =
	"space-y-4 rounded-card border border-border bg-surface p-5";
export function Failure({ locale, error }: { locale: Locale; error: unknown }) {
	return error ? (
		<p
			role="alert"
			className="rounded-control border border-border p-3 text-warning"
		>
			{error instanceof AccountError &&
			error.code === "guest_coordination_unavailable"
				? commerceCopy[locale].guestUnavailable
				: error instanceof AccountError && error.code === "invalid_quantity"
					? commerceCopy[locale].quantityInvalid
					: commerceCopy[locale].error}
			{error instanceof AccountError &&
			error.status &&
			!["invalid_quantity", "guest_coordination_unavailable"].includes(
				error.code,
			)
				? ` (${error.status})`
				: ""}
		</p>
	) : null;
}
export function Disclosure({
	locale,
	accepted = false,
}: {
	locale: Locale;
	accepted?: boolean;
}) {
	const t = commerceCopy[locale];
	return (
		<div className="space-y-2 rounded-card bg-info p-4 text-sm">
			<p>{accepted ? t.frozen : t.currentPrice}</p>
			<p>{t.delivery}</p>
			<p>{t.unreserved}</p>
		</div>
	);
}
