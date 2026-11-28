"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
	AccountError,
	authMutation,
	safeReturn,
	type AccountContext,
} from "../api/accounts";
import {
	pendingVerificationFor,
	retainVerification,
	type PendingVerification,
} from "../verification-state";
import {
	authHref,
	clearAuthToken,
	AUTH_NAVIGATION_CHANGED,
} from "@/lib/routes/auth-routes";
import { useSearchParams } from "next/navigation";
import { authFailure } from "../auth-errors";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import toast from "react-hot-toast";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
import type { AuthScreen } from "../../../lib/i18n/auth-screens";
export function useAuthFlow(
	locale: Locale,
	screen: AuthScreen,
	audience: AccountContext = "buyer",
) {
	const search = useSearchParams();
	const t = authCopy[locale];
	const context: AccountContext = screen.startsWith("seller")
		? "seller"
		: screen.startsWith("buyer")
			? "buyer"
			: audience;
	const register = screen.endsWith("registration"),
		signin = screen.endsWith("sign-in");
	const [pendingVerification, setPendingVerification] =
		useState<PendingVerification>();
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [ready, setReady] = useState(false);
	const [retryAt, setRetryAt] = useState(0);
	const [now, setNow] = useState(0);
	const [completed, setCompleted] = useState(false);
	const [invalidToken, setInvalidToken] = useState(false);
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[token, setToken] = useState("");
	const inFlight = useRef(false);
	const alertRef = useRef<HTMLParagraphElement>(null);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			alive.current = false;
			clearInterval(timer);
		};
	}, []);
	useEffect(() => {
		const restore = () => {
			setPendingVerification(pendingVerificationFor(context));
			setReady(true);
			if (screen === "reset-password" || screen === "verify-email") {
				const value = new URLSearchParams(window.location.hash.slice(1)).get(
					"token",
				);
				setToken(value && /^[A-Za-z0-9_-]{32,100}$/.test(value) ? value : "");
			}
		};
		restore();
		window.addEventListener("hashchange", restore);
		window.addEventListener(AUTH_NAVIGATION_CHANGED, restore);
		return () => {
			window.removeEventListener("hashchange", restore);
			window.removeEventListener(AUTH_NAVIGATION_CHANGED, restore);
		};
	}, [context, screen]);
	useEffect(() => {
		if (error) alertRef.current?.focus();
	}, [error]);
	function handleFailure(err: unknown) {
		const operation = register
			? "register"
			: signin
				? "signin"
				: screen === "verify-email"
					? "verify"
					: screen === "reset-password"
						? "reset"
						: "request";
		const failure = authFailure(err, locale, operation);
		if (failure.retryAfter) {
			setNow(Date.now());
			setRetryAt(Date.now() + failure.retryAfter * 1000);
		}
		setError(failure.message);
		setFieldErrors(failure.fields);
		toast.error(failure.message);
	}
	function completeSignin() {
		window.location.assign(
			safeReturn(
				new URLSearchParams(window.location.search).get("return"),
				locale,
				context,
			),
		);
	}
	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (inFlight.current || Date.now() < retryAt) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		setFieldErrors({});
		setNotice("");
		const form = event.currentTarget;
		const values = new FormData(form);
		const value = (key: string) => String(values.get(key) ?? "");
		try {
			if (value("repeat") && value("password") !== value("repeat")) {
				setError(t.mismatch);
				setFieldErrors({ repeat: t.mismatch });
				toast.error(t.mismatch);
				return;
			}
			setEmail(value("email"));
			if (register) {
				const result = await authMutation(`${context}/register/`, {
					email: value("email"),
					password: value("password"),
					display_name: value("display_name"),
					consent: values.has("consent"),
					locale,
				});
				if (!alive.current) return;
				const pending = {
					email: value("email"),
					context,
					resendAt: Date.now() + (result.resend_after ?? 60) * 1000,
					expiresAt: Date.now() + (result.expires_in ?? 600) * 1000,
					returnTo: safeReturn(search.get("return"), locale, context),
				};
				retainVerification(pending, context);
				setPendingVerification(pending);
				form.reset();
				setNotice(t.requested);
			} else if (signin) {
				const result = await authMutation(`${context}/signin/`, {
					email: value("email"),
					password: value("password"),
				});
				if (!alive.current) return;
				if (result.status !== "signed_in")
					throw new Error("Unexpected sign-in result");
				form.reset();
				completeSignin();
			} else if (screen === "verify-email" && token) {
				await authMutation("verify/", { token });
				if (!alive.current) return;
				clearAuthToken();
				retainVerification(null, context);
				setToken("");
				setCompleted(true);
				setNotice(authFeedback[locale].verifyDone);
			} else if (screen === "reset-password") {
				if (!token) {
					setError(t.invalidLink);
					return;
				}
				await authMutation("reset/", { token, password: value("password") });
				if (!alive.current) return;
				clearAuthToken();
				setToken("");
				form.reset();
				setCompleted(true);
				setNotice(authFeedback[locale].resetDone);
			} else {
				await authMutation(
					`mail/${screen === "forgot-password" ? "reset" : "verify"}/`,
					{ email: value("email"), locale, context },
				);
				if (!alive.current) return;
				setNotice(authFeedback[locale].recoverySent);
			}
		} catch (err) {
			if (!alive.current) return;
			if (
				(screen === "reset-password" || screen === "verify-email") &&
				err instanceof AccountError &&
				err.fields.includes("token")
			)
				setInvalidToken(true);
			handleFailure(err);
		} finally {
			inFlight.current = false;
			if (alive.current) setBusy(false);
		}
	}
	return {
		context,
		ready,
		wait: Math.max(0, Math.ceil((retryAt - now) / 1000)),
		fieldErrors,
		completed,
		invalidToken,
		email,
		href: (next: AuthScreen) =>
			authHref(
				locale,
				next,
				new URLSearchParams({
					context,
					return: safeReturn(search.get("return"), locale, context),
				}),
			),
		pendingVerification,
		register,
		signin,
		busy,
		error,
		notice,
		token,
		alertRef,
		completeSignin,
		handleSubmit,
	};
}
