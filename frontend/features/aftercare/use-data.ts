"use client";
import { useState } from "react";
import { AccountError } from "../../lib/api/private-client";
import { accessLost, useVisiblePoll } from "../messaging/hooks";
import { aftercare, orderAftercarePath } from "./api";
import type { Context, DeliveryDetail, Detail, DisputeDetail, RefundDetail, Workspace } from "./types";

type DomainState = "closed" | "loading" | "ready" | "denied" | "error";
export function useAftercareData(context: Context, orderId: string, commandActive: boolean, disputeId?: string) {
	const [data, setData] = useState<Workspace | null>(null);
	const [error, setError] = useState(false);
	const [denied, setDenied] = useState(false);
	const [revision, setRevision] = useState(0);
	const [loadedRevision, setLoadedRevision] = useState(-1);
	const [paymentOpen, setPaymentOpen] = useState(false);
	const [deliveryOpen, setDeliveryOpen] = useState(false);
	const [paymentState, setPaymentState] = useState<DomainState>("closed");
	const [deliveryState, setDeliveryState] = useState<DomainState>("closed");
	function deny() { setDenied(true); setData(null); }
	const terminal = data && (data.order.aftercare.cancelled || data.order.aftercare.completed)
		&& !data.order.aftercare.pending_cancellation && !data.order.aftercare.pending_amendment
		&& !data.order.aftercare.pending_dispute && !data.order.disputes?.some((row) => row.state === "pending")
		&& data.order.review?.state !== "pending"
		&& data.order.payment.refund_due === "0.00"
		&& !data.payment?.refund_reports.some((row) => row.state === "pending")
		&& !data.delivery?.delivery_refunds.some((row) => row.state === "pending");
	useVisiblePoll(async (signal) => {
		let order: Detail;
		try {
			if (disputeId) {
				const dispute = await aftercare<DisputeDetail>("orders", context, `disputes/${disputeId}/`, undefined, signal);
				const disputes = dispute.order_detail.disputes ?? [];
				order = { ...dispute.order_detail, disputes: disputes.some((row) => row.id === dispute.id)
					? disputes.map((row) => row.id === dispute.id ? dispute : row)
					: [...disputes, dispute] };
			} else order = await aftercare<Detail>("orders", context, orderAftercarePath(orderId), undefined, signal);
		} catch (error) {
			if (signal.aborted) return;
			setError(true);
			if (accessLost(error)) deny();
			throw error;
		}
		if (signal.aborted) return;
		let payment: RefundDetail | null = null, delivery: DeliveryDetail | null = null;
		let failed = false;
		// Optional domains are fetched only on deliberate expansion. They never
		// borrow orders permissions, nor block an otherwise authorized order read.
		if (paymentOpen && paymentState !== "denied") {
			try {
				payment = await aftercare<RefundDetail>("payments", context, `orders/${order.id}/`, undefined, signal);
				if (!signal.aborted) setPaymentState("ready");
			} catch (error) {
				if (signal.aborted) return;
				if (error instanceof AccountError && error.status === 401) { deny(); return; }
				const unavailable = accessLost(error);
				setPaymentState(unavailable ? "denied" : "error");
				setData((old) => old ? { ...old, payment: null } : null);
				failed ||= !unavailable;
			}
		}
		if (deliveryOpen && deliveryState !== "denied") {
			try {
				delivery = await aftercare<DeliveryDetail>("fulfilment", context, `orders/${order.id}/`, undefined, signal);
				if (!signal.aborted) setDeliveryState("ready");
			} catch (error) {
				if (signal.aborted) return;
				if (error instanceof AccountError && error.status === 401) { deny(); return; }
				const unavailable = accessLost(error);
				setDeliveryState(unavailable ? "denied" : "error");
				setData((old) => old ? { ...old, delivery: null } : null);
				failed ||= !unavailable;
			}
		}
		if (signal.aborted) return;
		setData({ order, payment, delivery });
		if (!failed) setLoadedRevision(revision);
		setError(failed);
		if (failed) throw Error(); // Reuse the shared bounded backoff.
	}, [context, orderId, disputeId, paymentOpen, deliveryOpen, revision, denied], !denied && (commandActive || error || loadedRevision !== revision || !terminal));
	return {
		data, error, denied, deny, paymentOpen, deliveryOpen, paymentState, deliveryState,
		refresh: () => setRevision((value) => value + 1),
		openPayment: () => { setPaymentState("loading"); setPaymentOpen(true); setRevision((value) => value + 1); },
		openDelivery: () => { setDeliveryState("loading"); setDeliveryOpen(true); setRevision((value) => value + 1); },
	};
}
