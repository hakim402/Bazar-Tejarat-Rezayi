"use client";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { organizationCopy } from "../../../lib/i18n/organizations";
import { Button } from "../../../components/ui/button";
import {
	Field,
	Input,
	Select,
	CheckField,
} from "../../../components/ui/form-field";
import { Alert } from "../../../components/ui/alert";
import { AccountHeading } from "./account-heading";
import Link from "next/link";
import { AccountSummary } from "./account-summary";
import { GoogleButton } from "./google-entry";
import { googleCopy } from "../../../lib/i18n/google";
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
} from "../api/accounts";
import { authCopy, responsibilityLabels } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";

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
	const businessLabels: Record<string, string> = {
		view_queue: organizationCopy[locale].queue,
		assign_review: organizationCopy[locale].assign,
		read_evidence: organizationCopy[locale].evidence,
		decide_review: organizationCopy[locale].decision,
		review_transfer: organizationCopy[locale].transferReview,
	};
	const [data, setData] = useState<SessionData | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false),
		[intent, setIntent] = useState("individual");
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
					intent,
				});
				setNotice(t.linkDone);
			} else if (screen === "mfa-reset") {
				await authMutation(`${context}/mfa/reset/`, {
					password: value("current_password"),
					code: value("code"),
					recovery: values.has("recovery"),
				});
				setData(null);
				setNotice(t.factorResetNote);
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
						: screen === "mfa-reset"
							? t.factorReset
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
					{context !== "staff" && screen === "profile" && (
						<GoogleButton
							locale={locale}
							context={context}
							sourceContext={context}
							action="link"
						/>
					)}
					{context !== "staff" && screen === "link" && (
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
						{context !== "staff" && (
							<Link href={`/${locale}/account/${context}/link`}>{t.link}</Link>
						)}
						{context === "staff" && (
							<Link href={`/${locale}/account/${context}/mfa-reset`}>
								{t.factorReset}
							</Link>
						)}
					</nav>
					{screen === "profile" && (
						<>
							<AccountSummary data={data} locale={locale} />
							{context !== "staff" && (
								<p className="text-muted">
									{organizationCopy[locale].approvalScope}
								</p>
							)}

							<nav className="my-5 flex flex-wrap gap-4 text-action">
								{context === "staff" ? (
									<>
										<Link href={`/${locale}/account/staff/verification`}>
											{organizationCopy[locale].review}
										</Link>
										<Link href={`/${locale}/account/staff/catalogue`}>
											{catalogueCopy[locale].title}
										</Link>

										<Link href={`/${locale}/account/staff/transfers`}>
											{organizationCopy[locale].transfers}
										</Link>
									</>
								) : (
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
								)}
							</nav>
							{context === "staff" && (
								<section>
									<h2>{t.permissions}</h2>
									{data.accounts[0].permissions.length ? (
										<ul>
											{data.accounts[0].permissions.map((p) => (
												<li key={p}>
													{responsibilityLabels[locale][p] ??
														businessLabels[p] ??
														t.permissions}
												</li>
											))}
										</ul>
									) : (
										<p className="mt-3 mb-5">{t.emptyPermissions}</p>
									)}
									<p className="mt-3 mb-5">{t.future}</p>
								</section>
							)}
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
										: screen === "password"
											? t.shared
											: t.factorResetNote}
								</p>
								{screen === "link" && (
									<Field name="intent" label={t.intent}>
										<Select
											name="intent"
											value={intent}
											onChange={(e) => setIntent(e.target.value)}
										>
											<option value="individual">{t.individual}</option>
											<option
												value={target === "seller" ? "company" : "business"}
											>
												{target === "seller" ? t.company : t.business}
											</option>
										</Select>
									</Field>
								)}
								{field("current_password", t.currentPassword)}
								{screen === "password" && (
									<>
										{field("password", t.newPassword)}
										{field("repeat", t.repeat)}
									</>
								)}
								{screen === "mfa-reset" && (
									<>
										{field("code", t.code, "text")}
										<CheckField
											label={t.recoveryCode}
											name="recovery"
											type="checkbox"
										/>
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
