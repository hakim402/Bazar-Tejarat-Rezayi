"use client";
import { Button } from "../shadcn/button";
import { RegistrationConsent } from "./registration-consent";
import { authFailure } from "@/features/identity/auth-errors";
import { authHref } from "@/lib/routes/auth-routes";
import toast from "react-hot-toast";
import { Input } from "../shadcn/input";
import { FormField } from "../ui/dialog-form";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import { useEffect, useState, useRef, useId, type FormEvent } from "react";
import Link from "next/link";
import { authMutation, safeReturn } from "../../features/identity/api/accounts";
import { authCopy } from "../../lib/i18n/auth";
import { googleCopy } from "../../lib/i18n/google";
import type { Locale } from "../../lib/i18n/locales";

export function GoogleResult({ locale }: { locale: Locale }) {
	const t = googleCopy[locale],
		a = authCopy[locale];
	const id = useId();
	const locked = useRef(false),
		alive = useRef(true);
	const [result, setResult] = useState(""),
		[attempt, setAttempt] = useState(""),
		[context, setContext] = useState<"buyer" | "seller">("buyer"),
		[action, setAction] = useState(""),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [fields, setFields] = useState<Record<string, string>>({});
	useEffect(() => {
		alive.current = true;
		const q = new URLSearchParams(window.location.search);
		setResult(q.get("google") ?? "provider_error");
		setAttempt(q.get("attempt") ?? "");
		setContext(q.get("context") === "seller" ? "seller" : "buyer");
		setAction(q.get("action") ?? "");
		return () => {
			alive.current = false;
		};
	}, []);
	async function finish(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		setError("");
		setFields({});
		const values = new FormData(event.currentTarget);
		try {
			const response = await authMutation("google/complete/", {
				attempt_id: attempt,
				display_name: String(values.get("display_name")),
				consent: values.has("consent"),
			});
			if (!alive.current) return;
			if (response.status === "signed_in")
				window.location.assign(
					safeReturn(response.return_path ?? null, locale, context),
				);
			else if (response.status === "linked") {
				const clean = new URL(window.location.href);
				clean.searchParams.set("google", "linked");
				clean.searchParams.delete("attempt");
				window.history.replaceState(null, "", clean.pathname + clean.search);
				setResult("linked");
				setBusy(false);
			} else throw new Error("Unexpected Google completion result");
		} catch (error) {
			if (!alive.current) return;
			const failure = authFailure(error, locale, "google");
			setError(failure.message);
			setFields(failure.fields);
			toast.error(failure.message);
		} finally {
			locked.current = false;
			if (alive.current) setBusy(false);
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
					{result === "registration_closed"
						? a.registrationClosed
						: (t[key] ?? t.provider_error)}
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
					<FormField
						id={id}
						label={a.name}
						required
						error={fields.display_name}
					>
						<Input
							id={id}
							aria-invalid={!!fields.display_name}
							aria-describedby={fields.display_name ? `${id}-error` : undefined}
							name="display_name"
							className="min-h-11 text-base"
							disabled={busy}
							required
							autoComplete="name"
							maxLength={150}
						/>
					</FormField>

					<RegistrationConsent
						locale={locale}
						disabled={busy}
						error={fields.consent}
					/>
					<Button type="submit" disabled={busy}>
						{busy ? a.saving : a.submit}
					</Button>
				</form>
			)}
			<nav className="account-links mt-7 flex flex-col gap-3.5 text-base font-bold">
				<Link
					href={authHref(
						locale,
						`${context}-sign-in`,
						new URLSearchParams({ context }),
					)}
				>
					{context === "seller" ? a.sellerSignin : a.buyerSignin}
				</Link>
				<Link
					href={authHref(
						locale,
						"forgot-password",
						new URLSearchParams({ context }),
					)}
				>
					{t.recovery}
				</Link>
				{action === "link" || action === "add-role" ? (
					<Link href={`/${locale}/account/${context}`}>{a.profile}</Link>
				) : null}
			</nav>
		</>
	);
}
