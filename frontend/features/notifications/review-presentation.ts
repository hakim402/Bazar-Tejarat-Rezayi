import type { Locale } from "@/lib/i18n/locales";
import { reviewFlowCopy } from "@/lib/i18n/review-flow";
import type { Context } from "../messaging/api";
import type { Notices } from "./api";

export function reviewNoticeDetails(
	row: Notices["results"][number],
	locale: Locale,
	context: Context,
) {
	if (row.kind !== "business_review" && row.kind !== "product_review")
		return null;
	const t = reviewFlowCopy[locale];
	return {
		href:
			row.kind === "business_review"
				? `/${locale}/account/${context}/organizations/${row.profile}`
				: `/${locale}/account/seller/catalogue/${row.product}`,
		title: `${row.kind === "business_review" ? t.verification : t.product} · ${row.action === "approved" ? t.published : t.declined}`,
	};
}
