"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { Confirmation } from "../../negotiations/components/confirmation";
import { action } from "../../orders/components/controls";
import { localTimestamp } from "../../messaging/api";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import type { Context, Detail, Reviewed } from "../types";
import { DeliveryEvidence } from "./evidence";
export function DeliveryReview({
	locale,
	context,
	review,
	row,
	busy,
	opener,
	cancel,
	confirm,
}: {
	locale: Locale;
	context: Context;
	review: Reviewed;
	row: Detail;
	busy: boolean;
	opener: HTMLElement | null;
	cancel: () => void;
	confirm: () => void;
}) {
	const t = fulfilmentCopy[locale],
		body = review.intent.body instanceof FormData ? null : review.intent.body;
	const stale =
		body !== null &&
		(body.version !== row.version || body.goods_version !== row.goods_version);
	const packet = review.preview?.packet;
	return (
		<Confirmation label={t.exact} close={cancel} returnFocus={opener}>
			<h2 className="text-xl font-bold">{review.label}</h2>
			<p>
				<bdi>
					{row.number} · {row.currency}
				</bdi>{" "}
				· v{String(body?.version ?? row.version)}
			</p>
			{stale && <p role="alert">{t.stale}</p>}
			{packet && (
				<>
					<p>
						{t.provider}: <bdi>{packet.provider_name}</bdi> ·{" "}
						{fulfilmentState(locale, packet.arranger)}
					</p>
					<p>
						{t.revision}: <bdi>{packet.recipient_revision}</bdi>
					</p>
					<p>
						{t.finalCharge}:{" "}
						<bdi>
							{packet.charge_amount} {packet.currency}
						</bdi>
					</p>
					<p>
						{t.goodsConfirmed}:{" "}
						<bdi>
							{packet.goods_confirmed} / {packet.goods_total} {packet.currency}
						</bdi>
					</p>
					<p>{fulfilmentState(locale, packet.stock_effect)}</p>
					{review.preview?.recipient && (
						<section className="space-y-2 rounded-control border border-border p-3">
							<p dir="auto">{review.preview.recipient.name}</p>
							<p>
								<bdi>{review.preview.recipient.phone}</bdi>
							</p>
							<p className="break-words whitespace-pre-wrap">
								{review.preview.recipient.address}
							</p>
							<p>{review.preview.recipient.instructions}</p>
						</section>
					)}
				</>
			)}
			{review.receipt && (
				<section className="space-y-2 rounded-control border border-border p-3">
					<h3>{t.effectiveAmount}</h3>
					<p>
						{t.chargePayee}: <bdi>{review.receipt.provider_name}</bdi>
					</p>
					<p>
						<bdi>
							{review.receipt.amount} {row.currency}
						</bdi>{" "}
						· v{review.receipt.version}
					</p>
					<p>
						<bdi>{localTimestamp(review.receipt.paid_at, locale)}</bdi>
					</p>
					<p>{review.receipt.description}</p>
				</section>
			)}
			<dl className="space-y-3">
				{Object.entries(review.fields).map(([label, value]) => (
					<div key={label}>
						<dt className="text-sm text-muted">{label}</dt>
						<dd className="break-words whitespace-pre-wrap">
							<bdi>{value}</bdi>
						</dd>
					</div>
				))}
			</dl>
			{(packet?.lines ?? review.lines)?.map((line) => (
				<p key={`${line.variant}:${line.batch ?? "plain"}`}>
					<bdi>
						{line.sku} · {line.quantity} {line.unit_labels[locale] ?? line.unit}{" "}
						· {line.batch_code || "—"} · {line.expires_on || "—"}
					</bdi>
				</p>
			))}
			<div className="flex flex-wrap gap-3">
				{review.images.map((id) => (
					<DeliveryEvidence key={id} {...{ id, context, locale }} />
				))}
			</div>
			{review.capability === "claim" && <p>{t.claimNote}</p>}
			{review.intent.path === "deliver/" && <p>{t.noAuto}</p>}
			{review.capability === "partial" && <p>{t.partialNote}</p>}
			<div className="flex flex-wrap gap-3">
				<button type="button" className={action} onClick={cancel}>
					{t.cancel}
				</button>
				<button
					type="button"
					className={action}
					disabled={busy || stale}
					onClick={confirm}
				>
					{t.confirm}
				</button>
			</div>
		</Confirmation>
	);
}
