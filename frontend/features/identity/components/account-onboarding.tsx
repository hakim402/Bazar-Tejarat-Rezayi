"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import type { Locale } from "@/lib/i18n/locales";
import { verificationCodeCopy } from "@/lib/i18n/verification-code";
import { reviewFlowCopy } from "@/lib/i18n/review-flow";
import {
	orgRequest,
	profilePath,
	type Profile,
} from "@/features/organizations/api/organizations";
import { useCommunicationSession } from "@/features/messaging/hooks";
import type { AccountContext } from "../api/accounts";

export function AccountOnboarding({
	locale,
	context,
}: {
	locale: Locale;
	context: AccountContext;
}) {
	const session = useCommunicationSession(context);
	const [profiles, setProfiles] = useState<Profile[]>();
	const t = reviewFlowCopy[locale];
	useEffect(() => {
		if (!session.session) return;
		const controller = new AbortController();
		orgRequest<{ profiles: Profile[] }>(
			profilePath(context),
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((data) => setProfiles(data.profiles))
			.catch(() => {
				if (!controller.signal.aborted) setProfiles(undefined);
			});
		return () => controller.abort();
	}, [context, session.session]);
	if (
		!session.session ||
		!profiles ||
		profiles.some((profile) => profile.entitlement)
	)
		return null;
	const hasBusiness = profiles.length > 0;
	const pending = profiles.some((profile) =>
		["submitted", "under_review"].includes(profile.review_status),
	);
	return (
		<aside
			className="space-y-2 border-0 border-s-2 border-solid border-action ps-4 text-sm"
			role="status"
		>
			<p className="m-0 font-semibold">
				{verificationCodeCopy[locale][context]}
			</p>
			<p className="m-0 leading-relaxed text-muted">
				{pending
					? t.firstPending
					: hasBusiness
						? t.draft
						: context === "buyer"
							? t.buyer
							: t.individual}
			</p>
			<Button asChild variant="link" className="h-auto px-0">
				<Link href={`/${locale}/account/${context}/organizations`}>
					{t.open}
				</Link>
			</Button>
		</aside>
	);
}
