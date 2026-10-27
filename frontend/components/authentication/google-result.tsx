"use client";
import { Button } from "../ui/button";
import { Field, Input, CheckField } from "../ui/form-field";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { authMutation, safeReturn } from "../../features/identity/api/accounts";
import { authCopy } from "../../lib/i18n/auth";
import { googleCopy } from "../../lib/i18n/google";
import type { Locale } from "../../lib/i18n/locales";

export function GoogleResult({ locale }: { locale: Locale }) {
	const t = googleCopy[locale],
		a = authCopy[locale];
	const [result, setResult] = useState(""),
		[attempt, setAttempt] = useState(""),
		[context, setContext] = useState<"buyer" | "seller">("buyer"),
		[action, setAction] = useState(""),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	useEffect(() => {
		const q = new URLSearchParams(window.location.search);
		setResult(q.get("google") ?? "provider_error");
		setAttempt(q.get("attempt") ?? "");
		setContext(q.get("context") === "seller" ? "seller" : "buyer");
		setAction(q.get("action") ?? "");
		const clean = new URL(window.location.href);
		for (const key of ["google", "attempt", "context", "action"])
			clean.searchParams.delete(key);
		window.history.replaceState(null, "", clean.pathname + clean.search);
	}, []);
	async function finish(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError("");
		const values = new FormData(event.currentTarget);
		try {
			const response = await authMutation("google/complete/", {
				attempt_id: attempt,
				display_name: String(values.get("display_name")),
				consent: values.has("consent"),
			});
			if (response.status === "signed_in")
				window.location.assign(
					safeReturn(response.return_path ?? null, locale, context),
				);
			else {
				setResult("linked");
				setBusy(false);
			}
		} catch {
			setError(t.provider_error);
			setBusy(false);
		}
	}
	const key = result as keyof typeof t;
	return (
		<>
			<AccountHeading>
				{result === "onboarding" ? t.onboarding : a.authLinks}
			</AccountHeading>
			{error && (
				<Alert variant="danger" role="alert">
					{error}
				</Alert>
			)}
			{result !== "onboarding" && (
				<p role="status" className="mt-3 mb-5">
					{t[key] ?? t.provider_error}
				</p>
			)}
			{result === "onboarding" && (
				<form
					className="flex flex-col gap-2"
					onSubmit={finish}
					aria-busy={busy}
				>
					<p className="mt-3 mb-5">
						{context === "seller" ? a.sellerNote : a.buyerNote}
					</p>
					<Field name="display_name" label={a.name}>
						<Input
							name="display_name"
							required
							autoComplete="name"
							maxLength={150}
						/>
					</Field>

					<CheckField
						label={a.consent}
						type="checkbox"
						name="consent"
						required
					/>
					<Alert variant="info">{a.policy}</Alert>
					<Link href={`/${locale}/auth/policy-draft`}>{a.draftLink}</Link>
					<Button type="submit" disabled={busy}>
						{busy ? a.saving : a.submit}
					</Button>
				</form>
			)}
			<nav className="account-links mt-7 flex flex-col gap-3.5 text-base font-bold">
				<Link href={`/${locale}/auth/${context}-sign-in`}>
					{context === "seller" ? a.sellerSignin : a.buyerSignin}
				</Link>
				<Link href={`/${locale}/auth/forgot-password`}>{t.recovery}</Link>
				{action === "link" || action === "add-role" ? (
					<Link href={`/${locale}/account/${context}`}>{a.profile}</Link>
				) : null}
			</nav>
		</>
	);
}
