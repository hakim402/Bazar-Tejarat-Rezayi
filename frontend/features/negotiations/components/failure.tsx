"use client";
import { useEffect, useRef } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { negotiationCopy } from "../copy";
export function NegotiationFailure({
	locale,
	error,
}: {
	locale: Locale;
	error: unknown;
}) {
	const ref = useRef<HTMLDivElement>(null),
		t = negotiationCopy[locale];
	useEffect(() => {
		if (error) ref.current?.focus();
	}, [error]);
	if (!error) return null;
	const labels: Record<string, string> = {
		quantity: t.quantity,
		unit_price: t.offer,
		max_quantity: t.maxQuantity,
		max_unit_price: t.maxPrice,
		reason: t.reason,
		note: t.note,
		choice: t.terms,
		city: t.city,
		country: t.country,
		method: t.method,
	};
	const fields =
		error instanceof AccountError
			? [
					...new Set(
						[...error.fields, ...error.violations.map((v) => v.path)].map(
							(p) => labels[p.split(".").at(-1) ?? ""] ?? t.bounds,
						),
					),
				]
			: [t.bounds];
	return (
		<div
			ref={ref}
			role="alert"
			tabIndex={-1}
			className="space-y-2 rounded-control border border-warning p-4 text-warning"
		>
			<p>
				{t.error}
				{error instanceof AccountError && error.status
					? ` (${error.status})`
					: ""}
			</p>
			{fields.map((text) => (
				<p key={text}>{text}</p>
			))}
		</div>
	);
}
