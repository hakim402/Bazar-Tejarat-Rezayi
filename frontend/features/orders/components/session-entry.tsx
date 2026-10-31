"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context } from "../../messaging/api";
import { communicationCopy } from "../../messaging/copy";
import { authHref } from "../../../lib/routes/auth-routes";
import { action, Failure } from "./controls";
export function SessionEntry({
	locale,
	context,
	error,
}: {
	locale: Locale;
	context: Context;
	error: unknown;
}) {
	const path = usePathname(),
		search = useSearchParams();
	return (
		<div className="space-y-4">
			<Failure locale={locale} error={error} />
			<Link
				className={action}
				href={authHref(
					locale,
					`${context}-sign-in`,
					new URLSearchParams({
						return: path + (search.size ? `?${search}` : ""),
					}),
				)}
			>
				{communicationCopy[locale].signIn}
			</Link>
		</div>
	);
}
