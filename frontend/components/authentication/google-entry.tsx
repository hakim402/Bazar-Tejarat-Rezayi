"use client";
import { Field, Input } from "../ui/form-field";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import { Alert } from "../ui/alert";
import { Button as ShadcnButton } from "../shadcn/button";
import { Input as ShadcnInput } from "../shadcn/input";
import { FormActions, FormField } from "../ui/dialog-form";
import { useEffect, useId, useState, useRef, type FormEvent } from "react";
import {
	authMutation,
	googleAvailability,
	safeReturn,
} from "../../features/identity/api/accounts";
import { authFailure } from "@/features/identity/auth-errors";
import toast from "react-hot-toast";
import { authCopy } from "../../lib/i18n/auth";
import { googleCopy } from "../../lib/i18n/google";
import type { Locale } from "../../lib/i18n/locales";

export function GoogleMark() {
	return (
		<svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
			<path
				fill="#EA4335"
				d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
			/>
			<path
				fill="#4285F4"
				d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.88 46.98 24.55Z"
			/>
			<path
				fill="#FBBC05"
				d="M10.53 28.59a14.41 14.41 0 0 1 0-9.18l-7.98-6.19a23.87 23.87 0 0 0 0 21.56l7.98-6.19Z"
			/>
			<path
				fill="#34A853"
				d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
			/>
		</svg>
	);
}

export function GoogleButton({
	locale,
	context,
	action = "signin",
	sourceContext,
	compact = false,
	embedded = false,
}: {
	locale: Locale;
	context: "buyer" | "seller";
	action?: "signin" | "register" | "link" | "add-role";
	sourceContext?: "buyer" | "seller";
	compact?: boolean;
	embedded?: boolean;
}) {
	const t = googleCopy[locale],
		a = authCopy[locale];
	const base = useId();
	const locked = useRef(false),
		alive = useRef(true);
	const [available, setAvailable] = useState(false),
		[loaded, setLoaded] = useState(false),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[password, setPassword] = useState("");
	useEffect(() => {
		let current = true;
		alive.current = true;
		void googleAvailability()
			.then((result) => {
				if (current) setAvailable(result.status === "google_available");
			})
			.catch(() => {})
			.finally(() => {
				if (current) setLoaded(true);
			});
		return () => {
			current = false;
			alive.current = false;
		};
	}, []);
	async function start(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		setError("");
		const values = new FormData(event.currentTarget);
		try {
			const result = await authMutation("google/start/", {
				locale,
				context,
				action,
				...(sourceContext ? { source_context: sourceContext } : {}),
				...(action === "link"
					? { password: String(values.get("password") ?? "") }
					: {}),
				return_path: safeReturn(
					new URLSearchParams(window.location.search).get("return"),
					locale,
					context,
				),
			});
			if (!alive.current) return;
			if (result.status !== "redirect" || !result.authorization_url)
				throw new Error();
			const url = new URL(result.authorization_url);
			if (
				url.origin !== "https://accounts.google.com" ||
				url.pathname !== "/o/oauth2/v2/auth"
			)
				throw new Error();
			window.location.assign(url.href);
		} catch (error) {
			if (!alive.current) return;
			const failure = authFailure(error, locale, "google");
			setError(failure.message);
			toast.error(failure.message);
		} finally {
			locked.current = false;
			if (alive.current) setBusy(false);
		}
	}
	const googleMark = <GoogleMark />;
	if (embedded)
		return (
			<div className="google-entry space-y-4">
				{error && (
					<Alert variant="danger" role="alert">
						{error}
					</Alert>
				)}
				<form className="space-y-4" onSubmit={start} aria-busy={busy}>
					{action === "link" && available && (
						<FormField
							id={`${base}-password`}
							label={a.currentPassword}
							required
						>
							<ShadcnInput
								id={`${base}-password`}
								name="password"
								type="password"
								required
								dir="ltr"
								autoComplete="current-password"
								maxLength={128}
								disabled={busy}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</FormField>
					)}
					<FormActions>
						<ShadcnButton
							type="submit"
							variant="outline"
							disabled={!available || busy}
							className="google-button gap-2"
						>
							{googleMark}
							{busy ? t.loading : t.button}
						</ShadcnButton>
					</FormActions>
				</form>
				{loaded && !available && (
					<p className="m-0 text-xs leading-5 text-muted">{t.unavailable}</p>
				)}
			</div>
		);
	if (!available && (action === "signin" || action === "register")) return null;
	return (
		<div className={`google-entry ${compact ? "mt-4" : "my-6"}`}>
			<div className="mb-4 flex items-center gap-3 text-xs text-muted">
				<span className="h-px flex-1 bg-border" />
				<span>{authFeedback[locale].orContinue}</span>
				<span className="h-px flex-1 bg-border" />
			</div>
			{error && (
				<Alert variant="danger" role="alert">
					{error}
				</Alert>
			)}
			<form className="flex flex-col gap-2" onSubmit={start} aria-busy={busy}>
				{action === "link" && available && (
					<Field name="password" label={a.currentPassword}>
						<Input
							name="password"
							type="password"
							required
							dir="ltr"
							autoComplete="current-password"
							maxLength={128}
						/>
					</Field>
				)}
				<ShadcnButton
					variant="outline"
					className="google-button min-h-12 w-full gap-3 rounded-xl border-border bg-surface text-sm font-medium text-foreground shadow-none hover:bg-page"
					aria-label={t.button}
					type="submit"
					disabled={!available || busy}
				>
					{googleMark}
					{busy ? t.loading : "Google"}
				</ShadcnButton>
			</form>
			{loaded && !available && (
				<p
					className={`account-hint text-muted ${compact ? "mt-2 text-xs leading-5" : "mt-3 mb-5 text-base"}`}
				>
					{t.unavailable}
				</p>
			)}
			{action === "link" && (
				<p
					className={
						embedded
							? "account-hint mt-2 text-xs leading-5 text-muted"
							: "account-hint mt-3 mb-5 text-base text-muted"
					}
				>
					{t.link}
				</p>
			)}
			{action === "add-role" && (
				<p className="account-hint mt-3 mb-5 text-base text-muted">
					{t.addRole}
				</p>
			)}
		</div>
	);
}
