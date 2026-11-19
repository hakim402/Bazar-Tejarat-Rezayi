import { ChevronDown } from "lucide-react";
import type { SessionData } from "../../features/identity/api/accounts";
import type { ProfileIdentity } from "../../features/identity/api/profile";
import { languageNames, type Locale } from "../../lib/i18n/locales";
import { authCopy } from "../../lib/i18n/auth";
import { buyerProfileCopy } from "../../lib/i18n/buyer-profile";
import { sellerAccountSettingsCopy } from "../../lib/i18n/seller-account-settings";
import { Button } from "../shadcn/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../shadcn/collapsible";

export function AccountSummary({
	data,
	locale,
}: {
	data: SessionData & { identity: ProfileIdentity };
	locale: Locale;
}) {
	const t = authCopy[locale],
		p = buyerProfileCopy[locale],
		copy = sellerAccountSettingsCopy[locale];
	const account = data.accounts[0],
		identity = data.identity;
	const status = (value: string) =>
		Object.hasOwn(t, value) ? t[value as keyof typeof t] : value;
	const genders = {
		male: p.genderMale,
		female: p.genderFemale,
		other: p.genderOther,
		prefer_not_to_say: p.genderPreferNot,
	};
	const personal = [
		{
			key: "fullName",
			label: p.fullName,
			value: [identity.first_name, identity.last_name]
				.filter(Boolean)
				.join(" "),
		},
		{ key: "displayName", label: p.displayName, value: identity.display_name },
		{ key: "phone", label: p.phone, value: identity.phone },
		{
			key: "gender",
			label: p.gender,
			value: identity.gender ? genders[identity.gender] : "",
		},
		{
			key: "birth",
			label: p.dateOfBirth,
			value: identity.date_of_birth
				? new Intl.DateTimeFormat(locale, {
						year: "numeric",
						month: "long",
						day: "numeric",
					}).format(new Date(`${identity.date_of_birth}T00:00:00`))
				: "",
		},
		{
			key: "language",
			label: p.preferredLanguage,
			value: identity.preferred_locale
				? languageNames[identity.preferred_locale]
				: p.noLanguage,
		},
		{ key: "bio", label: p.bio, value: identity.bio },
	];
	const details = [
		{ key: "id", label: t.accountId, value: account.id },
		{
			key: "verified",
			label: t.emailStatus,
			value: identity.email_verified ? t.verifiedLabel : p.notVerified,
		},
		{ key: "status", label: t.accountStatus, value: status(account.status) },
		{ key: "intent", label: t.intent, value: status(account.intent) },
		{
			key: "review",
			label: t.reviewStatus,
			value: status(account.review_status),
		},
	];
	const rows = (fields: { key: string; label: string; value: string }[]) => (
		<dl className="account-summary m-0 divide-y divide-border">
			{fields.map((field) => (
				<div
					key={field.key}
					className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4"
				>
					<dt className="text-sm text-muted">{field.label}</dt>
					<dd className="m-0 whitespace-pre-wrap text-sm font-medium wrap-anywhere">
						{field.value ? (
							<bdi
								dir={
									field.key === "phone" || field.key === "id" ? "ltr" : "auto"
								}
							>
								{field.value}
							</bdi>
						) : (
							<span className="font-normal text-muted">{p.notAdded}</span>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
	return (
		<>
			{rows(personal)}
			<Collapsible className="border-0 border-t border-solid border-border py-2">
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className="w-full justify-between px-0 text-muted [&[data-state=open]>svg]:rotate-180"
					>
						{copy.summary}
						<ChevronDown className="size-4" aria-hidden="true" />
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<p className="m-0 py-2 text-xs text-muted">{copy.summaryHelp}</p>
					{rows(details)}
				</CollapsibleContent>
			</Collapsible>
		</>
	);
}
