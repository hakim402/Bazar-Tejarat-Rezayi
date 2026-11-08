"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
	SalesFrame,
	SalesHeader,
	salesHref,
	salesAction,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
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
		search = useSearchParams(),
		[record, setRecord] = useState<Order>(),
		[ready, setReady] = useState(false),
		[error, setError] = useState<unknown>();
	useEffect(() => {
		setReady(false);
		setRecord(undefined);
		setError(undefined);
		if (!s.session) return;
		const c = new AbortController();
		void commerce<Order>(
			`orders/${context}/invoices/${id}/?locale=${locale}`,
			undefined,
			"GET",
			c.signal,
		)
			.then((value) => {
				if (!c.signal.aborted) {
					setReady(true);
					setRecord(value);
				}
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
	if (context === "seller") {
		const t = sellerSalesCopy[locale],
			seller = record?.seller ?? search.get("seller") ?? "";
		return (
			<SalesFrame seller>
				<SalesHeader
					locale={locale}
					section="invoices"
					seller={seller}
					back={salesHref(locale, "invoices", seller, undefined, search)}
					business={
						record ? (
							<bdi className="font-semibold">{record.snapshot.seller}</bdi>
						) : undefined
					}
				/>
				<section className={salesPanel}>
					<h2 className="text-xl font-semibold">
						{commerceCopy[locale].print}
						{record && (
							<>
								{" "}
								· <bdi>{record.number}</bdi>
							</>
						)}
					</h2>
					<p className="max-w-2xl text-sm leading-relaxed text-muted">
						{t.printHelp}
					</p>
					<Failure locale={locale} error={error} />
					{ready ? (
						<div className="flex flex-wrap gap-3">
							<Link
								className={salesAction}
								href={salesHref(locale, "invoices", seller, id, search)}
							>
								{t.view}
							</Link>
							<a
								className={salesAction}
								target="_blank"
								rel="noreferrer"
								href={`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/orders/${context}/invoices/${id}/print/?locale=${locale}`}
							>
								{commerceCopy[locale].print}
							</a>
						</div>
					) : (
						!error && <p role="status">{commerceCopy[locale].loading}</p>
					)}
				</section>
			</SalesFrame>
		);
	}
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
