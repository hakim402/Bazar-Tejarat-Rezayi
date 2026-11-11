"use client";
import { aftercareHref } from "../../aftercare/api";
import { aftercareCopy } from "../../aftercare/copy";
import Link from "next/link";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { apiOrigin } from "../../../lib/api/client";
import {
	useVisiblePoll,
	accessLost,
	useOnlineState,
} from "../../messaging/hooks";
import {
	action as buyerAction,
	panel as buyerPanel,
} from "../../orders/components/controls";
import { useSearchParams } from "next/navigation";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import {
	SalesFrame,
	SalesHeader,
	SalesRelated,
	salesHref,
	salesAction,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { fulfilment, fulfilmentHref, clearFulfilmentIntents } from "../api";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import { workflowCopy } from "../workflow-copy";
import { useFulfilmentCommand } from "../use-command";
import toast from "react-hot-toast";
import type { Context, Detail, Reviewed } from "../types";
import { DeliverySummary } from "./summary";
import { DeliveryActionForm } from "./action-form";
import { SellerFulfilment } from "./seller-workflow";
import { DeliveryReview } from "./review";
import { DeliveryHistory } from "./history";
import { paymentHref } from "../../payments/api";
export function DeliveryDetail({
	locale,
	context,
	id,
	seller,
	page,
	scope,
	attempt,
}: {
	locale: Locale;
	context: Context;
	id: string;
	seller: string;
	page: number;
	scope: string;
	attempt: string | null;
}) {
	const t = fulfilmentCopy[locale],
		s = sellerSalesCopy[locale],
		isSeller = context === "seller",
		action = isSeller ? salesAction : buyerAction,
		panel = isSeller ? salesPanel : buyerPanel,
		params = useSearchParams(),
		back = isSeller
			? salesHref(locale, "fulfilment", seller, undefined, {
					get: (key) => (key.startsWith("list_") ? params.get(key) : null),
				})
			: fulfilmentHref(locale, context, undefined, seller),
		online = useOnlineState();
	const [row, setRow] = useState<Detail | null>(null),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[reload, setReload] = useState(0),
		[loadedRevision, setLoadedRevision] = useState(-1),
		[formGeneration, setFormGeneration] = useState(0),
		[uploaded, setUploaded] = useState<{ id: string; purpose: string } | null>(
			null,
		),
		[review, setReview] = useState<Reviewed | null>(null),
		[downloading, setDownloading] = useState(false);
	const live = useRef(true),
		downloadController = useRef<AbortController | null>(null);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
			downloadController.current?.abort();
		};
	}, []);
	const opener = useRef<HTMLElement | null>(null);
	const deny = useCallback(() => {
		clearFulfilmentIntents();
		setDenied(true);
		setRow(null);
		setReview(null);
		setUploaded(null);
	}, []);
	const command = useFulfilmentCommand({
		scope,
		context,
		id,
		attempt,
		refundAllowed: denied
			? false
			: row
				? context === "seller" && row.capabilities.refund
				: undefined,
		onDenied: deny,
		onApplied: (intent, result, current) => {
			setReview(null);
			setError(false);
			if (intent?.upload && typeof result.id === "string")
				setUploaded({ id: result.id, purpose: String(result.purpose) });
			else if (intent) {
				setFormGeneration((value) => value + 1);
				setUploaded(null);
				if (isSeller) toast.success(workflowCopy[locale].applied);
			}
			if (current) setRow(current);
			setReload((value) => value + 1);
		},
	});
	useVisiblePoll(
		async (signal) => {
			if (denied) return;
			try {
				const data = await fulfilment<Detail>(
					context,
					`orders/${id}/?page=${page}${seller ? `&seller=${seller}` : ""}`,
					undefined,
					signal,
				);
				if (signal.aborted) return;
				setRow(data);
				setLoadedRevision(reload);
				setError(false);
			} catch (error) {
				if (signal.aborted) return;
				if (accessLost(error)) deny();
				else setError(true);
				throw error;
			}
		},
		[context, id, seller, page, reload, denied],
		!denied &&
			(loadedRevision !== reload ||
				command.busy ||
				!!command.reference ||
				error ||
				row?.completion !== "completed" ||
				row.cases.some((item) => item.state === "open") ||
				row.delivery_refunds.some((item) => item.state === "pending")),
	);
	useLayoutEffect(() => {
		const target = opener.current;
		if (
			!review &&
			target &&
			(!target.isConnected || ("disabled" in target && target.disabled))
		)
			(command.busy
				? document.querySelector<HTMLElement>("[data-fulfilment-pending]")
				: (document.querySelector<HTMLElement>("[data-fulfilment-actions]") ??
					document.querySelector<HTMLElement>("[data-fulfilment-summary]"))
			)?.focus();
	}, [review, command.busy]);
	useLayoutEffect(() => {
		if (
			review &&
			row &&
			(!row.capabilities[review.capability] ||
				(review.capability === "refund" && context !== "seller"))
		)
			setReview(null);
		if (
			uploaded?.purpose === "refund" &&
			(!row?.capabilities.refund || context !== "seller")
		)
			setUploaded(null);
	}, [review, row, uploaded, context]);
	async function handover(kind: "html" | "pdf") {
		if (downloading) return;
		const controller = new AbortController();
		downloadController.current = controller;
		setDownloading(true);
		try {
			const response = await fetch(
				`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/fulfilment/${context}/orders/${id}/handover/?locale=${locale}&format=${kind}`,
				{
					credentials: "include",
					cache: "no-store",
					signal: controller.signal,
				},
			);
			if (!response.ok) {
				if ([401, 403, 404].includes(response.status)) deny();
				throw Error();
			}
			if (!live.current || controller.signal.aborted) return;
			const blob = await response.blob();
			if (!live.current || controller.signal.aborted) return;
			const url = URL.createObjectURL(blob),
				a = document.createElement("a");
			a.href = url;
			a.download = `recipient-handover.${kind}`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 60000);
		} catch {
			if (live.current && !controller.signal.aborted) setError(true);
		} finally {
			if (live.current) setDownloading(false);
		}
	}
	if (denied) return <p role="alert">{t.noAccess}</p>;
	if (!row)
		return isSeller ? (
			<SalesFrame seller>
				<SalesHeader
					locale={locale}
					section="fulfilment"
					seller={seller}
					back={back}
				/>
				<p role={error ? "alert" : "status"}>{error ? t.error : t.loading}</p>
			</SalesFrame>
		) : (
			<p role={error ? "alert" : "status"}>{error ? t.error : t.loading}</p>
		);
	if (isSeller)
		return (
			<SalesFrame seller>
				<SellerFulfilment
					locale={locale}
					row={row}
					seller={seller}
					page={page}
					params={params}
					command={command}
					review={review}
					setReview={setReview}
					uploaded={uploaded}
					formGeneration={formGeneration}
					deny={deny}
					handover={handover}
					downloading={downloading}
					online={online}
					error={error}
					opener={opener}
				/>
			</SalesFrame>
		);
	return (
		<SalesFrame seller={isSeller}>
			<div className="min-w-0 space-y-5">
				{isSeller ? (
					<SalesHeader
						locale={locale}
						section="fulfilment"
						seller={row.seller}
						back={back}
						title={
							<>
								{s.fulfilment} · <bdi>{row.number}</bdi>
							</>
						}
					/>
				) : (
					<Link href={back} className={action}>
						{t.buyerTitle}
					</Link>
				)}
				<DeliverySummary {...{ locale, row }} seller={isSeller} />
				{isSeller && row.capabilities.invoice && (
					<SalesRelated
						locale={locale}
						seller={row.seller}
						links={[
							{ section: "orders", id: row.id },
							...(row.invoice
								? [{ section: "invoices" as const, id: row.invoice }]
								: []),
							{ section: "payments", id: row.id },
							{ section: "aftercare", id: row.id },
						]}
					/>
				)}
				{!isSeller && row.capabilities.invoice && (
					<Link
						className={action}
						prefetch={false}
						href={aftercareHref(locale, context, row.id, row.seller)}
					>
						{aftercareCopy[locale].openWorkspace}
					</Link>
				)}
				{!online && <p role="status">{t.offline}</p>}
				{(error || Boolean(command.error)) && <p role="alert">{t.error}</p>}
				{command.absent && <p role="status">{t.absent}</p>}
				{command.locked && (
					<section
						className={panel}
						role="status"
						tabIndex={-1}
						data-fulfilment-pending
					>
						<p>{t.uncertain}</p>
						<button
							type="button"
							className={action}
							disabled={command.busy || !online}
							onClick={() => void command.reconcile()}
						>
							{t.reconcile}
						</button>
					</section>
				)}
				{isSeller && (row.recipient || row.arrangement) && (
					<h2 className="text-lg font-semibold">{s.details}</h2>
				)}
				{row.recipient && (
					<section className={panel}>
						<h2 className="text-xl font-bold">
							{t.recipient} · {t.revision} <bdi>{row.recipient.revision}</bdi>
						</h2>
						<p>{t.privacy}</p>
						<p dir="auto">{row.recipient.name}</p>
						<p>
							<bdi>{row.recipient.phone}</bdi>
						</p>
						<p className="break-words whitespace-pre-wrap">
							{row.recipient.address}
						</p>
						<p className="break-words whitespace-pre-wrap">
							{row.recipient.instructions}
						</p>
						<p>{t.unchangedDestination}</p>
					</section>
				)}
				{row.arrangement && (
					<section className={panel}>
						<h2 className="text-xl font-bold">{t.arrangement}</h2>
						<p>
							{t.arranger}: {fulfilmentState(locale, row.arrangement.arranger)}
						</p>
						<p>
							{t.provider}: <bdi>{row.arrangement.provider}</bdi>
						</p>
						<p>{row.arrangement.instructions}</p>
						{row.preparation && (
							<p>
								{t.preparedFor}: <bdi>{row.preparation.recipient_revision}</bdi>
							</p>
						)}
						{row.stage === "needs_preparation" && (
							<p role="status">{t.needPreparation}</p>
						)}
						{row.stage === "dispatched" || row.stage === "delivered" ? (
							<p>{t.providerFrozen}</p>
						) : null}
					</section>
				)}
				{row.capabilities.handover &&
					(row.stage === "dispatched" || row.stage === "delivered") && (
						<div className="flex flex-wrap gap-3">
							<button
								type="button"
								className={action}
								disabled={downloading}
								onClick={() => void handover("html")}
							>
								{t.handover}
							</button>
							<button
								type="button"
								className={action}
								disabled={downloading}
								onClick={() => void handover("pdf")}
							>
								{t.handoverPdf}
							</button>
						</div>
					)}
				{!isSeller && row.capabilities.invoice && (
					<Link
						className={action}
						href={paymentHref(locale, context, row.id, seller)}
					>
						{t.title}
					</Link>
				)}
				<DeliveryActionForm
					key={`${formGeneration}:${JSON.stringify(row.capabilities)}`}
					{...{ locale, context, row, uploaded }}
					locked={command.locked || !online}
					onDenied={deny}
					review={(next, focus) => {
						opener.current = focus;
						setReview(next);
					}}
					upload={(file, purpose) => {
						if (
							purpose === "refund" &&
							(context !== "seller" || !row.capabilities.refund)
						)
							return;
						const key = crypto.randomUUID(),
							body = new FormData();
						body.set("command_id", key);
						body.set("purpose", purpose);
						body.set("file", file);
						void command.send({ key, path: "uploads/", body, upload: true });
					}}
				/>
				<DeliveryHistory
					{...{ locale, context, row, seller, page }}
					returnParams={isSeller ? params : undefined}
				/>
				{review &&
					row.capabilities[review.capability] &&
					(review.capability !== "refund" || context === "seller") && (
						<DeliveryReview
							{...{ locale, context, review, row }}
							busy={command.locked}
							opener={opener.current}
							cancel={() => {
								setReview(null);
							}}
							confirm={() => {
								if (
									command.locked ||
									!row.capabilities[review.capability] ||
									(review.capability === "refund" && context !== "seller")
								)
									return;
								void command.send(review.intent).then(() => setReview(null));
							}}
						/>
					)}
			</div>
		</SalesFrame>
	);
}
