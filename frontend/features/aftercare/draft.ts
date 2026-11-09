import type { Locale } from "../../lib/i18n/locales";
import { uuidPattern } from "../../lib/routes/account-routes.ts";
import { actualTime } from "../payments/validation.ts";
import { localTimestamp } from "../messaging/api.ts";
import { aftercareCopy } from "./copy.ts";
import { amendedTotal, exactDue, lineAmount, validDecrease, validReason, validReview, safeText, withinBound } from "./validation.ts";
import type { Domain, Line, Mode, Reviewed, Workspace } from "./types";
export type Draft = { rating: string; text: string; reason: string; target: string; amount: string; at: string; reference: string; description: string; images: string[]; lines: Line[] };
export function emptyDraft(): Draft { return { rating: "", text: "", reason: "", target: "", amount: "", at: "", reference: "", description: "", images: [], lines: [] }; }
export function availableModes(data: Workspace): Mode[] {
	const { order, payment, delivery } = data, modes: Mode[] = [];
	if (order.capabilities.includes("cancel")) modes.push("cancel");
	if (order.cancellations.some((row) => row.can_withdraw)) modes.push("cancel_withdraw");
	if (order.capabilities.includes("amend")) modes.push("amend");
	if (order.amendments.some((row) => row.can_withdraw)) modes.push("amend_withdraw");
	if (payment?.capabilities.excess_refund) modes.push("excess");
	if (payment?.capabilities.refund && payment.refund_dues.some((row) => row.can_report)) modes.push("report");
	if (payment?.refund_reports.some((row) => row.can_withdraw)) modes.push("refund_withdraw");
	if (delivery?.capabilities.refund && delivery.refund_providers?.length) modes.push("delivery_refund");
	if (order.capabilities.includes("dispute_open")) modes.push("dispute_open");
	if (order.disputes?.some((row) => row.can_withdraw)) modes.push("dispute_withdraw");
	if (order.disputes?.some((row) => row.can_respond === true)) modes.push("dispute_respond");
	if (order.capabilities.includes("review_submit")) modes.push("review_submit");
	if (order.review?.can_withdraw === true) modes.push("review_withdraw");
	return modes;
}
export function modeDomain(mode: Mode): Domain { return mode === "delivery_refund" ? "fulfilment" : ["excess", "report", "refund_withdraw"].includes(mode) ? "payments" : "orders"; }
export function modeLabel(locale: Locale, mode: Mode) {
	const t = aftercareCopy[locale];
	return { cancel: t.cancelOrder, cancel_withdraw: t.cancelWithdraw, amend: t.amend, amend_withdraw: t.amendWithdraw, excess: t.excess, report: t.report, refund_withdraw: t.refundWithdraw, delivery_refund: t.deliveryRefund, dispute_open: t.disputeOpen, dispute_withdraw: t.disputeWithdraw, dispute_respond: t.disputeRespond, review_submit: t.reviewSubmit, review_withdraw: t.reviewWithdraw }[mode];
}
export function versionOf(data: Workspace, mode: Mode) { return modeDomain(mode) === "orders" ? data.order.version : modeDomain(mode) === "payments" ? data.payment?.version : data.delivery?.version; }
export function isStale(review: Reviewed, data: Workspace) {
	const body = review.intent.body;
	if (!availableModes(data).includes(review.mode) || body instanceof FormData || body.version !== versionOf(data, review.mode) || (review.intent.domain === "fulfilment" && body.goods_version !== data.delivery?.goods_version)) return true;
	if (review.mode === "dispute_open" && review.images.length && !data.payment?.capabilities.evidence) return true;
	if (review.mode === "dispute_withdraw") return !data.order.disputes?.some((row) => row.id === body.dispute && row.can_withdraw);
	if (review.mode === "dispute_respond") return !data.order.disputes?.some((row) => row.id === body.dispute && row.can_respond === true);
	if (review.mode === "review_withdraw") return data.order.review?.id !== review.intent.path.split("/")[1] || data.order.review?.can_withdraw !== true;
	if (review.mode === "cancel_withdraw") return !data.order.cancellations.some((row) => row.id === body.request && row.can_withdraw);
	if (review.mode === "amend_withdraw") return !data.order.amendments.some((row) => row.id === body.amendment && row.can_withdraw);
	if (review.mode === "refund_withdraw") return !data.payment?.refund_reports.some((row) => row.id === body.report && row.can_withdraw);
	if (review.mode === "report") return !data.payment?.refund_dues.some((row) => row.id === body.due && row.can_report && (row.previous ?? null) === (body.previous ?? null)) || (review.images.length > 0 && !data.payment?.capabilities.evidence);
	if (review.mode === "delivery_refund") return !data.delivery?.refund_providers.some((row) => row.id === body.provider) || (review.images.length > 0 && !data.delivery?.capabilities.refund);
	return false;
}
export function buildAction(locale: Locale, base: Workspace, mode: Mode, draft: Draft, key: string): Reviewed | null {
	if (!availableModes(base).includes(mode) || !uuidPattern.test(key)) return null;
	if ((mode.startsWith("dispute_") || mode.startsWith("review_")) && !uuidPattern.test(base.order.id)) return null;
	const t = aftercareCopy[locale], { order, payment, delivery } = base, domain = modeDomain(mode), version = versionOf(base, mode);
	if (version === undefined) return null;
	const body: Record<string, unknown> = { command_id: key, version }, fields: Record<string, string> = {}, lines: Reviewed["lines"] = [];
	let path = "", images = [...draft.images];
	if (!["report", "delivery_refund", "dispute_respond", "review_submit"].includes(mode)) {
		if (!validReason(draft.reason)) return null;
		body.reason = draft.reason.trim(); fields[t.reason] = draft.reason.trim();
	}
	if (mode === "dispute_open") {
		if (images.length > 3 || new Set(images).size !== images.length || images.some((id) => !uuidPattern.test(id)) || (images.length > 0 && !payment?.capabilities.evidence)) return null;
		path = `orders/${order.id}/disputes/`;
		body.evidence = [...images];
	}
	if (mode === "dispute_withdraw" || mode === "dispute_respond") {
		const row = order.disputes?.find((row) => row.id === draft.target && (mode === "dispute_withdraw" ? row.can_withdraw : row.can_respond === true));
		if (!row || !uuidPattern.test(row.id)) return null;
		path = `disputes/${row.id}/${mode === "dispute_withdraw" ? "withdraw" : "respond"}/`;
		body.dispute = row.id;
		fields[t.target] = `${row.id} · ${row.reason}`;
		images = [...(row.evidence ?? [])];
		if (mode === "dispute_respond") {
			if (draft.text.trim().length < 3 || draft.text.length > 2000 || !safeText(draft.text)) return null;
			body.text = draft.text.trim(); fields[t.disputeResponse] = draft.text.trim();
		}
	}
	if (mode === "review_submit") {
		if (!validReview(draft.rating, draft.text)) return null;
		path = `orders/${order.id}/reviews/`;
		Object.assign(body, { rating: Number(draft.rating), text: draft.text.trim(), language: locale });
		Object.assign(fields, { [t.reviewRating]: `${draft.rating}/5`, [t.reviewText]: draft.text.trim(), [t.reviewLanguage]: locale });
		images = [];
	}
	if (mode === "review_withdraw") {
		const row = order.review;
		if (row?.can_withdraw !== true || !uuidPattern.test(row.id)) return null;
		path = `reviews/${row.id}/withdraw/`;
		Object.assign(fields, { [t.target]: row.id, [t.reviewRating]: `${row.rating}/5`, [t.reviewText]: row.text, [t.reviewLanguage]: row.language });
		images = [];
	}
	if (mode === "cancel") path = `orders/${order.id}/cancellations/`;
	if (mode === "cancel_withdraw" || mode === "amend_withdraw") {
		const row = (mode === "cancel_withdraw" ? order.cancellations : order.amendments).find((row) => row.id === draft.target && row.can_withdraw);
		if (!row) return null;
		path = `${mode === "cancel_withdraw" ? "cancellations" : "amendments"}/${row.id}/withdraw/`;
		body[mode === "cancel_withdraw" ? "request" : "amendment"] = row.id;
		fields[t.target] = `${row.id} · ${row.reason}`;
		if (mode === "amend_withdraw") {
			const proposal = order.amendments.find((item) => item.id === row.id);
			if (!proposal) return null;
			fields[t.after] = `${proposal.after_total} ${order.currency}`;
			for (const after of proposal.lines) {
				const before = order.effective_lines.find((item) => item.line === after.line);
				if (before) lines.push({ before: structuredClone(before), after: { ...structuredClone(before), ...structuredClone(after), goods_amount: lineAmount(after) ?? "" } });
			}
		}
	}
	if (mode === "amend") {
		if (!draft.lines.length || draft.lines.length > 100 || new Set(draft.lines.map((line) => line.line)).size !== draft.lines.length) return null;
		for (const after of draft.lines) {
			const before = order.effective_lines.find((line) => line.line === after.line);
			if (!before || !validDecrease(before, after)) return null;
			lines.push({ before: structuredClone(before), after: { ...structuredClone(after), goods_amount: lineAmount(after) ?? "" } });
		}
		const total = amendedTotal(order.effective_lines, draft.lines);
		if (!total) return null;
		fields[t.before] = `${order.accepted_total} ${order.currency}`;
		fields[t.after] = `${total} ${order.currency}`;
		body.lines = draft.lines.map(({ line, quantity, unit_price }) => ({ line, quantity, unit_price }));
		path = `orders/${order.id}/amendments/`;
	}
	if (mode === "excess") {
		if (!payment || !withinBound(draft.amount, payment.refundable_excess)) return null;
		path = `orders/${order.id}/refund-dues/`; body.amount = draft.amount;
		fields[t.amount] = `${draft.amount} ${order.currency}`; fields[t.limit] = `${payment.refundable_excess} ${order.currency}`;
	}
	if (mode === "report" || mode === "delivery_refund") {
		const at = actualTime(draft.at);
		if (!at || !draft.reference.trim() || draft.reference.length > 160 || !draft.description.trim() || draft.description.length > 500 || draft.images.length > 3) return null;
		Object.assign(body, { amount: draft.amount, sent_at: at, reference: draft.reference.trim(), description: draft.description.trim(), evidence: [...draft.images] });
		Object.assign(fields, { [t.amount]: `${draft.amount} ${order.currency}`, [t.sentAt]: localTimestamp(at, locale), [t.reference]: draft.reference.trim(), [t.description]: draft.description.trim() });
		if (mode === "report") {
			const due = payment?.refund_dues.find((row) => row.id === draft.target && row.can_report);
			if (!due || !exactDue(draft.amount, due.amount)) return null;
			body.due = due.id; if (due.previous) body.previous = due.previous;
			fields[t.target] = due.id; if (due.previous) fields[t.before] = due.previous;
			path = `orders/${order.id}/refund-reports/`;
		} else {
			const provider = delivery?.refund_providers.find((row) => row.id === draft.target);
			if (!provider || !withinBound(draft.amount, provider.refundable)) return null;
			Object.assign(body, { provider: provider.id, currency: order.currency, goods_version: delivery?.goods_version });
			fields[t.provider] = provider.name; fields[t.limit] = `${provider.refundable} ${order.currency}`;
			path = `orders/${order.id}/delivery-refunds/`;
		}
	}
	if (mode === "refund_withdraw") {
		const report = payment?.refund_reports.find((row) => row.id === draft.target && row.can_withdraw);
		if (!report) return null;
		path = `refund-reports/${report.id}/withdraw/`; body.report = report.id;
		fields[t.target] = report.id; fields[t.amount] = `${report.amount} ${order.currency}`; fields[t.reference] = report.reference; fields[t.description] = report.description;
		fields[t.sentAt] = localTimestamp(report.sent_at, locale);
		images = [...report.evidence];
	}
	if (!path) return null;
	return freezeReviewed({ mode, intent: { key, domain, path, body, upload: false }, number: order.number, currency: order.currency, fields, lines, images });
}

export function freezeReviewed(review: Reviewed): Reviewed {
	// Reviewed command bodies are JSON, never a mutable form or current row.
	const snapshot = structuredClone(review);
	function freeze(value: unknown) {
		if (!value || typeof value !== "object") return;
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	freeze(snapshot);
	return snapshot;
}
