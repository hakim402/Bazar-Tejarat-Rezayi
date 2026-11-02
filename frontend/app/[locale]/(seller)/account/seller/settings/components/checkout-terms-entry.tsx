"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { uuidPattern } from "../../../../../../../lib/routes/account-routes";
import { commerceCopy } from "../../../../../../../features/orders/copy";
export function CheckoutTermsEntry({ locale }: { locale: Locale }) {
	const seller = useSearchParams().get("seller");
	return (
		<Link
			className="mt-6 inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-5 font-bold"
			href={`/${locale}/account/seller/settings/checkout${seller && uuidPattern.test(seller) ? `?seller=${seller}` : ""}`}
		>
			{commerceCopy[locale].terms}
		</Link>
	);
}
