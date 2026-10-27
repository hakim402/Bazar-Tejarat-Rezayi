"use client";
import { useId } from "react";
import Link from "next/link";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form-field";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import { PublicAuthForm } from "./public-auth-form";
import { useAuthFlow } from "../../features/identity/hooks/use-auth-flow";
import { GoogleResult } from "./google-result";
import { authCopy } from "../../lib/i18n/auth";
import type { Locale } from "../../lib/i18n/locales";
import { screenTitle, type AuthScreen } from "../../lib/i18n/auth-screens";

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
		register,
		signin,
		busy,
		error,
		notice,
		token,
		alertRef,
		handleSubmit,
	} = flow;
	if (screen === "google-result") return <GoogleResult locale={locale} />;
	if (register || signin)
		return <PublicAuthForm locale={locale} screen={screen} flow={flow} />;
	const field = (name: string, label: string, type = "text", auto = "") => (
		<Field id={`${prefix}-${name}`} name={name} label={label} key={name}>
			<Input
				name={name}
				id={`${prefix}-${name}`}
				type={type}
				required
				maxLength={name === "email" ? 254 : 128}
				minLength={name === "password" ? 12 : undefined}
				autoComplete={auto || undefined}
				dir="ltr"
				aria-invalid={Boolean(error)}
				aria-describedby={error ? errorId : undefined}
			/>
		</Field>
	);
	return (
		<>
			<AccountHeading>{screenTitle(locale, screen)}</AccountHeading>
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
					<form
						className="flex flex-col gap-2"
						onSubmit={handleSubmit}
						aria-busy={busy}
					>
						{(screen === "forgot-password" ||
							(screen === "verify-email" && !token)) &&
							field("email", t.email, "email", "username")}
						{screen === "reset-password" && (
							<>
								{field("password", t.newPassword, "password", "new-password")}
								<p className="mt-3 mb-5 text-base text-muted">
									{t.passwordHelp}
								</p>
								{field("repeat", t.repeat, "password", "new-password")}
								<p className="mt-3 mb-5">{t.shared}</p>
							</>
						)}
						{screen === "verify-email" && (
							<p className="mt-3 mb-5">{token ? t.verify : t.invalidLink}</p>
						)}
						<Button disabled={busy} type="submit">
							{busy
								? t.saving
								: screen === "verify-email"
									? token
										? t.verifyAction
										: t.resend
									: t.submit}
						</Button>
					</form>
				</>
			)}
			<nav className="account-links mt-5 text-sm font-medium">
				<Link href={`/${locale}/auth/${audience}-sign-in`}>{t.backSignin}</Link>
			</nav>
		</>
	);
}
