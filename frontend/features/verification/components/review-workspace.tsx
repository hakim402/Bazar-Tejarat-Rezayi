"use client";
import { organizationCopy } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { WorkspaceNav } from "../../organizations/components/workflow-state";
import { CaseDetail } from "./case-detail";
import { CaseQueue } from "./case-queue";
import { TransferDetail, Transfers } from "./transfer-review";
export function ReviewWorkspace({
	locale,
	area,
	id,
}: {
	locale: Locale;
	area: string;
	id?: string;
}) {
	const t = organizationCopy[locale];
	return (
		<>
			<h1 className="text-3xl font-bold">
				{area === "verification" ? t.review : t.transferReview}
			</h1>
			<WorkspaceNav locale={locale} context="staff" />
			{area === "verification" ? (
				id ? (
					<CaseDetail locale={locale} id={id} />
				) : (
					<CaseQueue locale={locale} />
				)
			) : id ? (
				<TransferDetail locale={locale} id={id} />
			) : (
				<Transfers locale={locale} />
			)}
		</>
	);
}
