import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { localTimestamp } from "../../messaging/api";
import { lineCents, moneyText, goodsTotal } from "../validation";
import { productContext, productImage, productText } from "../api";
import { requestHref } from "../api";
import type { Context } from "../../messaging/api";
import type { Locale } from "../../../lib/i18n/locales";
import type { Proposal, RequestRow } from "../api";
import { commerceCopy } from "../../orders/copy";
import { negotiationCopy } from "../copy";
import {
	DetailField,
	Money,
	ProductThumbnail,
} from "../../orders/components/order-ui";
import { StatusBadge } from "../../../components/ui/status-badge";
import { negotiationVariant } from "./buyer-negotiations";
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
		c = commerceCopy[locale],
		seller = presentation === "seller";
	if (seller) {
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
							key={`${line.variant}:${c[line.tier]}`}
							className="min-w-0 space-y-3 rounded-xl border border-border p-4"
						>
							<p className="break-words font-bold">
								{product.title}
								{product.source && (
									<small>
										{" "}
										· {c.source}: <bdi>{product.source}</bdi>
									</small>
								)}
							</p>
							<p>
								{c[line.tier]} · <bdi>{product.unit}</bdi>
							</p>
							<dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [&_dt]:text-muted [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:font-medium">
								<dt>{c.goods}</dt>
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
				<p className="rounded-xl bg-info p-3 font-semibold">
					{t.amount}:{" "}
					<bdi>
						{goodsTotal(proposal.lines)} {currency}
					</bdi>
				</p>
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
				{proposal.note && (
					<p
						className="whitespace-pre-wrap rounded-xl border border-border p-4 text-sm leading-relaxed"
						dir="auto"
					>
						<span className="mb-2 block font-semibold">{t.note}</span>
						{proposal.note}
					</p>
				)}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{proposal.lines.map((line, i) => {
				const context = productContext(proposal, line.variant, i),
					product = productText(context, locale, line.variant);
				return (
					<div
						key={`${line.variant}:${c[line.tier]}`}
						className="flex min-w-0 items-start gap-3 border-0 border-b border-solid border-border pb-3 last:border-b-0 last:pb-0"
					>
						<ProductThumbnail src={productImage(context)} />
						<div className="min-w-0 flex-1">
							<p
								className="m-0 break-words text-sm font-semibold text-foreground"
								dir="auto"
							>
								{product.title}
							</p>
							<p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
								<Badge
									variant="secondary"
									className="rounded-full border-0 bg-page text-muted"
								>
									{c[line.tier]}
								</Badge>
								<bdi>{product.unit}</bdi>
								{product.source && (
									<span>
										· {c.source}: <bdi>{product.source}</bdi>
									</span>
								)}
							</p>
							<dl className="m-0 mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
								<DetailField label={t.quantity}>
									<bdi>
										{line.quantity.replace(/\.000$/, "")} {product.unit}
									</bdi>
								</DetailField>
								<DetailField label={t.offer}>
									<Money amount={line.unit_price} currency={currency} />
								</DetailField>
								<DetailField label={c.goods}>
									<Money
										amount={moneyText(lineCents(line))}
										currency={currency}
									/>
								</DetailField>
								{line.max_quantity && (
									<>
										<DetailField label={t.maxQuantity}>
											<bdi>
												{line.max_quantity.replace(/\.000$/, "")} {product.unit}
											</bdi>
										</DetailField>
										<DetailField label={t.maxPrice}>
											<Money amount={line.max_unit_price} currency={currency} />
										</DetailField>
									</>
								)}
							</dl>
						</div>
					</div>
				);
			})}
			<div className="flex items-center justify-between gap-3 rounded-lg bg-page px-3 py-2">
				<span className="text-sm font-medium text-muted">{t.amount}</span>
				<Money
					amount={goodsTotal(proposal.lines)}
					currency={currency}
					className="text-base font-bold"
				/>
			</div>
			<p className="m-0 text-xs text-muted">
				{t.terms}: <bdi>{proposal.choice.country || "—"}</bdi> ·{" "}
				<span dir="auto">{proposal.choice.city || "—"}</span> ·{" "}
				{proposal.choice.method ? t[proposal.choice.method] : t.choose}
			</p>
			{proposal.note && (
				<p
					className="m-0 whitespace-pre-wrap rounded-xl border border-solid border-border p-3 text-sm leading-relaxed"
					dir="auto"
				>
					<span className="mb-1 block text-xs font-medium text-muted">
						{t.note}
					</span>
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
	embedded = false,
}: {
	locale: Locale;
	row: RequestRow;
	context: Context;
	seller: string;
	presentation?: "seller";
	params?: QueryReader;
	embedded?: boolean;
}) {
	const t = negotiationCopy[locale],
		sales = sellerSalesCopy[locale],
		sellerPresentation = context === "seller" && presentation === "seller";
	function historyHref(page: number) {
		const href = `${salesHref(locale, "negotiations", seller, row.id)}${seller ? "&" : "?"}history_page=${page}`;
		return params ? salesHistoryHref(href, params) : href;
	}
	if (sellerPresentation) {
		return (
			<section className={salesPanel}>
				{!embedded && (
					<h2 className="text-lg font-semibold">{sales.history}</h2>
				)}
				<p className="text-sm text-muted">
					{t.history} · {sales.results}:{" "}
					<bdi>{new Intl.NumberFormat(locale).format(row.history_count)}</bdi> ·{" "}
					{sales.page}{" "}
					<bdi>{new Intl.NumberFormat(locale).format(row.history_page)}</bdi>
				</p>
				{row.history.map((h, i) => (
					<details
						key={`${h.action}:${h.revision}:${h.version ?? i}`}
						className="min-w-0 space-y-3 rounded-xl border border-border p-3"
					>
						<summary className="min-h-11 cursor-pointer break-words text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action">
							{h.action === "buyer_proposal"
								? t.original
								: h.action === "resubmitted"
									? t.resubmitted
									: h.action in t
										? t[h.action as keyof typeof t]
										: t.history}{" "}
							· {t.version} <bdi>{h.version ?? h.revision}</bdi> ·{" "}
							<bdi>{localTimestamp(h.at, locale)}</bdi>
							{h.actor_name && (
								<>
									{" · "}
									<bdi>{h.actor_name}</bdi>
								</>
							)}
						</summary>
						<p className="whitespace-pre-wrap" dir="auto">
							{h.reason}
						</p>
						{h.proposal && (
							<ProposalSummary
								{...{ locale, currency: row.currency }}
								presentation="seller"
								proposal={h.proposal}
							/>
						)}{" "}
						{h.state?.final && (
							<>
								<h3>{t.final}</h3>
								<ProposalSummary
									{...{ locale, currency: row.currency }}
									presentation="seller"
									proposal={{ ...row.proposal, ...h.state.final }}
								/>
							</>
						)}
					</details>
				))}
				<nav aria-label={sales.history} className="flex flex-wrap gap-3">
					{[row.history_page - 1, row.history_page + 1]
						.filter((p) => p > 0 && p <= Math.ceil(row.history_count / 20))
						.map((p) => (
							<Link key={p} className={salesAction} href={historyHref(p)}>
								{p < row.history_page ? t.previous : t.next}
							</Link>
						))}
				</nav>
			</section>
		);
	}
	const nf = new Intl.NumberFormat(locale),
		last = Math.max(1, Math.ceil(row.history_count / 20)),
		pageHref = (page: number) => {
			const query = new URLSearchParams({
				history_page: String(page),
				...(seller ? { seller } : {}),
			});
			for (const key of ["list_page", "list_state", "list_q"]) {
				const value = params?.get(key);
				if (value) query.set(key, value);
			}
			return `${requestHref(locale, context, row.id)}?${query}`;
		},
		actionLabel = (action: string) =>
			action === "buyer_proposal"
				? t.original
				: action === "resubmitted"
					? t.resubmitted
					: action in t
						? t[action as keyof typeof t]
						: t.history;
	return (
		<section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 sm:p-5">
			{!embedded && (
				<div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-border pb-3">
					<h2 className="m-0 text-sm font-semibold">{t.history}</h2>
					<Badge
						variant="secondary"
						className="rounded-full border-0 bg-page text-muted"
					>
						{nf.format(row.history_count)}
					</Badge>
				</div>
			)}
			<div className="flex flex-col gap-2">
				{row.history.map((h, i) => (
					<details
						key={`${h.action}:${h.revision}:${h.version ?? i}`}
						className="group rounded-xl border border-solid border-border p-3"
					>
						<summary className="flex min-h-9 cursor-pointer flex-wrap items-center gap-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action">
							<StatusBadge variant={negotiationVariant(h.action)} size="sm">
								{actionLabel(h.action)}
							</StatusBadge>
							<span className="text-xs text-muted">
								{t.version} <bdi>{h.version ?? h.revision}</bdi> ·{" "}
								<bdi>{localTimestamp(h.at, locale)}</bdi>
							</span>
						</summary>
						<div className="mt-3 flex flex-col gap-3">
							{h.reason && (
								<p
									className="m-0 whitespace-pre-wrap text-sm leading-relaxed"
									dir="auto"
								>
									{h.reason}
								</p>
							)}
							{h.proposal && (
								<ProposalSummary
									locale={locale}
									currency={row.currency}
									proposal={h.proposal}
								/>
							)}
							{h.state?.final && (
								<div className="flex flex-col gap-2 rounded-xl bg-info p-3">
									<h3 className="m-0 text-sm font-semibold">{t.final}</h3>
									<ProposalSummary
										locale={locale}
										currency={row.currency}
										proposal={{ ...row.proposal, ...h.state.final }}
									/>
								</div>
							)}
						</div>
					</details>
				))}
			</div>
			{last > 1 && (
				<nav
					aria-label={t.history}
					className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border pt-3"
				>
					<Button
						asChild={row.history_page > 1}
						variant="outline"
						size="sm"
						className="rounded-lg"
						disabled={row.history_page <= 1}
					>
						{row.history_page > 1 ? (
							<Link href={pageHref(row.history_page - 1)}>
								<ChevronLeft className="size-4 rtl:rotate-180" />
								{t.previous}
							</Link>
						) : (
							<span>
								<ChevronLeft className="size-4 rtl:rotate-180" />
								{t.previous}
							</span>
						)}
					</Button>
					<span className="text-xs text-muted">
						{nf.format(row.history_page)} / {nf.format(last)}
					</span>
					<Button
						asChild={row.history_page < last}
						variant="outline"
						size="sm"
						className="rounded-lg"
						disabled={row.history_page >= last}
					>
						{row.history_page < last ? (
							<Link href={pageHref(row.history_page + 1)}>
								{t.next}
								<ChevronRight className="size-4 rtl:rotate-180" />
							</Link>
						) : (
							<span>
								{t.next}
								<ChevronRight className="size-4 rtl:rotate-180" />
							</span>
						)}
					</Button>
				</nav>
			)}
		</section>
	);
}
