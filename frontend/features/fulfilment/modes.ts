import type { Locale } from "../../lib/i18n/locales";
import type { Mode } from "./draft";
import type { Context, Detail } from "./types";
import { fulfilmentCopy } from "./copy";
import { aftercareCopy } from "../aftercare/copy";

function preDispatch(row: Detail) {
	return !["dispatched", "delivered"].includes(row.stage);
}

/** Single source of truth for which actions are offered at the current state. */
export function availableModes(
	row: Detail,
	context: Context,
	locale: Locale,
): [Mode, string][] {
	const t = fulfilmentCopy[locale],
		r = aftercareCopy[locale],
		c = row.capabilities,
		pending = preDispatch(row),
		modes: [Mode, string][] = [];
	if (c.recipient_edit && pending) modes.push(["recipient", t.saveRecipient]);
	if (c.prepare && pending)
		modes.push(
			["arrange", t.saveArrangement],
			["prepare", t.prepare],
			["charge", t.proposeCharge],
		);
	if (
		c.partial &&
		pending &&
		row.payment_method === "advance" &&
		row.goods_confirmed !== "0.00" &&
		row.goods_remaining !== "0.00"
	)
		modes.push(["partial", t.partial]);
	if (c.dispatch && pending && row.preparation?.current)
		modes.push(["dispatch", t.reviewDispatch]);
	if (c.claim && row.charge_id && row.charge !== "0.00")
		modes.push(["claim", t.claimDelivery]);
	if (c.claim && row.receipts.some((receipt) => receipt.can_correct))
		modes.push(["correction", t.correctionDelivery]);
	if (c.claim && row.claims.some((claim) => claim.can_withdraw))
		modes.push(["withdraw", t.withdrawClaim]);
	if (context === "seller" && c.refund && row.refund_providers.length > 0)
		modes.push(["refund", r.deliveryRefund]);
	if (c.tracking && !pending) modes.push(["tracking", t.recordTracking]);
	if (c.deliver && row.stage === "dispatched")
		modes.push(["deliver", t.deliver]);
	return modes;
}
