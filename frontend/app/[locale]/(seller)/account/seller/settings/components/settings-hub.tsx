"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { sellerSettingsCopy } from "../../../../../../../lib/i18n/seller-settings";
import { authCopy } from "../../../../../../../lib/i18n/auth";
import {
	useCommunicationSession,
	accessLost,
} from "../../../../../../../features/messaging/hooks";
import { EmailPreference } from "../../../../../../../features/notifications/components/email-preference";
import { CloseAccount } from "../../../../../../../components/accounts/close-account";
import {
	BusinessSection,
	useSettingsGuard,
} from "../../../../../../../components/accounts/seller-settings-ui";
import { Button } from "../../../../../../../components/shadcn/button";
import { Icon } from "../../../../../../../components/ui/icon";
import { Alert } from "../../../../../../../components/ui/alert";

export function SettingsHub({ locale }: { locale: Locale }) {
	const session = useCommunicationSession("seller");
	const seller = useSearchParams().get("seller") ?? "";
	const t = sellerSettingsCopy[locale];
	if (session.loading)
		return (
			<p
				role="status"
				className="rounded-2xl border border-border bg-surface p-6 text-muted"
			>
				{t.loading}
			</p>
		);
	if (!session.session)
		return (
			<div className="space-y-4">
				<Alert variant="danger">
					{accessLost(session.error)
						? authCopy[locale].anonymous
						: authCopy[locale].unavailable}
				</Alert>
				<Button asChild variant="outline" size="sm">
					<Link href={`/${locale}/auth/seller-sign-in`}>
						{authCopy[locale].backSignin}
					</Link>
				</Button>
			</div>
		);
	return (
		<Hub
			key={`${locale}:${session.session.identity.id}:${session.session.accounts[0].id}:${seller}`}
			locale={locale}
		/>
	);
}

function Hub({ locale }: { locale: Locale }) {
	const t = sellerSettingsCopy[locale];
	const [emailDirty, setEmailDirty] = useState(false);
	const guard = useSettingsGuard(locale, emailDirty);
	return (
		<div className="space-y-4">
			{guard.feedback}
			<EmailPreference
				locale={locale}
				context="seller"
				sellerSettings
				onDirtyChange={setEmailDirty}
				onNavigate={guard.choose}
			/>
			<BusinessSection
				id="privacy"
				title={t.privacy}
				description={t.privacyHelp}
				icon="lock"
			>
				<Button asChild variant="outline" size="sm">
					<Link href={`/${locale}/privacy`}>
						{t.policy}
						<Icon name="arrow" className="size-4" />
					</Link>
				</Button>
			</BusinessSection>
			<CloseAccount locale={locale} context="seller" flat />
		</div>
	);
}
