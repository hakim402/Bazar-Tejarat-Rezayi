"use client";
import type { Context } from "../../messaging/api";
import type { Locale } from "../../../lib/i18n/locales";
import { RecordEvidence } from "../../../components/ui/record-evidence";
import { fulfilmentCopy } from "../copy";

export function DeliveryEvidence({
	id,
	context,
	locale,
}: {
	id: string;
	context: Context;
	locale: Locale;
}) {
	const t = fulfilmentCopy[locale];
	return (
		<RecordEvidence
			id={id}
			context={context}
			domain="fulfilment"
			copy={{ error: t.error, openImage: t.openImage, loading: t.loading }}
		/>
	);
}
