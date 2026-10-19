import type { SessionData } from "../api/accounts";
import type { Locale } from "../../../lib/i18n/locales";
import { authCopy } from "../../../lib/i18n/auth";
export function AccountSummary({
	data,
	locale,
}: {
	data: SessionData;
	locale: Locale;
}) {
	const t = authCopy[locale],
		account = data.accounts[0];
	const status = (value: string) =>
		Object.hasOwn(t, value) ? t[value as keyof typeof t] : value;
	const fields = [
		{
			key: "email",
			label: t.email,
			value: <bdi dir="ltr">{data.identity.email}</bdi>,
		},
		{ key: "id", label: t.accountId, value: <bdi dir="ltr">{account.id}</bdi> },
		{
			key: "verified",
			label: t.emailStatus,
			value: data.identity.email_verified ? t.verifiedLabel : t.verify,
		},
		{ key: "status", label: t.accountStatus, value: status(account.status) },
		{ key: "intent", label: t.intent, value: status(account.intent) },
		{
			key: "review",
			label: t.reviewStatus,
			value: status(account.review_status),
		},
	];
	return (
		<dl className="account-summary my-6">
			{fields.map((field) => (
				<div
					key={field.key}
					className="grid grid-cols-1 gap-1 border-b border-border py-3 desktop:grid-cols-[11.25rem_minmax(0,1fr)] desktop:gap-4"
				>
					<dt className="text-muted">{field.label}</dt>
					<dd className="m-0 wrap-anywhere">{field.value}</dd>
				</div>
			))}
		</dl>
	);
}
