"use client";
import { useId } from "react";
import Link from "next/link";
import { authCopy } from "../../../lib/i18n/auth";
import { screenTitle, type AuthScreen } from "../../../lib/i18n/auth-screens";
import type { Locale } from "../../../lib/i18n/locales";
import { Field, Input, CheckField } from "../../../components/ui/form-field";
import { Button } from "../../../components/ui/button";
import { Alert } from "../../../components/ui/alert";
import { AccountHeading } from "./account-heading";
import { IntentPicker } from "./intent-picker";
import { GoogleButton } from "./google-entry";
import type { useAuthFlow } from "../hooks/use-auth-flow";
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
		id = useId(),
		role = flow.context === "seller" ? "seller" : "buyer",
		errorId = `${id}-error`;
	const {
		register,
		busy,
		error,
		notice,
		intent,
		setIntent,
		alertRef,
		handleSubmit,
	} = flow;
	const field = (name: string, label: string, type = "text", auto = "") => (
		<Field key={name} compact id={`${id}-${name}`} name={name} label={label}>
			<Input
				compact
				id={`${id}-${name}`}
				name={name}
				type={type}
				required
				autoComplete={auto}
				dir={name === "display_name" ? undefined : "ltr"}
				maxLength={name === "email" ? 254 : name === "display_name" ? 150 : 128}
				minLength={name === "password" && register ? 12 : undefined}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? errorId : undefined}
			/>
		</Field>
	);
	return (
		<>
			<AccountHeading compact>{screenTitle(locale, screen)}</AccountHeading>
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
			<form
				className="flex flex-col gap-2"
				onSubmit={handleSubmit}
				aria-busy={busy}
			>
				{register && (
					<IntentPicker
						compact
						locale={locale}
						context={role}
						value={intent}
						onChange={setIntent}
					/>
				)}
				<div
					className={
						register ? "grid gap-2 min-[480px]:grid-cols-2" : "grid gap-2"
					}
				>
					{register && field("display_name", t.name, "text", "name")}
					{field("email", t.email, "email", "username")}
				</div>
				{field(
					"password",
					t.password,
					"password",
					register ? "new-password" : "current-password",
				)}
				{register ? (
					<>
						<p className="text-xs leading-5 text-muted">{t.passwordHelp}</p>
						<CheckField
							compact
							name="consent"
							id={`${id}-consent`}
							label={t.consent}
							required
						/>
						<details className="text-xs leading-5 text-muted">
							<summary className="min-h-8 cursor-pointer font-medium text-action">
								{t.draftLink}
							</summary>
							<div className="space-y-2 pb-2">
								<p>{role === "seller" ? t.sellerNote : t.buyerNote}</p>
								<p>{t.otherRole}</p>
								<p>{t.policy}</p>
							</div>
						</details>
					</>
				) : (
					<Link
						className="self-end py-1 text-xs font-medium"
						href={`/${locale}/auth/forgot-password`}
					>
						{t.forgot}
					</Link>
				)}
				<Button compact variant="compact" type="submit" disabled={busy}>
					{busy ? t.saving : register ? t.register : t.signin}
				</Button>
			</form>
			<GoogleButton
				compact
				locale={locale}
				context={role}
				action={register ? "register" : "signin"}
			/>
			<nav className="account-links mt-4 flex flex-col gap-2 border-t border-border pt-3 text-center text-xs font-medium">
				<Link
					className="inline-flex min-h-8 items-center justify-center"
					href={`/${locale}/auth/${role}-${register ? "sign-in" : "registration"}`}
				>
					{register ? t.existing : t.newAccount}
				</Link>
				{register && notice && (
					<Link href={`/${locale}/auth/verify-email`}>{t.verify}</Link>
				)}
			</nav>
		</>
	);
}
