"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { communicationCopy } from "../copy";
export const control =
	"min-h-11 w-full min-w-0 rounded-control border border-border bg-page px-3 py-2 text-foreground disabled:opacity-60";
const buttonBase =
	"inline-flex min-h-11 items-center justify-center rounded-control border border-border px-4 py-2 font-bold disabled:opacity-60";
export const action = `${buttonBase} bg-surface hover:bg-info`;
export const primaryAction = `${buttonBase} bg-primary text-on-primary hover:brightness-95`;
export function Failure({ locale, error }: { locale: Locale; error: unknown }) {
	const t = communicationCopy[locale];
	const message =
		error instanceof AccountError
			? error.status === 404
				? t.denied
				: [401, 403].includes(error.status ?? 0)
					? t.expired
					: error.status === 400
						? t.invalid
						: error.status === 409
							? t.conflict
							: error.status === 429
								? t.throttled
								: t.failed
			: t.failed;
	return (
		<p
			role="alert"
			className="rounded-control border border-danger p-3 text-danger"
		>
			{message}
		</p>
	);
}
