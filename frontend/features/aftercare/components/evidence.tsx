"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { PaymentEvidence } from "../../payments/components/evidence";
import { DeliveryEvidence } from "../../fulfilment/components/evidence";
import type { Context, Domain } from "../types";

export function AftercareEvidence({ locale, context, domain, id }: { locale: Locale; context: Context; domain: Domain; id: string }) {
	return domain === "payments" ? <PaymentEvidence {...{ locale, context, id }} /> : domain === "fulfilment" ? <DeliveryEvidence {...{ locale, context, id }} /> : null;
}
