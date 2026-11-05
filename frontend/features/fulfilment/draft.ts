import type { Locale } from "../../lib/i18n/locales";
import { fulfilmentCopy } from "./copy";
import { actualTime, moneyUnits, wholeSelection } from "./validation";
import type { Detail, DisplayLine, Receipt, Intent } from "./types";
export type Mode =
	| "recipient"
	| "arrange"
	| "prepare"
	| "partial"
	| "charge"
	| "claim"
	| "correction"
	| "withdraw"
	| "tracking"
	| "deliver"
	| "dispatch";
const paths: Record<Mode, string> = {
	recipient: "recipient/",
	arrange: "arrangement/",
	prepare: "prepare/",
	partial: "partial-authorization/",
	charge: "charges/",
	claim: "claims/",
	correction: "corrections/",
	withdraw: "claims/withdraw/",
	tracking: "tracking/",
	deliver: "deliver/",
	dispatch: "dispatch/",
};

export type DraftBase = {
	version: number;
	goods_version: number;
	recipient_revision: number;
	recipient?: string;
	arrangement?: string;
	provider?: string;
	charge: string | null;
	preparation?: string;
};
export type Draft = {
	name: string;
	phone: string;
	address: string;
	instructions: string;
	provider: string;
	selfDelivery: boolean;
	amount: string;
	description: string;
	reason: string;
	reference: string;
	at: string;
	target: string;
	receipt?: Receipt;
	lines: DisplayLine[];
	images: string[];
};
/** Validate displayed fields without deriving any authoritative money or stock. */
export function buildAction(
	locale: Locale,
	row: Detail,
	mode: Mode,
	base: DraftBase,
	draft: Draft,
): { intent: Intent; fields: Record<string, string> } | null {
	const t = fulfilmentCopy[locale],
		{
			name,
			phone,
			address,
			instructions,
			provider,
			selfDelivery,
			amount,
			description,
			reason,
			reference,
			at,
			target,
			receipt,
			lines,
			images,
		} = draft;
	const key = crypto.randomUUID(),
		body: Record<string, unknown> = {
			command_id: key,
			version: base.version,
			goods_version: base.goods_version,
		},
		fields: Record<string, string> = {};
	const needsReason = !["arrange", "claim"].includes(mode),
		needsTime = ["claim", "correction", "tracking", "deliver"].includes(mode),
		needsMoney = ["claim", "correction", "charge"].includes(mode);
	const actual = needsTime ? actualTime(at) : null;
	if (
		(needsReason && (reason.trim().length < 3 || reason.length > 1000)) ||
		(needsTime && !actual) ||
		(needsMoney && moneyUnits(amount, mode !== "claim") === null)
	) {
		return null;
	}
	if (needsReason) {
		body.reason = reason.trim();
		fields[t.reason] = reason.trim();
	}
	if (needsMoney) {
		body.amount = amount;
		fields[t.amount] = `${amount} ${row.currency}`;
	}
	if (needsTime) {
		body[
			mode === "claim" || mode === "correction" ? "paid_at" : "occurred_at"
		] = actual;
		fields[
			mode === "tracking" || mode === "deliver" ? t.occurredAt : t.paidAt
		] = actual ?? "";
	}
	if (mode === "recipient") {
		if (!name.trim() || !phone.trim() || !address.trim()) {
			return null;
		}
		Object.assign(body, {
			recipient_revision: base.recipient_revision,
			name: name.trim(),
			phone: phone.trim(),
			address: address.trim(),
			instructions: instructions.trim(),
		});
		Object.assign(fields, {
			[t.recipientName]: name.trim(),
			[t.phone]: phone.trim(),
			[t.address]: address.trim(),
			[t.instructions]: instructions.trim(),
			[t.revision]: String(base.recipient_revision + 1),
		});
	}
	if (mode === "arrange") {
		if (!provider.trim()) {
			return null;
		}
		Object.assign(body, {
			arranger: "seller",
			provider: provider.trim(),
			self_delivery: selfDelivery,
			instructions: instructions.trim(),
		});
		Object.assign(fields, {
			[t.provider]: provider.trim(),
			[t.arranger]: t.sellerArranger,
			[t.instructions]: instructions.trim(),
		});
	}
	if (mode === "prepare") {
		if (
			!base.recipient ||
			!base.arrangement ||
			(row.payment_method === "cod" && !wholeSelection(row.goods, lines))
		) {
			return null;
		}
		Object.assign(body, {
			recipient: base.recipient,
			arrangement: base.arrangement,
		});
		if (row.payment_method === "cod")
			body.lines = lines.map(({ variant, batch, quantity }) => ({
				variant,
				batch,
				quantity,
			}));
		fields[t.revision] = String(base.recipient_revision);
		fields[t.provider] = row.arrangement?.provider ?? "";
	}
	if (mode === "partial") {
		fields[t.goodsConfirmed] = `${row.goods_confirmed} ${row.currency}`;
		fields[t.goodsRemaining] = `${row.goods_remaining} ${row.currency}`;
	}
	if (mode === "charge") {
		if (!base.provider) {
			return null;
		}
		Object.assign(body, { provider: base.provider, currency: row.currency });
		fields[t.provider] = row.arrangement?.provider ?? "";
	}
	if (mode === "claim" || mode === "correction") {
		if (
			!description.trim() ||
			(mode === "claim" && !base.charge) ||
			(mode === "correction" && !receipt)
		) {
			return null;
		}
		Object.assign(body, {
			description: description.trim(),
			evidence: images,
		});
		fields[t.description] = description.trim();
		fields[t.chargePayee] =
			mode === "correction"
				? (receipt?.provider_name ?? "")
				: row.charge_provider;
		if (mode === "claim")
			Object.assign(body, { charge: base.charge, currency: row.currency });
		else
			Object.assign(body, {
				receipt: receipt?.id,
				receipt_version: receipt?.version,
			});
	}
	if (mode === "withdraw") {
		if (
			!row.claims.some((claim) => claim.id === target && claim.can_withdraw)
		) {
			return null;
		}
		body.claim = target;
		const claim = row.claims.find((value) => value.id === target);
		if (claim)
			Object.assign(fields, {
				[t.amount]: `${claim.amount} ${row.currency}`,
				[t.description]: claim.description,
			});
	}
	if (mode === "tracking") {
		if (!reference.trim()) {
			return null;
		}
		body.reference = reference.trim();
		fields[t.tracking] = reference.trim();
	}

	return { intent: { key, path: paths[mode], body, upload: false }, fields };
}
