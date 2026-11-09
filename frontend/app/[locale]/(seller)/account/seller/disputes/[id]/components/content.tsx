"use client";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { AftercareWorkspace } from "../../../../../../../../features/aftercare/workspace";

export function DisputeDetailContent({ locale, disputeId }: { locale: Locale; disputeId: string }) {
	return <AftercareWorkspace locale={locale} context="seller" disputeId={disputeId} />;
}
