"use client";
import { VerificationCode } from "./verification-code";
import { useId } from "react";
import Link from "next/link";
import { Button } from "../shadcn/button";
import { Input } from "../shadcn/input";
import { FormField } from "../ui/dialog-form";
import { PasswordField } from "./password-field";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import { PublicAuthForm } from "./public-auth-form";
import { useAuthFlow } from "@/features/identity/hooks/use-auth-flow";
import { GoogleResult } from "./google-result";
import { authCopy } from "@/lib/i18n/auth";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import type { Locale } from "@/lib/i18n/locales";
import { screenTitle, type AuthScreen } from "@/lib/i18n/auth-screens";

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
		f = authFeedback[locale],
		id = useId(),
		flow = useAuthFlow(locale, screen, audience);
	const {
		busy,
		error,
		notice,
		token,
		alertRef,
		handleSubmit,
		fieldErrors,
		wait,
	} = flow;
	if (screen === "google-result") return <GoogleResult locale={locale} />;
	if (!flow.ready) return <p role="status">{t.loading}</p>;
	if (flow.completed)
		return (
			<>
				<AccountHeading>{screenTitle(locale, screen)}</AccountHeading>
				<Alert variant="success" role="status">
					{notice}
				</Alert>
				<Button asChild className="min-h-11 w-full">
					<Link href={flow.href(`${flow.context}-sign-in`)}>{t.signin}</Link>
				</Button>
			</>
		);
	if (screen === "verify-email" && (!token || flow.invalidToken))
		return (
			<>
				<AccountHeading>{t.verify}</AccountHeading>
				{flow.invalidToken && (
					<Alert variant="danger" role="alert">
						{f.linkInvalid}
					</Alert>
				)}
				<VerificationCode
					locale={locale}
					context={audience}
					pending={flow.pendingVerification}
					returnTo={flow.href(`${flow.context}-sign-in`)}
					key={flow.pendingVerification?.email ?? "email"}
				/>
			</>
		);
	if (flow.register || flow.signin)
		return <PublicAuthForm locale={locale} screen={screen} flow={flow} />;
	const missingReset =
		screen === "reset-password" && (!token || flow.invalidToken);
	return (
		<>
			<AccountHeading>{screenTitle(locale, screen)}</AccountHeading>
			{screen === "policy-draft" ? (
				<Alert variant="info">{t.policy}</Alert>
			) : (
				<>
					<p className="m-0 mb-5 text-sm leading-relaxed text-muted">
						{screen === "forgot-password"
							? f.recovery
							: screen === "reset-password"
								? f.reset
								: t.verify}
					</p>
					{error && (
						<Alert variant="danger" role="alert" ref={alertRef} tabIndex={-1}>
							{error}
						</Alert>
					)}
					{notice && (
						<Alert variant="success" role="status">
							{notice}
						</Alert>
					)}
					{missingReset ? (
						<div className="space-y-4">
							<p role="status" className="text-sm">
								{f.linkInvalid}
							</p>
							<Button asChild className="min-h-11 w-full">
								<Link href={flow.href("forgot-password")}>
									{f.anotherEmail}
								</Link>
							</Button>
						</div>
					) : (
						<form
							className="space-y-4"
							onSubmit={handleSubmit}
							aria-busy={busy}
						>
							{screen === "forgot-password" && (
								<FormField
									id={`${id}-email`}
									label={t.email}
									required
									error={fieldErrors.email}
								>
									<Input
										id={`${id}-email`}
										name="email"
										type="email"
										required
										maxLength={254}
										autoComplete="username"
										dir="ltr"
										disabled={busy}
										className="min-h-11 text-base"
										aria-invalid={!!fieldErrors.email}
										aria-describedby={
											fieldErrors.email ? `${id}-email-error` : undefined
										}
									/>
								</FormField>
							)}
							{screen === "reset-password" && (
								<>
									<PasswordField
										id={`${id}-password`}
										name="password"
										label={t.newPassword}
										required
										minLength={12}
										autoComplete="new-password"
										help={t.passwordHelp}
										error={fieldErrors.password}
										disabled={busy}
										showLabel={f.show}
										hideLabel={f.hide}
									/>
									<PasswordField
										id={`${id}-repeat`}
										name="repeat"
										label={t.repeat}
										required
										minLength={12}
										autoComplete="new-password"
										error={fieldErrors.repeat}
										disabled={busy}
										showLabel={f.show}
										hideLabel={f.hide}
									/>
								</>
							)}
							<Button
								className="min-h-11 w-full"
								disabled={busy || wait > 0}
								type="submit"
							>
								{busy
									? t.saving
									: screen === "verify-email"
										? t.verifyAction
										: t.submit}
								{wait > 0 &&
									` · ${new Intl.NumberFormat(locale).format(wait)} ${f.seconds}`}
							</Button>
						</form>
					)}
				</>
			)}
			<nav className="account-links mt-5 text-center text-sm font-medium">
				<Link href={flow.href(`${flow.context}-sign-in`)}>{t.backSignin}</Link>
			</nav>
		</>
	);
}
