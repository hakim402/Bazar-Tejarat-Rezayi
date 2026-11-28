"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import {
	authMutation,
	type AccountContext,
} from "@/features/identity/api/accounts";
import { authFailure } from "@/features/identity/auth-errors";
import {
	retainVerification,
	type PendingVerification,
} from "@/features/identity/verification-state";
import { authCopy } from "@/lib/i18n/auth";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import { verificationCodeCopy } from "@/lib/i18n/verification-code";
import type { Locale } from "@/lib/i18n/locales";

export function VerificationCode({
	locale,
	pending,
	context: audience = "buyer",
	returnTo,
}: {
	locale: Locale;
	pending?: PendingVerification;
	context?: AccountContext;
	returnTo?: string;
}) {
	const t = verificationCodeCopy[locale];
	const f = authFeedback[locale];
	const a = authCopy[locale];
	const id = useId();
	const context = pending?.context === audience ? pending.context : audience;
	const initial = pending?.context === context ? pending : undefined;
	const [email, setEmail] = useState(initial?.email ?? "");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [fields, setFields] = useState<Record<string, string>>({});
	const [stage, setStage] = useState<"email" | "code" | "complete">(
		initial ? "code" : "email",
	);
	const [resendAt, setResendAt] = useState(initial?.resendAt ?? 0);
	const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? 0);
	const [now, setNow] = useState<number>();
	const locked = useRef(false);
	const alive = useRef(true);
	const heading = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		alive.current = true;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			alive.current = false;
			clearInterval(timer);
		};
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: focus the new step when its visible stage changes.
	useEffect(() => {
		heading.current?.focus();
	}, [stage]);
	const wait =
		now === undefined
			? resendAt
				? 60
				: 0
			: Math.max(0, Math.ceil((resendAt - now) / 1000));
	const remaining =
		now !== undefined && expiresAt
			? Math.max(0, Math.ceil((expiresAt - now) / 1000))
			: null;
	const expired = remaining === 0;
	function failure(error: unknown, operation: "verify" | "request") {
		const feedback = authFailure(error, locale, operation);
		setError(feedback.message);
		setFields(feedback.fields);
		toast.error(feedback.message);
	}
	async function verify(event: FormEvent) {
		event.preventDefault();
		if (locked.current || expired) return;
		locked.current = true;
		setBusy(true);
		setError("");
		setFields({});
		try {
			await authMutation("verify/", { email, code });
			if (!alive.current) return;
			setStage("complete");
			setCode("");
			retainVerification(null, context);
			toast.success(f.verifyDone);
		} catch (error) {
			if (alive.current) failure(error, "verify");
		} finally {
			locked.current = false;
			if (alive.current) setBusy(false);
		}
	}
	async function requestCode(event?: FormEvent) {
		event?.preventDefault();
		if (locked.current || wait > 0 || !email) return;
		locked.current = true;
		setBusy(true);
		setError("");
		setFields({});
		try {
			const result = await authMutation("mail/verify/", {
				email,
				locale,
				context,
			});
			if (!alive.current) return;
			const now = Date.now();
			const next = now + (result.resend_after ?? 60) * 1000;
			const expiry = now + (result.expires_in ?? 600) * 1000;
			setResendAt(next);
			setExpiresAt(expiry);
			setNow(now);
			setCode("");
			setStage("code");
			retainVerification(
				{
					email,
					context,
					resendAt: next,
					expiresAt: expiry,
					returnTo: initial?.returnTo,
				},
				context,
			);
			toast.success(t.received);
		} catch (error) {
			if (alive.current) failure(error, "request");
		} finally {
			locked.current = false;
			if (alive.current) setBusy(false);
		}
	}
	function changeEmail() {
		retainVerification(null, context);
		setCode("");
		setError("");
		setFields({});
		setStage("email");
	}
	if (stage === "complete")
		return (
			<div className="space-y-4">
				<p
					ref={heading}
					tabIndex={-1}
					className="m-0 text-sm text-success"
					role="status"
				>
					{f.verifyDone}
				</p>
				<p className="m-0 text-sm leading-relaxed">{t[context]}</p>
				<Button asChild className="min-h-11 w-full">
					<Link href={returnTo ?? `/${locale}/auth/${context}-sign-in`}>
						{a.signin}
					</Link>
				</Button>
			</div>
		);
	return (
		<div className="space-y-4">
			<p
				ref={heading}
				tabIndex={-1}
				className="m-0 text-sm leading-relaxed"
				role="status"
			>
				{stage === "code" ? t.received : t.help}
			</p>
			{error && (
				<p id={`${id}-error`} role="alert" className="m-0 text-sm text-danger">
					{error}
				</p>
			)}
			{stage === "email" ? (
				<form
					className="space-y-3"
					onSubmit={(event) => void requestCode(event)}
					aria-busy={busy}
				>
					<div className="space-y-1">
						<label htmlFor={`${id}-email`} className="text-sm font-medium">
							{a.email}
						</label>
						<Input
							id={`${id}-email`}
							className="min-h-11 text-base"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							autoComplete="email"
							required
							dir="ltr"
							maxLength={254}
							disabled={busy}
							aria-invalid={!!fields.email}
							aria-describedby={fields.email ? `${id}-error` : undefined}
						/>
					</div>
					<Button
						className="min-h-11 w-full"
						type="submit"
						disabled={busy || wait > 0}
					>
						{busy
							? a.saving
							: wait > 0
								? `${t.wait} ${new Intl.NumberFormat(locale).format(wait)} ${f.seconds}`
								: a.verify}
					</Button>
				</form>
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<bdi dir="ltr" className="min-w-0 break-all text-sm font-medium">
							{email}
						</bdi>
						<Button
							type="button"
							variant="link"
							size="sm"
							disabled={busy}
							onClick={changeEmail}
						>
							{f.changeEmail}
						</Button>
					</div>
					<form className="space-y-3" onSubmit={verify} aria-busy={busy}>
						<div className="space-y-1.5">
							<label htmlFor={id} className="text-sm font-medium">
								{t.code}
							</label>
							<Input
								id={id}
								className="min-h-12 text-center text-xl tracking-[0.35em]"
								value={code}
								onChange={(event) =>
									setCode(
										event.target.value
											.replace(/[۰-۹٠-٩]/g, (digit) =>
												String(
													digit.charCodeAt(0) - (digit >= "۰" ? 1776 : 1632),
												),
											)
											.replace(/\s/g, "")
											.slice(0, 6),
									)
								}
								inputMode="numeric"
								autoComplete="one-time-code"
								pattern="[0-9]{6}"
								minLength={6}
								maxLength={12}
								required
								dir="ltr"
								disabled={busy || expired}
								aria-describedby={`${id}-help${fields.code ? ` ${id}-error` : ""}`}
								aria-invalid={!!fields.code}
							/>
							<p
								id={`${id}-help`}
								className="m-0 text-xs leading-relaxed text-muted"
							>
								{expired ? f.expired : t.help}
							</p>
							{remaining !== null && !expired && (
								<p className="m-0 text-xs text-muted">
									{f.expires}{" "}
									<bdi>
										{Math.floor(remaining / 60)}:
										{String(remaining % 60).padStart(2, "0")}
									</bdi>
								</p>
							)}
						</div>
						<Button
							className="min-h-11 w-full"
							type="submit"
							disabled={busy || expired}
						>
							{busy ? a.saving : a.verifyAction}
						</Button>
						<Button
							className="min-h-11 w-full"
							type="button"
							variant="outline"
							disabled={busy || wait > 0}
							onClick={() => void requestCode()}
						>
							{wait > 0
								? `${t.wait} ${new Intl.NumberFormat(locale).format(wait)} ${f.seconds}`
								: t.resend}
						</Button>
					</form>
				</>
			)}
			<Button asChild variant="link" className="w-full">
				<Link href={returnTo ?? `/${locale}/auth/${context}-sign-in`}>
					{a.backSignin}
				</Link>
			</Button>
		</div>
	);
}
