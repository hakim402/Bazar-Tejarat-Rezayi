import { Field, Input, CheckField } from "../../../components/ui/form-field";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
export function MfaChallengeFields({
	locale,
	secret,
	error,
}: {
	locale: Locale;
	secret: string;
	error: string;
}) {
	const t = authCopy[locale];
	return (
		<>
			{secret && (
				<>
					<p className="mt-3 mb-5">{t.enrollBody}</p>
					<code
						className="private-material setup-key block select-all wrap-anywhere rounded-control border border-border bg-info p-4 font-identifier"
						dir="ltr"
					>
						{secret}
					</code>
				</>
			)}
			<Field name="code" label={t.code}>
				<Input
					name="code"
					type="text"
					required
					autoComplete="one-time-code"
					dir="ltr"
					maxLength={32}
					aria-invalid={Boolean(error)}
					aria-describedby={error ? "account-error" : undefined}
				/>
			</Field>
			<CheckField name="recovery" label={t.recoveryCode} />
		</>
	);
}
export function RecoveryCodes({ codes }: { codes: readonly string[] }) {
	return (
		<div
			className="private-material recovery-codes grid grid-cols-2 gap-2.5 select-all wrap-anywhere rounded-control border border-border bg-info p-4 font-identifier"
			dir="ltr"
		>
			{codes.map((code) => (
				<code key={code}>{code}</code>
			))}
		</div>
	);
}
