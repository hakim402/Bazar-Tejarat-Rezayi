"use client";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { AftercareWorkspace } from "../../../../../../../../features/aftercare/workspace";
import { BuyerFrame } from "../../../components/buyer-ui";

export function DisputeDetailContent({ locale, disputeId }: { locale: Locale; disputeId: string }) {
	return <BuyerFrame><AftercareWorkspace locale={locale} context="buyer" disputeId={disputeId} /></BuyerFrame>;
}
