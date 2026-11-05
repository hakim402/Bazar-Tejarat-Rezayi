"use client";
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
import { useCommerceGuard } from "../../orders/components/unsaved";
import { action, panel } from "../../orders/components/controls";
import { fulfilment, fulfilmentHref, clearFulfilmentIntents } from "../api";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import { useFulfilmentCommand } from "../use-command";
import type { Context, Detail, Reviewed } from "../types";
import { DeliverySummary } from "./summary";
import { DeliveryActionForm } from "./action-form";
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
		online = useOnlineState();
	const [row, setRow] = useState<Detail | null>(null),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[reload, setReload] = useState(0),
		[dirty, setDirty] = useState(false),
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
	const opener = useRef<HTMLElement | null>(null),
		guard = useCommerceGuard(locale, dirty);
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
		onDenied: deny,
		onApplied: (intent, result, current) => {
			setReview(null);
			setError(false);
			if (intent?.upload && typeof result.id === "string")
				setUploaded({ id: result.id, purpose: String(result.purpose) });
			else if (intent) {
				setFormGeneration((value) => value + 1);
				setDirty(false);
				setUploaded(null);
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
			(row?.completion !== "completed" ||
				row.cases.some((item) => item.state === "open")),
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
		if (review && row && !row.capabilities[review.capability]) setReview(null);
	}, [review, row]);
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
		return (
			<p role={error ? "alert" : "status"}>{error ? t.error : t.loading}</p>
		);
	return (
		<div className="min-w-0 space-y-5">
			{guard.feedback}
			<Link
				href={fulfilmentHref(locale, context, undefined, seller)}
				className={action}
			>
				{context === "buyer" ? t.buyerTitle : t.sellerTitle}
			</Link>
			<DeliverySummary {...{ locale, row }} />
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
			{row.capabilities.invoice && (
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
				onDirty={setDirty}
				onDenied={deny}
				review={(next, focus) => {
					opener.current = focus;
					setReview(next);
				}}
				upload={(file, purpose) => {
					const key = crypto.randomUUID(),
						body = new FormData();
					body.set("command_id", key);
					body.set("purpose", purpose);
					body.set("file", file);
					void command.send({ key, path: "uploads/", body, upload: true });
				}}
			/>
			<DeliveryHistory {...{ locale, context, row, seller, page }} />
			{review && row.capabilities[review.capability] && (
				<DeliveryReview
					{...{ locale, context, review, row }}
					busy={command.locked}
					opener={opener.current}
					cancel={() => {
						setReview(null);
					}}
					confirm={() => {
						if (command.locked) return;
						void command.send(review.intent).then(() => setReview(null));
					}}
				/>
			)}
		</div>
	);
}
