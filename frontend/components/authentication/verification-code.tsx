"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import {
	authMutation,
	AccountError,
	type AccountContext,
} from "@/features/identity/api/accounts";
import { authCopy } from "@/lib/i18n/auth";
import { verificationCodeCopy } from "@/lib/i18n/verification-code";
import type { Locale } from "@/lib/i18n/locales";

export const verificationStorageKey = "rezayi:pending-email-verification";
export type PendingVerification = {
	email: string;
	context: AccountContext;
	resendAt: number;
};

export function VerificationCode({
	locale,
	pending,
}: {
	locale: Locale;
	pending?: PendingVerification;
}) {
	const t = verificationCodeCopy[locale];
	const a = authCopy[locale];
	const id = useId();
	const [email, setEmail] = useState(pending?.email ?? "");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [verified, setVerified] = useState(false);
	const [resendAt, setResendAt] = useState(pending?.resendAt ?? 0);
	const [now, setNow] = useState(0);
	const context = pending?.context ?? "buyer";
	useEffect(() => {
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await authMutation("verify/", { email, code });
			setVerified(true);
			setCode("");
			sessionStorage.removeItem(verificationStorageKey);
			toast.success(t.activated);
		} catch (e) {
			const message =
				e instanceof AccountError && e.status === 429 ? a.limited : t.invalid;
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}
	async function resend() {
		if (busy || wait > 0 || !email) return;
		setBusy(true);
		setError("");
		try {
			await authMutation("mail/verify/", { email, locale });
			const next = Date.now() + 60000;
			setResendAt(next);
			sessionStorage.setItem(
				verificationStorageKey,
				JSON.stringify({ email, context, resendAt: next }),
			);
			toast.success(t.received);
		} catch {
			setError(a.unavailable);
			toast.error(a.unavailable);
		} finally {
			setBusy(false);
		}
	}
	if (verified)
		return (
			<div className="space-y-4" role="status">
				<p className="text-sm text-success">{t.activated}</p>
				<p className="text-sm leading-relaxed">{t[context]}</p>
				<Button asChild className="w-full">
					<Link href={`/${locale}/auth/${context}-sign-in`}>{a.signin}</Link>
				</Button>
			</div>
		);
	return (
		<div className="space-y-4">
			<p className="text-sm leading-relaxed" role="status">
				{t.received}
			</p>
			<form className="space-y-3" onSubmit={submit} aria-busy={busy}>
				<div className="space-y-1">
					<label htmlFor={`${id}-email`} className="text-sm">
						{a.email}
					</label>
					<Input
						id={`${id}-email`}
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="email"
						required
						dir="ltr"
						maxLength={254}
						disabled={busy}
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor={id} className="text-sm">
						{t.code}
					</label>
					<Input
						id={id}
						value={code}
						onChange={(e) =>
							setCode(
								e.target.value.replace(/[۰-۹٠-٩]/g, (digit) =>
									String(digit.charCodeAt(0) - (digit >= "۰" ? 1776 : 1632)),
								),
							)
						}
						inputMode="numeric"
						autoComplete="one-time-code"
						pattern="[0-9]{6}"
						minLength={6}
						maxLength={6}
						required
						dir="ltr"
						disabled={busy}
						aria-describedby={`${id}-help`}
						aria-invalid={!!error}
					/>
					<p id={`${id}-help`} className="text-xs text-muted">
						{t.help}
					</p>
				</div>
				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}
				<Button className="w-full" type="submit" disabled={busy}>
					{busy ? a.saving : a.verifyAction}
				</Button>
				<Button
					className="w-full"
					type="button"
					variant="outline"
					disabled={busy || wait > 0 || !email}
					onClick={() => void resend()}
				>
					{wait > 0
						? `${t.wait} ${new Intl.NumberFormat(locale).format(wait)}`
						: t.resend}
				</Button>
			</form>
		</div>
	);
}
