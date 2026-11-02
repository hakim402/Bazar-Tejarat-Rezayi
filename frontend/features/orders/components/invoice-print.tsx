"use client";
import { useEffect, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context } from "../../messaging/api";
import { apiOrigin } from "../../../lib/api/client";
import { useCommunicationSession } from "../../messaging/hooks";
import { commerce, type Order } from "../api";
import { commerceCopy } from "../copy";
import { Failure } from "./controls";
export function InvoicePrint({
	locale,
	context,
	id,
}: {
	locale: Locale;
	context: Context;
	id: string;
}) {
	const s = useCommunicationSession(context),
		[ready, setReady] = useState(false),
		[error, setError] = useState<unknown>();
	useEffect(() => {
		setReady(false);
		setError(undefined);
		if (!s.session) return;
		const c = new AbortController();
		void commerce<Order>(
			`orders/${context}/invoices/${id}/?locale=${locale}`,
			undefined,
			"GET",
			c.signal,
		)
			.then(() => {
				if (!c.signal.aborted) setReady(true);
			})
			.catch((e) => {
				if (!c.signal.aborted) setError(e);
			});
		return () => c.abort();
	}, [context, id, locale, s.session]);
	if (!s.session)
		return s.loading ? (
			<p>{commerceCopy[locale].loading}</p>
		) : (
			<Failure locale={locale} error={s.error} />
		);
	if (error) return <Failure locale={locale} error={error} />;
	return ready ? (
		<a
			className="inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-5 font-bold text-action"
			target="_blank"
			rel="noreferrer"
			href={`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/orders/${context}/invoices/${id}/print/?locale=${locale}`}
		>
			{commerceCopy[locale].print}
		</a>
	) : (
		<p role="status">{commerceCopy[locale].loading}</p>
	);
}
