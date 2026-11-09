"use client";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { AftercareWorkspace } from "../../../../../../../features/aftercare/workspace";

export function DisputesContent({ locale }: { locale: Locale }) {
	return <AftercareWorkspace locale={locale} context="seller" disputeList />;
}
