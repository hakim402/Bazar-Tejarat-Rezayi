"use client";
import type { Context } from "../../messaging/api";
import type { Locale } from "../../../lib/i18n/locales";
import { RecordEvidence } from "../../../components/ui/record-evidence";
import { paymentCopy } from "../copy";

export function PaymentEvidence({
	id,
	context,
	locale,
}: {
	id: string;
	context: Context;
	locale: Locale;
}) {
	const t = paymentCopy[locale];
	return (
		<RecordEvidence
			id={id}
			context={context}
			domain="payments"
			copy={{ error: t.error, openImage: t.openImage, loading: t.loading }}
		/>
	);
}
