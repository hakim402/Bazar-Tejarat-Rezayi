import type { Locale } from "../../../lib/i18n/locales";
import type { FinalPreviewResult, Proposal } from "../api";
import { negotiationCopy } from "../copy";
import { ProposalSummary } from "./history";

export function FinalizationReview({
	locale,
	currency,
	preview,
	reason,
}: {
	locale: Locale;
	currency: string;
	preview: FinalPreviewResult;
	reason: string;
}) {
	const t = negotiationCopy[locale];
	const final: Proposal = {
		...preview.proposal,
		...preview.final,
		lines: preview.proposal.lines.map((line) => ({
			...line,
			...preview.final.lines.find(
				(p) => p.variant === line.variant && p.tier === line.tier,
			),
		})),
	};
	return (
		<section className="space-y-4" aria-label={t.difference}>
			<h2 className="font-bold">{t.difference}</h2>
			<div className="grid gap-4 sm:grid-cols-2">
				<section className="min-w-0 space-y-3" aria-label={t.original}>
					<h3 className="font-bold">{t.original}</h3>
					<ProposalSummary
						locale={locale}
						currency={currency}
						proposal={preview.proposal}
					/>
				</section>
				<section className="min-w-0 space-y-3" aria-label={t.final}>
					<h3 className="font-bold">{t.final}</h3>
					<ProposalSummary
						locale={locale}
						currency={currency}
						proposal={final}
					/>
				</section>
			</div>
			<p className="font-bold" data-testid="finalization-total">
				{t.amount}:{" "}
				<bdi>
					{preview.goods_total} {currency}
				</bdi>
			</p>
			<p className="whitespace-pre-wrap break-words" dir="auto">
				{t.reason}: {reason}
			</p>
		</section>
	);
}
