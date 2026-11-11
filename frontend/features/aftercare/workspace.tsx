"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Locale } from "../../lib/i18n/locales";
import { uuidPattern } from "../../lib/routes/account-routes";
import { useCommunicationSession } from "../messaging/hooks";
import { SessionEntry } from "../orders/components/session-entry";
import { aftercareDomain } from "./api";
import { aftercareCopy } from "./copy";
import type { Context } from "./types";
import { AftercareDetail } from "./components/detail";
import { AftercareList } from "./components/list";
import { DisputeList } from "./components/dispute-list";
import { SellerIssues } from "./components/seller-issues";

type Props = {
	locale: Locale;
	context: Context;
	orderId?: string;
	disputeId?: string;
	disputeList?: boolean;
	embedded?: boolean;
};

// Route integration owns the account shell. The boundary also makes this safe
// to embed in a prerendered route that does not already provide Suspense.
export function AftercareWorkspace(props: Props) {
	return (
		<Suspense
			fallback={<p role="status">{aftercareCopy[props.locale].loading}</p>}
		>
			<WorkspaceContent {...props} />
		</Suspense>
	);
}
function WorkspaceContent({
	locale,
	context,
	orderId,
	disputeId,
	disputeList,
	embedded,
}: Props) {
	const session = useCommunicationSession(context),
		query = useSearchParams(),
		t = aftercareCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return <SessionEntry {...{ locale, context, error: session.error }} />;
	const seller = context === "seller" ? (query.get("seller") ?? "") : "";
	const page = Number(query.get("page") ?? 1),
		attempt = query.get("aftercare_attempt");
	const attemptDomain = aftercareDomain(query.get("aftercare_domain"));
	if (
		(orderId !== undefined && !uuidPattern.test(orderId)) ||
		(disputeId !== undefined && !uuidPattern.test(disputeId)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt !== null && !uuidPattern.test(attempt)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000
	)
		return <p role="alert">{t.error}</p>;
	const account = session.session.accounts.find(
		(account) => account.context === context,
	);
	if (!account) return <p role="alert">{t.noAccess}</p>;
	const scope = `${session.session.identity.id}:${account.id}:${context}:${seller}:${disputeId ?? orderId ?? "list"}`;
	if (context === "seller")
		return orderId || disputeId ? (
			<AftercareDetail
				key={`${scope}:${locale}`}
				{...{
					locale,
					context,
					orderId: orderId ?? "",
					disputeId,
					embedded,
					seller,
					scope,
					attempt,
					attemptDomain,
				}}
			/>
		) : (
			<SellerIssues
				key={`${scope}:${locale}:${page}:${query.get("q") ?? ""}:${disputeList}:${query.get("issue_tab") ?? "attention"}`}
				locale={locale}
				seller={seller}
				page={page}
				search={query.get("q") ?? ""}
				initialTab={
					disputeList
						? "disputes"
						: query.get("issue_tab") === "cancellations"
							? "cancellations"
							: query.get("issue_tab") === "corrections"
								? "corrections"
								: query.get("issue_tab") === "refunds"
									? "refunds"
									: query.get("issue_tab") === "disputes"
										? "disputes"
										: "attention"
				}
			/>
		);
	return orderId || disputeId ? (
		<AftercareDetail
			key={`${scope}:${locale}`}
			{...{
				locale,
				context,
				orderId: orderId ?? "",
				disputeId,
				embedded,
				seller,
				scope,
				attempt,
				attemptDomain,
			}}
		/>
	) : disputeList ? (
		<DisputeList
			key={`${scope}:${locale}:${page}`}
			{...{ locale, context, seller, page }}
		/>
	) : (
		<AftercareList
			key={`${scope}:${locale}:${page}`}
			{...{ locale, context, seller, page }}
		/>
	);
}
