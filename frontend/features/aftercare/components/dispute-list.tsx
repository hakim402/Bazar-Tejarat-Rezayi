"use client";
import Link from "next/link";
import { useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { accessLost, useOnlineState, useVisiblePoll } from "../../messaging/hooks";
import { localTimestamp } from "../../messaging/api";
import { action, panel } from "../../orders/components/controls";
import { salesAction, salesPanel } from "../../sales/components/seller-sales-ui";
import { aftercare, aftercareHref, disputeHref } from "../api";
import { aftercareCopy, aftercareState } from "../copy";
import type { Context, DisputeRow, Page } from "../types";

export function DisputeList({ locale, context, seller, page }: { locale: Locale; context: Context; seller: string; page: number }) {
	const t = aftercareCopy[locale], online = useOnlineState();
	const [data, setData] = useState<Page<DisputeRow> | null>(null), [error, setError] = useState(false), [denied, setDenied] = useState(false), [revision, setRevision] = useState(0);
	const button = context === "seller" ? salesAction : action;
	useVisiblePoll(async (signal) => {
		try {
			const query = new URLSearchParams({ page: String(page) });
			if (context === "seller" && seller) query.set("seller", seller);
			const result = await aftercare<Page<DisputeRow>>("orders", context, `disputes/?${query}`, undefined, signal);
			if (signal.aborted) return;
			setData(result); setError(false);
		} catch (error) {
			if (signal.aborted) return;
			setError(true);
			if (accessLost(error)) { setData(null); setDenied(true); }
			throw error;
		}
	}, [context, seller, page, revision, denied], !denied);
	if (denied) return <p role="alert">{t.noAccess}</p>;
	return <div className="min-w-0 space-y-5">
		<h1 className="text-2xl font-bold">{t.disputes}</h1>
		<p>{t.disputeNote}</p>
		<Link className={button} prefetch={false} href={aftercareHref(locale, context, undefined, seller)}>{t.openWorkspace}</Link>
		{!online && <p role="status">{t.offline}</p>}
		{error && <p role="alert">{t.error}</p>}
		<button className={button} type="button" disabled={!online} onClick={() => setRevision((value) => value + 1)}>{t.refresh}</button>
		{!data && !error ? <p role="status">{t.loading}</p> : data && <>
			{data.results.length ? <ul className="space-y-3">{data.results.map((row) => <li key={row.id} className={context === "seller" ? salesPanel : panel}>
				<Link prefetch={false} href={disputeHref(locale, context, row.id, seller)} className="block min-h-11 font-semibold text-action"><bdi>{row.number}</bdi> · {aftercareState(locale, row.state)}</Link>
				<p dir="auto" className="whitespace-pre-wrap break-words">{row.reason}</p>
				<p className="text-sm text-muted"><bdi>{localTimestamp(row.created_at, locale)}</bdi> · <bdi>{row.id}</bdi></p>
			</li>)}</ul> : <p>{t.disputeEmpty}</p>}
			<nav className="flex flex-wrap items-center gap-3" aria-label={t.disputes}>
				{page > 1 && <Link className={button} prefetch={false} href={disputeHref(locale, context, undefined, seller, page - 1)}>{t.previous}</Link>}
				<bdi>{page} · {data.count}</bdi>
				{page * 20 < data.count && <Link className={button} prefetch={false} href={disputeHref(locale, context, undefined, seller, page + 1)}>{t.next}</Link>}
			</nav>
		</>}
	</div>;
}
