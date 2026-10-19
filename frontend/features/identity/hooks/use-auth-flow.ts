"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
	AccountError,
	authMutation,
	safeReturn,
	type AccountContext,
} from "../api/accounts";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
import type { AuthScreen } from "../../../lib/i18n/auth-screens";
export function useAuthFlow(locale: Locale, screen: AuthScreen) {
	const t = authCopy[locale];
	const context: AccountContext = screen.startsWith("seller")
		? "seller"
		: screen.startsWith("staff") || screen === "mfa"
			? "staff"
			: "buyer";
	const register = screen.endsWith("registration"),
		signin = screen.endsWith("sign-in");
	const [busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[intent, setIntent] = useState("individual"),
		[stage, setStage] = useState(""),
		[secret, setSecret] = useState(""),
		[codes, setCodes] = useState<string[]>([]),
		[token, setToken] = useState("");
	const inFlight = useRef(false);
	const alertRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		const hash = new URLSearchParams(window.location.hash.slice(1));
		const value = hash.get("token");
		if (value) {
			setToken(value);
			window.history.replaceState(
				null,
				"",
				window.location.pathname + window.location.search,
			);
		}
	}, []);
	useEffect(() => {
		if (error) alertRef.current?.focus();
	}, [error]);
	function handleFailure(err: unknown) {
		setError(
			err instanceof AccountError
				? err.status === 429
					? t.limited
					: err.code === "csrf_failed"
						? t.stale
						: err.status === 403
							? t.denied
							: t.invalid
				: t.unavailable,
		);
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
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		setNotice("");
		const form = event.currentTarget;
		const values = new FormData(form);
		const value = (key: string) => String(values.get(key) ?? "");
		try {
			if (value("repeat") && value("password") !== value("repeat")) {
				setError(t.mismatch);
				return;
			}
			if (register) {
				await authMutation(`${context}/register/`, {
					email: value("email"),
					password: value("password"),
					display_name: value("display_name"),
					intent,
					consent: values.has("consent"),
					locale,
				});
				form.reset();
				setNotice(t.requested);
			} else if (signin && !stage) {
				const result = await authMutation(`${context}/signin/`, {
					email: value("email"),
					password: value("password"),
				});
				form.reset();
				if (result.status === "signed_in") completeSignin();
				else setStage(result.status);
			} else if (
				stage === "enroll" ||
				stage === "challenge" ||
				screen === "mfa"
			) {
				if (value("action") === "enroll") {
					const result = await authMutation("mfa/enroll/");
					setSecret(result.secret ?? "");
					setStage("challenge");
				} else {
					const result = await authMutation("mfa/challenge/", {
						code: value("code"),
						recovery: values.has("recovery"),
					});
					setSecret("");
					form.reset();
					if (result.recovery_codes?.length) {
						setCodes(result.recovery_codes);
						setStage("complete");
					} else completeSignin();
				}
			} else if (screen === "verify-email" && token) {
				await authMutation("verify/", { token });
				setToken("");
				setNotice(t.verified);
			} else if (screen === "reset-password") {
				if (!token) {
					setError(t.invalidLink);
					return;
				}
				await authMutation("reset/", { token, password: value("password") });
				setToken("");
				form.reset();
				setNotice(t.passwordUpdated);
			} else {
				await authMutation(
					`mail/${screen === "forgot-password" ? "reset" : "verify"}/`,
					{ email: value("email"), locale },
				);
				setNotice(t.requested);
			}
		} catch (err) {
			handleFailure(err);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return {
		context,
		register,
		signin,
		busy,
		error,
		notice,
		intent,
		setIntent,
		stage,
		secret,
		codes,
		setCodes,
		token,
		alertRef,
		completeSignin,
		handleSubmit,
	};
}
