"use client";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AftercareWorkspace } from "../../../../../../../features/aftercare/workspace";
import { BuyerFrame } from "../../components/buyer-ui";

export function DisputesContent({ locale }: { locale: Locale }) {
	return <BuyerFrame><AftercareWorkspace locale={locale} context="buyer" disputeList /></BuyerFrame>;
}
