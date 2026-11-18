"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { Download, Eye, Printer } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { Icon } from "../../../components/ui/icon";
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
import { localTimestamp } from "../../messaging/api";
import { apiOrigin } from "../../../lib/api/client";
import { useCommunicationSession } from "../../messaging/hooks";
import { commerce, downloadInvoice, invoiceHref, type Order } from "../api";
import { commerceCopy } from "../copy";
import { orderListCopy } from "../list-copy";
import { orderViewCopy } from "../view-copy";
import { DetailField, Money } from "./order-ui";
import { Failure, panel } from "./controls";
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
		[error, setError] = useState<unknown>(),
		[downloading, setDownloading] = useState(false),
		download = useRef<AbortController | null>(null);
	useEffect(() => () => download.current?.abort(), []);
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
	const t = commerceCopy[locale],
		ol = orderListCopy[locale],
		v = orderViewCopy[locale],
		printUrl = `${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/orders/${context}/invoices/${id}/print/?locale=${locale}`;
	async function pdf() {
		if (downloading) return;
		const controller = new AbortController();
		download.current = controller;
		setDownloading(true);
		try {
			await downloadInvoice(context, id, locale, controller.signal);
			if (!controller.signal.aborted) toast.success(ol.downloaded);
		} catch {
			if (!controller.signal.aborted) toast.error(ol.downloadError);
		} finally {
			if (download.current === controller) {
				download.current = null;
				setDownloading(false);
			}
		}
	}
	return (
		<section className="flex min-w-0 flex-col gap-4">
			<header className="min-w-0">
				<Link
					href={invoiceHref(locale, context, id)}
					className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
				>
					<Icon name="arrow" className="size-4 ltr:rotate-180" />
					{v.invoiceLabel}
				</Link>
				<h1 className="m-0 text-2xl font-bold">
					{t.print}
					{record && (
						<>
							{" "}
							· <bdi>{record.number}</bdi>
						</>
					)}
				</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.printHelp}</p>
			</header>
			<Failure locale={locale} error={error} />
			{!ready && !error ? (
				<div className={`${panel} min-h-40`} role="status">
					<p className="m-0 text-sm text-muted">{t.loading}</p>
				</div>
			) : record ? (
				<div className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-none sm:p-5">
					<dl className="m-0 grid gap-3 sm:grid-cols-2">
						<DetailField label={v.invoiceNumber}>
							<bdi>{record.number}</bdi>
						</DetailField>
						<DetailField label={t.issued}>
							<bdi>{localTimestamp(record.issued_at, locale)}</bdi>
						</DetailField>
						<DetailField label={t.goods}>
							<Money
								amount={record.goods_total}
								currency={record.currency}
								className="font-semibold"
							/>
						</DetailField>
					</dl>
					<div className="flex flex-wrap gap-2">
						<Button asChild className="rounded-lg">
							<a target="_blank" rel="noreferrer" href={printUrl}>
								<Printer className="size-3.5" />
								{t.print}
							</a>
						</Button>
						<Button
							type="button"
							variant="outline"
							className="rounded-lg"
							disabled={downloading}
							onClick={() => void pdf()}
						>
							<Download className="size-3.5" />
							{t.pdf}
						</Button>
						<Button asChild variant="outline" className="rounded-lg">
							<Link href={invoiceHref(locale, context, id)}>
								<Eye className="size-3.5" />
								{ol.invoice}
							</Link>
						</Button>
					</div>
				</div>
			) : null}
		</section>
	);
}
