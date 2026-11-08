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
import {
	salesAction,
	salesPanel,
	salesHref,
	salesHistoryHref,
} from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import type { QueryReader } from "../../../lib/routes/account-routes";
export function ProposalSummary({
	locale,
	proposal,
	currency,
	presentation,
}: {
	locale: Locale;
	proposal: Proposal;
	currency: string;
	presentation?: "seller";
}) {
	const t = negotiationCopy[locale],
		seller = presentation === "seller";
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
						className={
							seller
								? "min-w-0 space-y-3 rounded-xl border border-border p-4"
								: "space-y-2 border-b border-border pb-3"
						}
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
						<dl
							className={
								seller
									? "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:font-medium"
									: "grid grid-cols-2 gap-2"
							}
						>
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
			<p
				className={
					seller ? "rounded-xl bg-info p-3 font-semibold" : "font-bold"
				}
			>
				{t.amount}:{" "}
				<bdi>
					{goodsTotal(proposal.lines)} {currency}
				</bdi>
			</p>
			{seller ? (
				<section className="space-y-3 rounded-xl border border-border p-4">
					<h3 className="text-sm font-semibold">{t.terms}</h3>
					<dl className="grid gap-3 text-sm sm:grid-cols-3">
						<div>
							<dt className="text-xs text-muted">{t.country}</dt>
							<dd>
								<bdi>{proposal.choice.country}</bdi>
							</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-xs text-muted">{t.city}</dt>
							<dd className="break-words" dir="auto">
								{proposal.choice.city}
							</dd>
						</div>
						<div>
							<dt className="text-xs text-muted">{t.method}</dt>
							<dd>
								{proposal.choice.method ? t[proposal.choice.method] : t.choose}
							</dd>
						</div>
					</dl>
				</section>
			) : (
				<p>
					{t.terms}: <bdi>{proposal.choice.country}</bdi> ·{" "}
					<span dir="auto">{proposal.choice.city}</span> ·{" "}
					{proposal.choice.method ? t[proposal.choice.method] : t.choose}
				</p>
			)}
			{proposal.note && (
				<p
					className={
						seller
							? "whitespace-pre-wrap rounded-xl border border-border p-4 text-sm leading-relaxed"
							: "whitespace-pre-wrap"
					}
					dir="auto"
				>
					{seller && <span className="mb-2 block font-semibold">{t.note}</span>}
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
	presentation,
	params,
}: {
	locale: Locale;
	row: RequestRow;
	context: Context;
	seller: string;
	presentation?: "seller";
	params?: QueryReader;
}) {
	const t = negotiationCopy[locale],
		sales = sellerSalesCopy[locale],
		sellerPresentation = context === "seller" && presentation === "seller";
	function historyHref(page: number) {
		const href = `${salesHref(locale, "negotiations", seller, row.id)}${seller ? "&" : "?"}history_page=${page}`;
		return params ? salesHistoryHref(href, params) : href;
	}
	return (
		<section className={sellerPresentation ? salesPanel : panel}>
			<h2
				className={sellerPresentation ? "text-lg font-semibold" : "font-bold"}
			>
				{sellerPresentation ? sales.history : t.history}
			</h2>
			{sellerPresentation && (
				<p className="text-sm text-muted">
					{t.history} · {sales.results}:{" "}
					<bdi>{new Intl.NumberFormat(locale).format(row.history_count)}</bdi> ·{" "}
					{sales.page}{" "}
					<bdi>{new Intl.NumberFormat(locale).format(row.history_page)}</bdi>
				</p>
			)}
			{row.history.map((h, i) => (
				<details
					key={`${h.action}:${h.revision}:${h.version ?? i}`}
					className={
						sellerPresentation
							? "min-w-0 space-y-3 rounded-xl border border-border p-3"
							: undefined
					}
				>
					<summary
						className={
							sellerPresentation
								? "min-h-11 cursor-pointer break-words text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
								: undefined
						}
					>
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
							presentation={sellerPresentation ? "seller" : undefined}
							proposal={h.proposal}
						/>
					)}{" "}
					{h.state?.final && (
						<>
							<h3>{t.final}</h3>
							<ProposalSummary
								{...{ locale, currency: row.currency }}
								presentation={sellerPresentation ? "seller" : undefined}
								proposal={{ ...row.proposal, ...h.state.final }}
							/>
						</>
					)}
				</details>
			))}
			<nav
				aria-label={sellerPresentation ? sales.history : undefined}
				className={sellerPresentation ? "flex flex-wrap gap-3" : "flex gap-3"}
			>
				{[row.history_page - 1, row.history_page + 1]
					.filter((p) => p > 0 && p <= Math.ceil(row.history_count / 20))
					.map((p) => (
						<Link
							key={p}
							className={
								sellerPresentation ? salesAction : "text-action underline"
							}
							href={
								sellerPresentation
									? historyHref(p)
									: `${requestHref(locale, context, row.id)}?${new URLSearchParams({ history_page: String(p), ...(seller ? { seller } : {}) })}`
							}
						>
							{p < row.history_page ? t.previous : t.next}
						</Link>
					))}
			</nav>
		</section>
	);
}
