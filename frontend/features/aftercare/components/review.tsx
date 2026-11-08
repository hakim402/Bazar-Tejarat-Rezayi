"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { Confirmation } from "../../negotiations/components/confirmation";
import { action } from "../../orders/components/controls";
import { aftercareCopy } from "../copy";
import { isStale, modeLabel } from "../draft";
import type { Context, Reviewed, Workspace } from "../types";
import { AftercareEvidence } from "./evidence";

export function AftercareReview({ locale, context, packet, data, busy, opener, close, confirm }: {
	locale: Locale; context: Context; packet: Reviewed; data: Workspace; busy: boolean;
	opener: HTMLElement | null; close: () => void; confirm: () => void;
}) {
	const t = aftercareCopy[locale], stale = isStale(packet, data);
	const evidenceAllowed = packet.intent.domain === "payments" ? data.payment?.capabilities.evidence : packet.intent.domain === "fulfilment" && data.delivery?.capabilities.refund;
	const body = packet.intent.body instanceof FormData ? null : packet.intent.body;
	return <Confirmation label={t.exact} close={close} returnFocus={opener}>
		<h2 className="text-xl font-bold">{modeLabel(locale, packet.mode)}</h2>
		<p><bdi>{packet.number} · {packet.currency}</bdi> · v{String(body?.version ?? "—")}</p>
		{body?.goods_version !== undefined && <p>{t.goodsConfirmed}: v{String(body.goods_version)}</p>}
		{stale && <p role="alert">{t.stale}</p>}
		<dl className="space-y-3">{Object.entries(packet.fields).map(([label, value]) => <div key={label}>
			<dt className="text-sm text-muted">{label}</dt><dd className="whitespace-pre-wrap break-words"><bdi>{value}</bdi></dd>
		</div>)}</dl>
		{packet.lines.length > 0 && <div className="space-y-3">
			<p>{t.selectLines}</p>
			{packet.lines.map(({ before, after }) => <div key={before.line} className="rounded-control border border-border p-3">
				<p dir="auto">{before.titles?.[locale] ?? before.sku ?? before.line}</p>
				<p className="break-words"><bdi>{before.line}</bdi></p>
				<p>{t.before}: {t.quantity} <bdi>{before.quantity} {before.unit_labels?.[locale] ?? before.unit}</bdi> · {t.unitPrice} <bdi>{before.unit_price} {packet.currency}</bdi></p>
				<p>{t.after}: {t.quantity} <bdi>{after.quantity} {after.unit_labels?.[locale] ?? after.unit}</bdi> · {t.unitPrice} <bdi>{after.unit_price} {packet.currency}</bdi></p>
				<p>{t.total}: <bdi>{after.goods_amount} {packet.currency}</bdi></p>
			</div>)}
		</div>}
		<div className="flex flex-wrap gap-3">{packet.images.filter((id) => evidenceAllowed || (packet.intent.domain === "fulfilment" && data.delivery?.delivery_refunds.some((refund) => refund.evidence.includes(id)))).map((id) => <AftercareEvidence key={id} {...{ id, context, locale, domain: packet.intent.domain }} />)}</div>
		<p>{packet.mode === "delivery_refund" ? t.deliveryNote : ["excess", "report", "refund_withdraw"].includes(packet.mode) ? t.refundNote : ["amend", "amend_withdraw"].includes(packet.mode) ? t.rules : t.cancelNote}</p>
		<div className="flex flex-wrap gap-3">
			<button className={action} type="button" onClick={close}>{t.cancel}</button>
			<button className={action} type="button" disabled={busy || stale} onClick={confirm}>{t.confirm}</button>
		</div>
	</Confirmation>;
}
