"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { ReportForm } from "../../messaging/components/report";
import { useOnlineState } from "../../messaging/hooks";
import {
	action as defaultAction,
	panel as defaultPanel,
} from "../../orders/components/controls";
import {
	SalesFrame,
	SalesHeader,
	SalesRelated,
	salesAction,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { uuidPattern } from "../../../lib/routes/account-routes";
import { aftercareHref, disputeHref } from "../api";
import { aftercareCopy } from "../copy";
import { availableModes, isStale, modeDomain } from "../draft";
import type { Context, Domain, Reviewed } from "../types";
import { useAftercareData } from "../use-data";
import { useAftercareCommand } from "../use-command";
import { AftercareSummary, AcceptedLines } from "./summary";
import {
	DeliveryRefundHistory,
	GoodsRefundHistory,
	OrderHistory,
} from "./history";
import { AftercareActionForm } from "./action-form";
import { AftercareReview } from "./review";

export function AftercareDetail({
	locale,
	context,
	orderId,
	disputeId,
	embedded = false,
	seller,
	scope,
	attempt,
	attemptDomain,
}: {
	locale: Locale;
	context: Context;
	orderId: string;
	disputeId?: string;
	embedded?: boolean;
	seller: string;
	scope: string;
	attempt: string | null;
	attemptDomain: Domain | null;
}) {
	const t = aftercareCopy[locale],
		sales = sellerSalesCopy[locale],
		online = useOnlineState(),
		params = useSearchParams();
	const isSeller = context === "seller",
		action = isSeller ? salesAction : defaultAction,
		panel = isSeller ? salesPanel : defaultPanel;
	const [review, setReview] = useState<Reviewed | null>(null),
		opener = useRef<HTMLElement | null>(null);
	const [dirty, setDirty] = useState(false),
		[formEpoch, setFormEpoch] = useState(0);
	const [activeDomain, setActiveDomain] = useState<Domain>("orders");
	const [uploaded, setUploaded] = useState<{
		id: string;
		domain: Domain;
	} | null>(null);
	const [awaiting, setAwaiting] = useState(false),
		[saved, setSaved] = useState(false);
	const [resolvedOrderId, setResolvedOrderId] = useState(orderId);
	const command = useAftercareCommand({
		scope,
		context,
		orderId: resolvedOrderId,
		attempt,
		attemptDomain,
		onApplied: (intent, result) => {
			setReview(null);
			if (
				intent?.upload &&
				typeof result.id === "string" &&
				uuidPattern.test(result.id)
			) {
				setUploaded({ id: result.id, domain: intent.domain });
			} else {
				setFormEpoch((value) => value + 1);
				setDirty(false);
				setUploaded(null);
				setSaved(true);
			}
			setAwaiting(true);
			source.refresh();
		},
		onAbsent: () => {
			setReview(null);
			setAwaiting(true);
			source.refresh();
		},
		onDenied: () => {
			setReview(null);
			setDirty(false);
			setUploaded(null);
			source.deny();
		},
	});
	const source = useAftercareData(context, orderId, command.locked, disputeId);
	useLayoutEffect(() => {
		if (source.data) setResolvedOrderId(source.data.order.id);
	}, [source.data]);
	const [reportDirty, setReportDirty] = useState(false);
	const guard = useCommerceGuard(locale, dirty || reportDirty || !!review || command.locked);
	// The navigation guard may outlive a form. Keep its deferred private draft
	// callback here so revocation can erase it instead of retaining the old form.
	const choice = useRef<(() => void) | null>(null);
	function choose(next: () => void) {
		choice.current = next;
		guard.choose(() => {
			const apply = choice.current;
			choice.current = null;
			apply?.();
		});
	}
	useEffect(() => {
		if (source.data) setAwaiting(false);
	}, [source.data]);
	const retainedDomain =
		command.pending?.domain ?? review?.intent.domain ?? activeDomain;
	const revoked =
		source.denied ||
		(retainedDomain === "payments" && source.paymentState === "denied") ||
		(retainedDomain === "fulfilment" && source.deliveryState === "denied");
	const authority = useRef<{
		domain: Domain;
		capabilities: string[];
		denied: boolean;
	} | null>(null);
	const redact = command.redact;
	useLayoutEffect(() => {
		const data = source.data;
		const optional =
			retainedDomain === "payments" ? data?.payment : data?.delivery;
		const capabilities =
			retainedDomain === "orders"
				? data?.order.capabilities
				: optional &&
					Object.keys(optional.capabilities).filter(
						(key) => optional.capabilities[key] === true,
					);
		const previous = authority.current;
		// Orders capabilities express action eligibility, not read authority. Losing
		// one marks the review stale; only denial redacts orders drafts. Optional
		// financial/evidence capability losses still redact their private packets.
		const downgraded =
			retainedDomain !== "orders" &&
			previous?.domain === retainedDomain &&
			capabilities != null &&
			previous.capabilities.some((key) => !capabilities.includes(key));
		if (
			(revoked && (!previous?.denied || previous.domain !== retainedDomain)) ||
			downgraded
		) {
			choice.current = null;
			opener.current = null;
			setReview(null);
			setUploaded(null);
			setDirty(false);
			if (source.denied) setReportDirty(false);
			setAwaiting(false);
			setFormEpoch((value) => value + 1);
			redact(); // Keep the opaque key/domain and uncertain-attempt lock.
		}
		// A transient fetch error is not a capability snapshot or a denial.
		if (revoked || capabilities != null)
			authority.current = {
				domain: retainedDomain,
				capabilities: capabilities ? [...capabilities] : [],
				denied: revoked,
			};
	}, [source.data, source.denied, retainedDomain, revoked, redact]);
	if (source.denied) return <p role="alert">{t.noAccess}</p>;
	const data = source.data;
	const blocked = command.locked || awaiting || source.error || !online;
	async function upload(file: File, domain: Domain) {
		if (
			!data ||
			blocked ||
			domain === "orders" ||
			!availableModes(data).some(
				(mode) =>
					["report", "delivery_refund", "dispute_open"].includes(mode) &&
					(mode === "dispute_open" ? "payments" : modeDomain(mode)) === domain,
			)
		)
			return;
		if (
			domain === "payments"
				? !data.payment?.capabilities.evidence
				: !data.delivery?.capabilities.refund
		)
			return;
		const key = crypto.randomUUID(),
			body = new FormData();
		body.append("command_id", key);
		body.append("file", file);
		if (domain === "fulfilment") body.append("purpose", "refund");
		await command.send({
			key,
			domain,
			path: `orders/${data.order.id}/uploads/`,
			body,
			upload: true,
		});
	}
	return (
		<SalesFrame seller={isSeller}>
			<div
				className={
					isSeller
						? "min-w-0 space-y-5 [&_dialog]:rounded-2xl [&_dialog]:shadow-lifted [&_dialog_button]:min-h-11 [&_dialog_button]:rounded-xl [&_dialog_button]:font-semibold"
						: "min-w-0 space-y-5"
				}
			>
				{embedded ? <h2 className="text-xl font-bold">{t.title}</h2> : isSeller ? (
					<SalesHeader
						locale={locale}
						section="aftercare"
						seller={data?.order.seller ?? seller}
						title={
							<>
								{sales.aftercare}
								{data && (
									<>
										{" "}
										· <bdi>{data.order.number}</bdi>
									</>
								)}
							</>
						}
						back={salesHref(locale, "aftercare", seller, undefined, params)}
						business={
							<p className="text-sm font-medium wrap-anywhere">
								<bdi>{data?.order.seller || seller || sales.allBusinesses}</bdi>
							</p>
						}
					/>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h1 className="text-2xl font-bold">
							{disputeId ? t.disputes : t.title}
							{data && (
								<>
									{" "}
									· <bdi>{data.order.number}</bdi>
								</>
							)}
						</h1>
						<Link
							className={action}
							prefetch={false}
							href={aftercareHref(locale, context, undefined, seller)}
						>
							{t.buyerTitle}
						</Link>
					</div>
				)}
				<p
					className={
						isSeller
							? "max-w-3xl text-sm leading-relaxed text-muted"
							: undefined
					}
				>
					{t.intro}
				</p>
				{guard.feedback}
				{!online && <p role="status">{t.offline}</p>}
				{source.error && <p role="alert">{t.error}</p>}
				{command.error && (
					<p role="alert">
						{command.error === "throttled" ? t.throttled : t.error}
					</p>
				)}
				{saved && <p role="status">{t.saved}</p>}
				{command.absent && <p role="status">{t.absent}</p>}
				{command.locked && (
					<section className={`${panel} space-y-3`} aria-live="polite">
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
				<button
					type="button"
					className={action}
					disabled={!online || command.busy}
					onClick={source.refresh}
				>
					{t.refresh}
				</button>
				{!data ? (
					<p role="status">{t.loading}</p>
				) : (
					<>
						{isSeller && (
							<SalesRelated
								locale={locale}
								seller={data.order.seller}
								links={[
									{ section: "orders", id: data.order.id },
									...(data.order.invoice
										? [{ section: "invoices" as const, id: data.order.invoice }]
										: []),
									...(data.payment
										? [{ section: "payments" as const, id: data.order.id }]
										: []),
									...(data.delivery
										? [{ section: "fulfilment" as const, id: data.order.id }]
										: []),
								]}
							/>
						)}
						<AftercareSummary
							{...{ locale, row: data.order, seller: isSeller }}
						/>
						<details className={panel}>
							<summary
								className={
									isSeller
										? "min-h-11 cursor-pointer py-2 font-semibold text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
										: "cursor-pointer py-2 font-bold"
								}
							>
								{t.effectiveLines}
							</summary>
							<AcceptedLines
								{...{
									locale,
									lines: data.order.effective_lines,
									currency: data.order.currency,
									seller: isSeller,
								}}
							/>
						</details>
						<div className="flex flex-wrap gap-3">
							{!source.paymentOpen && (
								<button
									type="button"
									className={action}
									disabled={!online}
									onClick={source.openPayment}
								>
									{t.loadGoods}
								</button>
							)}
							{!source.deliveryOpen && (
								<button
									type="button"
									className={action}
									disabled={!online}
									onClick={source.openDelivery}
								>
									{t.loadDelivery}
								</button>
							)}
						</div>
						{source.paymentOpen &&
							(data.payment ? (
								<GoodsRefundHistory
									{...{ locale, context, row: data.payment }}
								/>
							) : (
								<section className={panel}>
									<h2 className="font-bold">{t.dues}</h2>
									<p role="status">
										{source.paymentState === "denied"
											? t.domainUnavailable
											: source.paymentState === "error"
												? t.error
												: t.loading}
									</p>
									{source.paymentState === "error" && (
										<button
											type="button"
											className={action}
											disabled={!online}
											onClick={source.openPayment}
										>
											{t.refresh}
										</button>
									)}
								</section>
							))}
						{source.deliveryOpen &&
							(data.delivery ? (
								<DeliveryRefundHistory
									{...{
										locale,
										context,
										row: data.delivery,
										currency: data.order.currency,
									}}
								/>
							) : (
								<section className={panel}>
									<h2 className="font-bold">{t.deliveryRefunds}</h2>
									<p role="status">
										{source.deliveryState === "denied"
											? t.domainUnavailable
											: source.deliveryState === "error"
												? t.error
												: t.loading}
									</p>
									{source.deliveryState === "error" && (
										<button
											type="button"
											className={action}
											disabled={!online}
											onClick={source.openDelivery}
										>
											{t.refresh}
										</button>
									)}
								</section>
							))}
						<AftercareActionForm
							key={formEpoch}
							{...{ locale, context, data, uploaded, upload }}
							locked={blocked || !!review}
							onDirty={setDirty}
							onDomain={setActiveDomain}
							choose={choose}
							review={(packet, element) => {
								opener.current = element;
								setSaved(false);
								setReview(packet);
							}}
						/>
						<OrderHistory {...{ locale, row: data.order, seller: isSeller }} />
						<ReportForm key={`${scope}:report`} locale={locale} context={context} id={data.order.id} target="order" onDirty={setReportDirty} onDenied={(error) => { if (error instanceof AccountError && error.status === 401) source.deny(); }} />
						<nav className="flex flex-wrap gap-3" aria-label={t.disputes}>
							<Link className={action} prefetch={false} href={disputeHref(locale, context, undefined, data.order.seller)}>{t.disputes}</Link>
							{disputeId && <Link className={action} prefetch={false} href={aftercareHref(locale, context, data.order.id, data.order.seller)}>{t.openWorkspace}</Link>}
						</nav>
						{review && (
							<AftercareReview
								{...{
									locale,
									context,
									data,
									packet: review,
									opener: opener.current,
								}}
								busy={blocked}
								close={() => setReview(null)}
								confirm={() => {
									if (blocked || isStale(review, data)) return;
									const packet = review.intent;
									setReview(null);
									void command.send(packet);
								}}
							/>
						)}
					</>
				)}
			</div>
		</SalesFrame>
	);
}
