"use client";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { apiOrigin } from "../../../lib/api/client";
import { Button } from "../../../components/shadcn/button";
import { Icon } from "../../../components/ui/icon";
import {
	useVisiblePoll,
	accessLost,
	useOnlineState,
} from "../../messaging/hooks";
import { panel as buyerPanel } from "../../orders/components/controls";
import { DetailCard } from "../../orders/components/order-ui";
import { DetailDialog } from "../../orders/components/detail-dialog";
import { useSearchParams } from "next/navigation";
import {
	SalesFrame,
	SalesHeader,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { fulfilment, fulfilmentHref, clearFulfilmentIntents } from "../api";
import { availableModes } from "../modes";
import { fulfilmentCopy } from "../copy";
import { workflowCopy } from "../workflow-copy";
import { useFulfilmentCommand } from "../use-command";
import toast from "react-hot-toast";
import type { Context, Detail, Reviewed } from "../types";
import { DeliveryActionForm } from "./action-form";
import { SellerFulfilment } from "./seller-workflow";
import { DeliveryReview } from "./review";
import {
	BuyerDeliveryHeader,
	BuyerDeliveryProgress,
	BuyerMoneyCard,
	BuyerRecipientCard,
	BuyerArrangementCard,
	BuyerDeliveryHistory,
} from "./buyer-cards";
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
		isSeller = context === "seller",
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
			if (intent?.upload && typeof result.id === "string") {
				setUploaded({ id: result.id, purpose: String(result.purpose) });
				toast.success(workflowCopy[locale].applied);
			} else if (intent) {
				setFormGeneration((value) => value + 1);
				setUploaded(null);
				toast.success(workflowCopy[locale].applied);
			}
			if (current) setRow(current);
			setReload((value) => value + 1);
		},
	});
	useEffect(() => {
		if (command.error) toast.error(t.error);
	}, [command.error, t]);
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
	const actionDialog =
		availableModes(row, context, locale).length > 0 ? (
			<DetailDialog
				locale={locale}
				icon="send"
				label={t.buyerActions}
				title={t.buyerActions}
				wide
				keepMounted
				inline
			>
				<p className="m-0 text-xs leading-relaxed text-muted">
					{t.buyerActionsHelp}
				</p>
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
						if (purpose === "refund" && (!isSeller || !row.capabilities.refund))
							return;
						const key = crypto.randomUUID(),
							body = new FormData();
						body.set("command_id", key);
						body.set("purpose", purpose);
						body.set("file", file);
						void command.send({ key, path: "uploads/", body, upload: true });
					}}
				/>
			</DetailDialog>
		) : null;
	const handoverShown =
		row.capabilities.handover &&
		(row.stage === "dispatched" || row.stage === "delivered");
	const rail = (
		<>
			<BuyerMoneyCard locale={locale} row={row} seller={seller} />
			<BuyerRecipientCard locale={locale} row={row} />
			<BuyerArrangementCard locale={locale} row={row} />
			<BuyerDeliveryHistory
				locale={locale}
				context={context}
				row={row}
				seller={seller}
			/>
		</>
	);
	return (
		<section className="min-w-0 space-y-4">
			<BuyerDeliveryHeader
				locale={locale}
				row={row}
				back={back}
				busy={command.busy}
				onReload={() => setReload((value) => value + 1)}
				actions={actionDialog}
			/>
			<BuyerDeliveryProgress locale={locale} row={row} />
			{!online && (
				<p
					role="status"
					className="m-0 rounded-lg border border-warning bg-warning-surface px-3 py-2 text-sm text-warning"
				>
					{t.offline}
				</p>
			)}
			{(error || Boolean(command.error)) && (
				<p
					role="alert"
					className="m-0 rounded-lg border border-danger bg-danger-surface px-3 py-2 text-sm text-danger"
				>
					{t.error}
				</p>
			)}
			{command.absent && (
				<p
					role="status"
					className="m-0 rounded-lg border border-border bg-page px-3 py-2 text-sm text-muted"
				>
					{t.absent}
				</p>
			)}
			{command.locked && (
				<section
					className={panel}
					role="status"
					tabIndex={-1}
					data-fulfilment-pending
				>
					<p className="m-0 text-sm">{t.uncertain}</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="rounded-lg"
						disabled={command.busy || !online}
						onClick={() => void command.reconcile()}
					>
						{t.reconcile}
					</Button>
				</section>
			)}
			{handoverShown ? (
				<div className="grid items-start gap-4 lg:grid-cols-3">
					<div className="min-w-0 space-y-4 lg:col-span-2">
						<DetailCard title={t.handover} icon="file" compact>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-lg"
									disabled={downloading}
									onClick={() => void handover("html")}
								>
									<Icon name="arrow-down" className="size-3.5" />
									{t.handover}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-lg"
									disabled={downloading}
									onClick={() => void handover("pdf")}
								>
									<Icon name="file" className="size-3.5" />
									{t.handoverPdf}
								</Button>
							</div>
						</DetailCard>
					</div>
					<div className="min-w-0 space-y-4">{rail}</div>
				</div>
			) : (
				<div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{rail}
				</div>
			)}
			{review &&
				row.capabilities[review.capability] &&
				(review.capability !== "refund" || isSeller) && (
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
								(review.capability === "refund" && !isSeller)
							)
								return;
							void command.send(review.intent).then(() => setReview(null));
						}}
					/>
				)}
		</section>
	);
}
