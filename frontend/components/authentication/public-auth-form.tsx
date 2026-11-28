"use client";
import { VerificationCode } from "./verification-code";
import { useId } from "react";
import Link from "next/link";
import { authCopy } from "@/lib/i18n/auth";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import { screenTitle, type AuthScreen } from "@/lib/i18n/auth-screens";
import type { Locale } from "@/lib/i18n/locales";
import { FormField } from "../ui/dialog-form";
import { Input } from "../shadcn/input";
import { Button } from "../shadcn/button";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import { GoogleButton } from "./google-entry";
import { PasswordField } from "./password-field";
import { RegistrationConsent } from "./registration-consent";
import type { useAuthFlow } from "@/features/identity/hooks/use-auth-flow";
export function PublicAuthForm({
	locale,
	screen,
	flow,
}: {
	locale: Locale;
	screen: AuthScreen;
	flow: ReturnType<typeof useAuthFlow>;
}) {
	const t = authCopy[locale],
		f = authFeedback[locale],
		id = useId(),
		role = flow.context;
	const {
		register,
		busy,
		error,
		notice,
		alertRef,
		handleSubmit,
		fieldErrors,
		wait,
	} = flow;
	const field = (name: string, label: string, type = "text", auto = "") => (
		<FormField
			key={name}
			id={`${id}-${name}`}
			label={label}
			required
			error={fieldErrors[name]}
		>
			<Input
				id={`${id}-${name}`}
				name={name}
				type={type}
				required
				autoComplete={auto}
				dir={name === "display_name" ? undefined : "ltr"}
				maxLength={name === "email" ? 254 : 150}
				disabled={busy}
				className="min-h-11 text-base"
				aria-invalid={!!fieldErrors[name]}
				aria-describedby={fieldErrors[name] ? `${id}-${name}-error` : undefined}
			/>
		</FormField>
	);
	if (register && flow.pendingVerification)
		return (
			<>
				<AccountHeading compact>{t.verify}</AccountHeading>
				<VerificationCode
					locale={locale}
					context={role}
					pending={flow.pendingVerification}
					returnTo={flow.href(`${role}-sign-in`)}
				/>
			</>
		);
	return (
		<>
			<AccountHeading compact>{screenTitle(locale, screen)}</AccountHeading>
			<p className="m-0 mb-5 text-sm leading-relaxed text-muted">
				{register ? f.register : f.signin}
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
			<form className="space-y-4" onSubmit={handleSubmit} aria-busy={busy}>
				{register && field("display_name", t.name, "text", "name")}
				{field("email", t.email, "email", "username")}
				<PasswordField
					id={`${id}-password`}
					name="password"
					label={t.password}
					required
					autoComplete={register ? "new-password" : "current-password"}
					minLength={register ? 12 : undefined}
					help={register ? t.passwordHelp : undefined}
					error={fieldErrors.password}
					disabled={busy}
					showLabel={f.show}
					hideLabel={f.hide}
				/>
				{register ? (
					<RegistrationConsent
						locale={locale}
						disabled={busy}
						error={fieldErrors.consent}
					/>
				) : (
					<div className="text-end text-sm">
						<Link href={flow.href("forgot-password")}>{t.forgot}</Link>
					</div>
				)}
				<Button
					className="min-h-11 w-full"
					type="submit"
					disabled={busy || wait > 0}
				>
					{busy ? t.saving : register ? t.register : t.signin}
					{wait > 0 &&
						` · ${new Intl.NumberFormat(locale).format(wait)} ${f.seconds}`}
				</Button>
			</form>
			<GoogleButton
				compact
				locale={locale}
				context={role}
				action={register ? "register" : "signin"}
			/>
			<nav className="account-links mt-5 flex flex-col gap-3 border-0 border-t border-solid border-border pt-4 text-center text-sm font-medium">
				<Link
					href={flow.href(`${role}-${register ? "sign-in" : "registration"}`)}
				>
					{register ? t.existing : t.newAccount}
				</Link>
				{!register && <Link href={flow.href("verify-email")}>{t.verify}</Link>}
				<Link
					href={flow.href(`${role === "seller" ? "buyer" : "seller"}-sign-in`)}
				>
					{role === "seller" ? t.buyerSignin : t.sellerSignin}
				</Link>
			</nav>
		</>
	);
}
