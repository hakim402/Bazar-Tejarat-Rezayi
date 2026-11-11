export type Context = "buyer" | "seller";
export type Capability =
	| "recipient"
	| "recipient_edit"
	| "prepare"
	| "dispatch"
	| "tracking"
	| "deliver"
	| "partial"
	| "claim"
	| "refund"
	| "financial_details"
	| "evidence"
	| "handover"
	| "invoice";
export type Summary = {
	id: string;
	seller: string;
	number: string;
	buyer: string;
	invoice: string | null;
	currency: string;
	goods_total: string;
	payment_method: "advance" | "cod";
	destination: Record<string, string>;
	version: number;
	goods_version: number;
	goods_confirmed: string;
	goods_remaining: string;
	stage: string;
	allocation: string;
	overdue: boolean;
	dispatch_problem: string | null;
	charge: string | null;
	charge_id: string | null;
	charge_provider: string;
	delivery_confirmed: string;
	delivery_refunded: string;
	delivery_remaining: string | null;
	delivery_excess: string | null;
	delivery_settled: boolean;
	cancellation_hold: boolean;
	dispute_open: boolean;
	completion: string;
	completed_at: string | null;
	eligible: boolean;
	provider: string;
	capabilities: Record<Capability, boolean>;
};
export type Recipient = {
	id: string;
	revision: number;
	name: string;
	phone: string;
	address: string;
	instructions: string;
	reason: string;
};
export type StockLine = {
	variant: string;
	batch: string | null;
	quantity: string;
};
export type DisplayLine = StockLine & {
	client_id?: string;
	bucket: string;
	batch_code: string;
	expires_on: string | null;
	sku: string;
	unit: string;
	unit_labels: Record<string, string>;
};
export type Claim = {
	id: string;
	amount: string;
	currency: string;
	paid_at: string;
	description: string;
	state: string;
	can_withdraw: boolean;
	evidence: string[];
};
export type Receipt = {
	id: string;
	claim: string;
	amount: string;
	original_amount: string;
	can_correct: boolean;
	paid_at: string;
	description: string;
	provider: string;
	provider_name: string;
	version: number;
	evidence: string[];
};
export type Detail = Summary & {
	refund_providers: { id: string; name: string; refundable: string }[];
	delivery_refunds: {
		id: string;
		provider: string;
		provider_name: string;
		amount: string;
		currency: string;
		sent_at: string;
		reference: string;
		description: string;
		state: "pending" | "confirmed" | "rejected";
		evidence: string[];
	}[];
	held_lines: DisplayLine[];
	recipient: Recipient | null;
	recipient_revision: number;
	arrangement: {
		id: string;
		provider_id: string;
		provider: string;
		arranger: "seller" | "rezayi";
		instructions: string;
	} | null;
	preparation: {
		id: string;
		recipient_revision: number;
		arrangement: string;
		current: boolean;
		lines: DisplayLine[];
	} | null;
	partial_permission: {
		id: string;
		goods_version: number;
		reason: string;
	} | null;
	goods: {
		variant: string;
		tier: string;
		quantity: string;
		sku: string;
		unit: string;
		unit_labels: Record<string, string>;
		titles: Record<string, string>;
		source_locale: string;
		image: string;
	}[];
	proposals: {
		id: string;
		provider: string;
		provider_id: string;
		amount: string;
		currency: string;
		reason: string;
		state: string;
	}[];
	claims: Claim[];
	receipts: Receipt[];
	corrections: {
		id: string;
		receipt: string;
		amount: string;
		target_version: number;
		evidence: string[];
		paid_at: string;
		description: string;
		reason: string;
		state: string;
	}[];
	tracking: {
		id: string;
		reference: string;
		occurred_at: string;
		reason: string;
		source: string;
	}[];
	delivery: { occurred_at: string; source: string; reason: string } | null;
	cases: { id: string; kind: string; state: string }[];
	blockers: { id: string; kind: string }[];
	history: {
		id: string;
		version: number;
		action: string;
		context: string;
		created_at: string;
	}[];
	history_page: number;
	history_count: number;
};
export type StockOptions = {
	count: number;
	page: number;
	results: (DisplayLine & { available: string; required: string })[];
};
export type DispatchPacket = {
	command_id: string;
	version: number;
	goods_version: number;
	preparation: string;
	recipient: string;
	recipient_revision: number;
	arrangement: string;
	arranger: string;
	provider: string;
	provider_name: string;
	charge: string;
	charge_amount: string;
	currency: string;
	goods_confirmed: string;
	goods_total: string;
	partial_permission: string | null;
	lines: DisplayLine[];
	stock_effect: "consume_hold" | "deduct_cod";
	reason: string;
	review: string;
};
export type Preview = {
	packet: DispatchPacket;
	recipient: Omit<Recipient, "id" | "revision" | "reason"> | null;
};
export type Outcome = { result: Record<string, unknown>; current: Detail };
export type Recovery = {
	state: "unknown" | "applied" | "rejected";
	result: Record<string, unknown> | null;
};
export type Intent = {
	key: string;
	path: string;
	body: Record<string, unknown> | FormData;
	upload: boolean;
};
export type Reviewed = {
	capability: Capability;
	intent: Intent;
	label: string;
	preview?: Preview;
	fields: Record<string, string>;
	receipt?: Receipt;
	lines?: DisplayLine[];
	images: string[];
};
