import Link from "next/link";
import { localTimestamp } from "../../messaging/api";
import { lineCents, moneyText, goodsTotal } from "../validation";
import { productContext, productText } from "../api";
import { requestHref } from "../api";
import type { Context } from "../../messaging/api";
import type { Locale } from "../../../lib/i18n/locales";
import type { Proposal, RequestRow } from "../api";
import { commerceCopy } from "../../orders/copy";
import { negotiationCopy } from "../copy";
import { panel } from "../../orders/components/controls";
export function ProposalSummary({
	locale,
	proposal,
	currency,
}: {
	locale: Locale;
	proposal: Proposal;
	currency: string;
}) {
	const t = negotiationCopy[locale];
	return (
		<div className="space-y-3">
			{proposal.lines.map((line, i) => {
				const product = productText(
					productContext(proposal, line.variant, i),
					locale,
					line.variant,
				);
				return (
					<div
						key={`${line.variant}:${commerceCopy[locale][line.tier]}`}
						className="space-y-2 border-b border-border pb-3"
					>
						<p className="break-words font-bold">
							{product.title}
							{product.source && (
								<small>
									{" "}
									· {commerceCopy[locale].source}: <bdi>{product.source}</bdi>
								</small>
							)}
						</p>
						<p>
							{commerceCopy[locale][line.tier]} · <bdi>{product.unit}</bdi>
						</p>
						<dl className="grid grid-cols-2 gap-2">
							<dt>{commerceCopy[locale].goods}</dt>
							<dd>
								<bdi>
									{moneyText(lineCents(line))} {currency}
								</bdi>
							</dd>
							<dt>{t.quantity}</dt>
							<dd>
								<bdi>{line.quantity}</bdi>
							</dd>
							<dt>{t.offer}</dt>
							<dd>
								<bdi>
									{line.unit_price} {currency}
								</bdi>
							</dd>
							{line.max_quantity && (
								<>
									<dt>{t.maxQuantity}</dt>
									<dd>
										<bdi>{line.max_quantity}</bdi>
									</dd>
									<dt>{t.maxPrice}</dt>
									<dd>
										<bdi>
											{line.max_unit_price} {currency}
										</bdi>
									</dd>
								</>
							)}
						</dl>
					</div>
				);
			})}
			<p className="font-bold">
				{t.amount}:{" "}
				<bdi>
					{goodsTotal(proposal.lines)} {currency}
				</bdi>
			</p>
			<p>
				{t.terms}: <bdi>{proposal.choice.country}</bdi> ·{" "}
				<span dir="auto">{proposal.choice.city}</span> ·{" "}
				{proposal.choice.method ? t[proposal.choice.method] : t.choose}
			</p>
			{proposal.note && (
				<p className="whitespace-pre-wrap" dir="auto">
					{proposal.note}
				</p>
			)}
		</div>
	);
}
export function History({
	locale,
	row,
	context,
	seller,
}: {
	locale: Locale;
	row: RequestRow;
	context: Context;
	seller: string;
}) {
	const t = negotiationCopy[locale];
	return (
		<section className={panel}>
			<h2 className="font-bold">{t.history}</h2>
			{row.history.map((h, i) => (
				<details key={`${h.action}:${h.revision}:${h.version ?? i}`}>
					<summary>
						{h.action === "buyer_proposal"
							? t.original
							: h.action === "resubmitted"
								? t.resubmitted
								: h.action in t
									? t[h.action as keyof typeof t]
									: t.history}{" "}
						· {t.version} <bdi>{h.version ?? h.revision}</bdi> ·{" "}
						<bdi>{localTimestamp(h.at, locale)}</bdi> · <bdi>{h.actor}</bdi>
					</summary>
					<p className="whitespace-pre-wrap" dir="auto">
						{h.reason}
					</p>
					{h.proposal && (
						<ProposalSummary
							{...{ locale, currency: row.currency }}
							proposal={h.proposal}
						/>
					)}{" "}
					{h.state?.final && (
						<>
							<h3>{t.final}</h3>
							<ProposalSummary
								{...{ locale, currency: row.currency }}
								proposal={{ ...row.proposal, ...h.state.final }}
							/>
						</>
					)}
				</details>
			))}
			<nav className="flex gap-3">
				{[row.history_page - 1, row.history_page + 1]
					.filter((p) => p > 0 && p <= Math.ceil(row.history_count / 20))
					.map((p) => (
						<Link
							key={p}
							className="text-action underline"
							href={`${requestHref(locale, context, row.id)}?${new URLSearchParams({ history_page: String(p), ...(seller ? { seller } : {}) })}`}
						>
							{p < row.history_page ? t.previous : t.next}
						</Link>
					))}
			</nav>
		</section>
	);
}
