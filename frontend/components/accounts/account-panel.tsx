"use client";
import { catalogueCopy } from "../../lib/i18n/catalogue";
import { organizationCopy } from "../../lib/i18n/organizations";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form-field";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import Link from "next/link";
import { AccountSummary } from "./account-summary";
import { GoogleButton } from "../authentication/google-entry";
import { googleCopy } from "../../lib/i18n/google";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import {
	AccountError,
	accountSession,
	authMutation,
	type AccountContext,
	type SessionData,
} from "../../features/identity/api/accounts";
import { authCopy } from "../../lib/i18n/auth";
import type { Locale } from "../../lib/i18n/locales";
export function AccountPanel({
	locale,
	context,
	screen = "profile",
}: {
	locale: Locale;
	context: AccountContext;
	screen?: string;
}) {
	const t = authCopy[locale];
	const [data, setData] = useState<SessionData | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const target = context === "buyer" ? "seller" : "buyer";
	const refresh = useCallback(async () => {
		try {
			setData(await accountSession(context));
			setError("");
		} catch (err) {
			setData(null);
			setError(
				err instanceof AccountError && err.status === 403
					? t.anonymous
					: t.unavailable,
			);
		} finally {
			setLoading(false);
		}
	}, [context, t]);
	useEffect(() => {
		let current = true;
		const load = () => {
			if (current) void refresh();
		};
		load();
		window.addEventListener("focus", load);
		const timer = setInterval(load, 30000);
		return () => {
			current = false;
			window.removeEventListener("focus", load);
			clearInterval(timer);
		};
	}, [refresh]);
	async function submit(event: FormEvent<HTMLFormElement>) {
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
			if (screen === "password" && value("password") !== value("repeat")) {
				setError(t.mismatch);
				return;
			}
			if (screen === "password") {
				await authMutation(`${context}/password/`, {
					current_password: value("current_password"),
					password: value("password"),
				});
				setData(null);
				setNotice(t.passwordUpdated);
			} else if (screen === "link") {
				await authMutation(`${context}/link/${target}/`, {
					password: value("current_password"),
				});
				setNotice(t.linkDone);
			} else {
				await authMutation(
					`${context}/profile/`,
					{ display_name: value("display_name") },
					"PATCH",
				);
				setNotice(t.updated);
				await refresh();
			}
			form.reset();
		} catch (err) {
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
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	async function signout(all: boolean) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		try {
			await authMutation(all ? "logout-all/" : `${context}/logout/`);
			setData(null);
			setNotice(t.signedOut);
		} catch {
			setError(t.unavailable);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	const field = (key: string, label: string, type = "password") => (
		<Field name={key} label={label} key={key}>
			<Input
				name={key}
				type={type}
				autoComplete={
					type === "password"
						? key === "current_password"
							? "current-password"
							: "new-password"
						: key === "code"
							? "one-time-code"
							: "name"
				}
				dir={type === "password" || key === "code" ? "ltr" : undefined}
				required
				minLength={key === "password" ? 12 : undefined}
				maxLength={key === "display_name" ? 150 : 128}
				defaultValue={
					key === "display_name" ? data?.identity.display_name : undefined
				}
			/>
		</Field>
	);
	return (
		<>
			<p className="mb-2 text-sm font-bold text-action">
				{t[context]} · {t.privateView}
			</p>
			<AccountHeading>
				{screen === "password"
					? t.passwordChange
					: screen === "link"
						? t.link
						: t.profile}
			</AccountHeading>
			{loading && (
				<p role="status" className="mt-3 mb-5">
					{t.loading}
				</p>
			)}
			{error && (
				<Alert variant="danger" role="alert">
					{error}
				</Alert>
			)}
			{notice && (
				<Alert variant="success" role="status">
					{notice}
				</Alert>
			)}
			{data ? (
				<>
					{screen === "profile" && (
						<GoogleButton
							locale={locale}
							context={context}
							sourceContext={context}
							action="link"
						/>
					)}
					{screen === "link" && (
						<GoogleButton
							locale={locale}
							context={target}
							sourceContext={context}
							action="add-role"
						/>
					)}
					{screen === "password" && (
						<Link href={`/${locale}/auth/forgot-password`}>
							{googleCopy[locale].recovery}
						</Link>
					)}
					<nav
						className="account-tabs my-5 flex flex-wrap gap-4 text-base [&_a]:min-h-11"
						aria-label={t.profile}
					>
						<Link href={`/${locale}/account/${context}`}>{t.profile}</Link>
						<Link href={`/${locale}/account/${context}/password`}>
							{t.passwordChange}
						</Link>
						{<Link href={`/${locale}/account/${context}/link`}>{t.link}</Link>}
					</nav>
					{screen === "profile" && (
						<>
							<AccountSummary data={data} locale={locale} />
							{
								<p className="text-muted">
									{organizationCopy[locale].approvalScope}
								</p>
							}

							<nav className="my-5 flex flex-wrap gap-4 text-action">
								{
									<>
										{context === "seller" && (
											<Link href={`/${locale}/account/seller/catalogue`}>
												{catalogueCopy[locale].title}
											</Link>
										)}
										<Link href={`/${locale}/account/${context}/organizations`}>
											{organizationCopy[locale].title}
										</Link>
									</>
								}
							</nav>
						</>
					)}
					<form
						className="flex max-w-2xl flex-col gap-3 rounded-card border border-border bg-page p-5"
						onSubmit={submit}
						aria-busy={busy}
					>
						{screen === "profile" ? (
							field("display_name", t.name, "text")
						) : (
							<>
								<p className="mt-3 mb-5">
									{screen === "link"
										? t.linkHelp
										: t.shared}
								</p>

								{field("current_password", t.currentPassword)}
								{screen === "password" && (
									<>
										{field("password", t.newPassword)}
										{field("repeat", t.repeat)}
									</>
								)}
							</>
						)}
						<Button type="submit" disabled={busy}>
							{busy
								? t.saving
								: screen === "profile"
									? t.editProfile
									: t.submit}
						</Button>
					</form>
					{notice === t.linkDone && (
						<Link href={`/${locale}/auth/${target}-sign-in`}>
							{t[target]} · {t.signin}
						</Link>
					)}
					<div className="account-signout mt-6 flex flex-col flex-wrap gap-3 desktop:flex-row">
						<Button
							type="button"
							variant="secondary"
							disabled={busy}
							onClick={() => signout(false)}
						>
							{t.logout}
						</Button>
						<Button
							type="button"
							variant="secondary"
							disabled={busy}
							onClick={() => signout(true)}
						>
							{t.logoutAll}
						</Button>
					</div>
				</>
			) : (
				!loading && (
					<>
						<Link href={`/${locale}/auth/${context}-sign-in`}>
							{t.backSignin}
						</Link>
						<Button type="button" variant="secondary" onClick={refresh}>
							{t.retry}
						</Button>
					</>
				)
			)}
		</>
	);
}
