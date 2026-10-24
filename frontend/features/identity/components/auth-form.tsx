"use client";
import { useId } from "react";
import Link from "next/link";
import { Button } from "../../../components/ui/button";
import { Field, Input } from "../../../components/ui/form-field";
import { Alert } from "../../../components/ui/alert";
import { AccountHeading } from "./account-heading";
import { MfaChallengeFields, RecoveryCodes } from "./mfa-challenge-fields";
import { PublicAuthForm } from "./public-auth-form";
import { useAuthFlow } from "../hooks/use-auth-flow";
import { GoogleResult } from "./google-result";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
import { screenTitle, type AuthScreen } from "../../../lib/i18n/auth-screens";

export function AuthForm({
	locale,
	screen,
	audience = "buyer",
}: {
	locale: Locale;
	screen: AuthScreen;
	audience?: "buyer" | "seller";
}) {
	const t = authCopy[locale],
		prefix = useId(),
		errorId = `${prefix}-error`,
		flow = useAuthFlow(locale, screen);
	const {
		context,
		register,
		signin,
		busy,
		error,
		notice,
		stage,
		secret,
		codes,
		setCodes,
		token,
		alertRef,
		completeSignin,
		handleSubmit,
	} = flow;
	const privileged = Boolean(stage) || screen === "mfa";
	if (screen === "google-result") return <GoogleResult locale={locale} />;
	if (!privileged && context !== "staff" && (register || signin))
		return <PublicAuthForm locale={locale} screen={screen} flow={flow} />;
	const field = (name: string, label: string, type = "text", auto = "") => (
		<Field id={`${prefix}-${name}`} name={name} label={label} key={name}>
			<Input
				name={name}
				id={`${prefix}-${name}`}
				type={type}
				required
				maxLength={name === "email" ? 254 : 128}
				minLength={name === "password" && !signin ? 12 : undefined}
				autoComplete={auto || undefined}
				dir="ltr"
				aria-invalid={Boolean(error)}
				aria-describedby={error ? errorId : undefined}
			/>
		</Field>
	);
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
							id={errorId}
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
										errorId={errorId}
										error={error}
									/>
								)
							) : (
								<>
									{screen === "staff-sign-in" && (
										<p className="mt-3 mb-5">{t.staffNote}</p>
									)}
									{(signin ||
										screen === "forgot-password" ||
										(screen === "verify-email" && !token)) &&
										field("email", t.email, "email", "username")}
									{(signin || screen === "reset-password") &&
										field(
											"password",
											screen === "reset-password" ? t.newPassword : t.password,
											"password",
											signin ? "current-password" : "new-password",
										)}
									{screen === "reset-password" && (
										<>
											<p className="mt-3 mb-5 text-base text-muted">
												{t.passwordHelp}
											</p>
											{field("repeat", t.repeat, "password", "new-password")}
											<p className="mt-3 mb-5">{t.shared}</p>
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
				</>
			)}
			{!privileged && !signin && (
				<nav className="account-links mt-5 text-sm font-medium">
					<Link href={`/${locale}/auth/${audience}-sign-in`}>
						{t.backSignin}
					</Link>
				</nav>
			)}
		</>
	);
}
