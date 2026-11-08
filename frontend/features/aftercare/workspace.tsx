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

type Props = { locale: Locale; context: Context; orderId?: string };

// Route integration owns the account shell. The boundary also makes this safe
// to embed in a prerendered route that does not already provide Suspense.
export function AftercareWorkspace(props: Props) {
	return <Suspense fallback={<p role="status">{aftercareCopy[props.locale].loading}</p>}><WorkspaceContent {...props} /></Suspense>;
}
function WorkspaceContent({ locale, context, orderId }: Props) {
	const session = useCommunicationSession(context), query = useSearchParams(), t = aftercareCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session) return <SessionEntry {...{ locale, context, error: session.error }} />;
	const seller = context === "seller" ? query.get("seller") ?? "" : "";
	const page = Number(query.get("page") ?? 1), attempt = query.get("aftercare_attempt");
	const attemptDomain = aftercareDomain(query.get("aftercare_domain"));
	if ((orderId !== undefined && !uuidPattern.test(orderId)) || (seller && !uuidPattern.test(seller)) || (attempt !== null && !uuidPattern.test(attempt)) || !Number.isInteger(page) || page < 1 || page > 10000) return <p role="alert">{t.error}</p>;
	const account = session.session.accounts.find((account) => account.context === context) ?? session.session.accounts[0];
	if (!account) return <p role="alert">{t.noAccess}</p>;
	const scope = `${session.session.identity.id}:${account.id}:${context}:${seller}:${orderId ?? "list"}`;
	return orderId ? <AftercareDetail key={`${scope}:${locale}`} {...{ locale, context, orderId, seller, scope, attempt, attemptDomain }} />
		: <AftercareList key={`${scope}:${locale}:${page}`} {...{ locale, context, seller, page }} />;
}
