"use client";
import { Button } from "../../../components/ui/button";
import { Field, Input, CheckField } from "../../../components/ui/form-field";
import { Alert } from "../../../components/ui/alert";
import { AccountHeading } from "./account-heading";
import Link from "next/link";
import { MfaChallengeFields, RecoveryCodes } from "./mfa-challenge-fields";
import { IntentPicker } from "./intent-picker";
import { useAuthFlow } from "../hooks/use-auth-flow";
import { GoogleButton } from "./google-entry";
import { GoogleResult } from "./google-result";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
import { screenTitle, type AuthScreen } from "../../../lib/i18n/auth-screens";

export function AuthForm({
	locale,
	screen,
}: {
	locale: Locale;
	screen: AuthScreen;
}) {
	const t = authCopy[locale];
	const {
		context,
		register,
		signin,
		busy,
		error,
		notice,
		intent,
		setIntent,
		stage,
		secret,
		codes,
		setCodes,
		token,
		alertRef,
		completeSignin,
		handleSubmit,
	} = useAuthFlow(locale, screen);
	const field = (key: string, label: string, type = "text", auto = "") => (
		<Field name={key} label={label} key={key}>
			<Input
				name={key}
				type={type}
				required
				maxLength={key === "email" ? 254 : key === "display_name" ? 150 : 128}
				minLength={key === "password" && !signin ? 12 : undefined}
				autoComplete={auto || undefined}
				dir={key === "display_name" ? undefined : "ltr"}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? "account-error" : undefined}
			/>
		</Field>
	);
	const privileged = Boolean(stage) || screen === "mfa";
	if (screen === "google-result") return <GoogleResult locale={locale} />;
	return (
		<>
			<AccountHeading>
				{privileged ? t.mfa : screenTitle(locale, screen)}
			</AccountHeading>
			{screen === "policy-draft" ? (
				<Alert variant="info">{t.policy}</Alert>
			) : (
				<>
					{error && (
						<Alert
							variant="danger"
							id="account-error"
							role="alert"
							ref={alertRef}
							tabIndex={-1}
						>
							{error}
						</Alert>
					)}
					{notice && (
						<Alert variant="success" role="status">
							{notice}
						</Alert>
					)}
					{codes.length > 0 ? (
						<>
							<p className="mt-3 mb-5">{t.saveCodes}</p>
							<RecoveryCodes codes={codes} />
							<Button
								type="button"
								onClick={() => {
									setCodes([]);
									completeSignin();
								}}
							>
								{t.codesSaved}
							</Button>
						</>
					) : (
						<form
							className="flex flex-col gap-2"
							onSubmit={handleSubmit}
							aria-busy={busy}
						>
							{privileged ? (
								stage === "enroll" ? (
									<>
										<p className="mt-3 mb-5">{t.enrollBody}</p>
										<input type="hidden" name="action" value="enroll" />
									</>
								) : (
									<MfaChallengeFields
										locale={locale}
										secret={secret}
										error={error}
									/>
								)
							) : (
								<>
									{register && (
										<>
											<p className="mt-3 mb-5">
												{context === "seller" ? t.sellerNote : t.buyerNote}
											</p>
											<IntentPicker
												locale={locale}
												context={context === "seller" ? "seller" : "buyer"}
												value={intent}
												onChange={setIntent}
											/>
											{field("display_name", t.name, "text", "name")}
										</>
									)}
									{screen === "staff-sign-in" && (
										<p className="mt-3 mb-5">{t.staffNote}</p>
									)}
									{(register ||
										signin ||
										screen === "forgot-password" ||
										(screen === "verify-email" && !token)) &&
										field("email", t.email, "email", "username")}
									{(register || signin || screen === "reset-password") &&
										field(
											"password",
											screen === "reset-password" ? t.newPassword : t.password,
											"password",
											signin ? "current-password" : "new-password",
										)}
									{(register || screen === "reset-password") && (
										<p className="account-hint mt-3 mb-5 text-base text-muted">
											{t.passwordHelp}
										</p>
									)}
									{screen === "reset-password" && (
										<>
											{field("repeat", t.repeat, "password", "new-password")}
											<p className="mt-3 mb-5">{t.shared}</p>
										</>
									)}
									{register && (
										<>
											<CheckField
												label={t.consent}
												name="consent"
												type="checkbox"
												required
											/>
											<Link href={`/${locale}/auth/policy-draft`}>
												{t.draftLink}
											</Link>
											<Alert variant="info">{t.policy}</Alert>
										</>
									)}
									{signin && (
										<Link
											className="forgot-link mt-1 mb-3 font-bold"
											href={`/${locale}/auth/forgot-password`}
										>
											{t.forgot}
										</Link>
									)}
									{screen === "verify-email" && (
										<p className="mt-3 mb-5">
											{token ? t.verify : t.invalidLink}
										</p>
									)}
								</>
							)}
							<Button disabled={busy} type="submit">
								{busy
									? t.saving
									: stage === "enroll"
										? t.beginEnroll
										: register
											? t.register
											: signin && !privileged
												? t.signin
												: screen === "verify-email"
													? token
														? t.verifyAction
														: t.resend
													: t.submit}
							</Button>
						</form>
					)}
					{!privileged && context !== "staff" && (register || signin) && (
						<GoogleButton
							locale={locale}
							context={context}
							action={register ? "register" : "signin"}
						/>
					)}
					{!privileged && (
						<nav className="account-links mt-7 flex flex-col gap-3.5 text-base font-bold">
							{signin && context !== "staff" && (
								<Link href={`/${locale}/auth/${context}-registration`}>
									{t.newAccount}
								</Link>
							)}
							{register && (
								<Link href={`/${locale}/auth/${context}-sign-in`}>
									{t.existing}
								</Link>
							)}
							{register && notice && (
								<Link href={`/${locale}/auth/verify-email`}>{t.verify}</Link>
							)}
							{register && (
								<>
									<p className="account-hint mt-3 mb-5 text-base text-muted">
										{t.otherRole}
									</p>
									<Link
										href={`/${locale}/auth/${context === "buyer" ? "seller" : "buyer"}-sign-in`}
									>
										{context === "buyer" ? t.sellerSignin : t.buyerSignin}
									</Link>
								</>
							)}
							{!register && !signin && (
								<>
									<Link href={`/${locale}/auth/buyer-sign-in`}>
										{t.buyerSignin}
									</Link>
									<Link href={`/${locale}/auth/seller-sign-in`}>
										{t.sellerSignin}
									</Link>
								</>
							)}
						</nav>
					)}
				</>
			)}
		</>
	);
}
