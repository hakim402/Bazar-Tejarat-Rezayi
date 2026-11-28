"use client";

import { Badge } from "@/components/shadcn/badge";
import { organizationCopy } from "@/lib/i18n/organizations";
import { reviewFlowCopy } from "@/lib/i18n/review-flow";
import type { Locale } from "@/lib/i18n/locales";
import type { Profile } from "../api/organizations";

export function ApprovalStatus({
	profile,
	locale,
}: {
	profile: Profile;
	locale: Locale;
}) {
	const t = reviewFlowCopy[locale];
	const labels = organizationCopy[locale];
	const approved = profile.effective_approval as {
		revision: number;
		details: Record<string, string>;
	} | null;
	const replacement = approved && approved.revision !== profile.revision;
	const rejected =
		profile.review_status === "rejected" ||
		profile.review_status === "needs_information";
	const pending = ["submitted", "under_review"].includes(profile.review_status);
	const message = rejected
		? t.rejected
		: pending
			? profile.entitlement
				? t.pending
				: t.firstPending
			: profile.review_status === "draft"
				? t.draft
				: profile.entitlement
					? t.approved
					: t.unavailable;
	return (
		<div className="space-y-2 text-sm" role="status">
			{profile.entitlement && replacement && (
				<Badge variant="secondary">{t.active}</Badge>
			)}
			<p className="m-0 leading-relaxed text-muted">{message}</p>
			{profile.review_status === "draft" && (
				<p className="m-0 text-muted">
					{t[profile.kind as "individual" | "company" | "business"]}
				</p>
			)}
			{rejected && replacement && profile.entitlement && (
				<p className="m-0 text-muted">{t.retained}</p>
			)}
			{rejected && profile.review_reason && (
				<p className="m-0 whitespace-pre-wrap break-words">
					{t.reason} · {profile.review_reason}
				</p>
			)}
			{approved && replacement && profile.can_manage && (
				<details className="border-0 border-t border-solid border-border pt-2">
					<summary className="cursor-pointer py-1 font-medium text-action">
						{t.approvedDetails} · {t.revision}{" "}
						{new Intl.NumberFormat(locale).format(approved.revision)}
					</summary>
					<dl className="m-0 divide-y divide-border">
						{Object.entries(approved.details)
							.filter(([, value]) => typeof value === "string" && value.trim())
							.map(([key, value]) => (
								<div
									key={key}
									className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-2"
								>
									<dt className="text-muted">
										{labels[key as keyof typeof labels] ?? key}
									</dt>
									<dd className="m-0 break-words">
										<bdi>{value}</bdi>
									</dd>
								</div>
							))}
					</dl>
				</details>
			)}
		</div>
	);
}
