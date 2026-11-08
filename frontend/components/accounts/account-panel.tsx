"use client";
import { catalogueCopy } from "../../lib/i18n/catalogue";
import { organizationCopy } from "../../lib/i18n/organizations";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form-field";
import { Alert } from "../ui/alert";
import { AccountHeading } from "../ui/account-heading";
import Link from "next/link";
import { AccountSummary } from "./account-summary";
import { Icon } from "../ui/icon";
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
import { useSearchParams } from "next/navigation";
import { useNavigation } from "../layout/navigation-guard";
import { sellerHref, uuidPattern } from "../../lib/routes/account-routes";
import { sellerSettingsCopy } from "../../lib/i18n/seller-settings";
import { sellerAccountSettingsCopy } from "../../lib/i18n/seller-account-settings";
import {
	ACCOUNT_SESSION_CHANGED,
	googleAvailability,
	safeReturn,
	type AuthResult,
} from "../../features/identity/api/accounts";
import {
	SettingsPage,
	SettingsSection,
	SettingsActions,
	settingsControl,
	settingsSecondary,
	useSettingsGuard,
} from "./seller-settings-ui";

type AccountPanelProps = {
	locale: Locale;
	context: AccountContext;
	screen?: string;
	sellerSettings?: boolean;
};
export function AccountPanel(props: AccountPanelProps) {
	if (
		props.sellerSettings &&
		props.context === "seller" &&
		["profile", "password", "link"].includes(props.screen ?? "profile")
	) {
		return (
			<SellerAccountPanel
				key={`${props.locale}:${props.screen ?? "profile"}`}
				locale={props.locale}
				screen={(props.screen ?? "profile") as "profile" | "password" | "link"}
			/>
		);
	}
	return <DefaultAccountPanel {...props} />;
}
function DefaultAccountPanel({
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
									{screen === "link" ? t.linkHelp : t.shared}
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

const emptySellerDraft = {
	display_name: "",
	current_password: "",
	password: "",
	repeat: "",
	google_password: "",
};
type SellerDraftKey = keyof typeof emptySellerDraft;
function SellerAccountPanel({
	locale,
	screen,
}: {
	locale: Locale;
	screen: "profile" | "password" | "link";
}) {
	const t = authCopy[locale],
		s = sellerSettingsCopy[locale],
		copy = sellerAccountSettingsCopy[locale];
	const query = useSearchParams().get("seller");
	const seller = query && uuidPattern.test(query) ? query : null;
	const [data, setData] = useState<SessionData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState({ ...emptySellerDraft });
	const [fields, setFields] = useState<string[]>([]);
	const [available, setAvailable] = useState<boolean | null>(null);
	const live = useRef<object | null>(null),
		reads = useRef(0),
		identity = useRef<string | null>(null);
	const baseline = useRef(""),
		inputs = useRef(draft),
		authority = useRef(0),
		readError = useRef(false);
	const write = useRef<{ kind: string; owner: object } | null>(null);
	const deferredSessionCheck = useRef(false);
	const change = (key: SellerDraftKey, value: string) => {
		inputs.current = { ...inputs.current, [key]: value };
		setDraft(inputs.current);
		setFields((current) => current.filter((field) => field !== key));
	};
	const dirty =
		draft.display_name !== baseline.current ||
		!!(
			draft.current_password ||
			draft.password ||
			draft.repeat ||
			draft.google_password
		);
	const { choose, feedback } = useSettingsGuard(locale, dirty);
	const navigate = useNavigation();
	const operation = useRef<object | null>(null);
	const clearPrivate = useCallback(() => {
		authority.current++;
		operation.current = null;
		deferredSessionCheck.current = false;
		identity.current = null;
		write.current = null;
		baseline.current = "";
		inputs.current = { ...emptySellerDraft };
		setDraft(inputs.current);
		setData(null);
		setBusy(false);
		setFields([]);
		setNotice("");
	}, []);
	const refresh = useCallback(async () => {
		const life = live.current,
			generation = ++reads.current;
		if (!life) return;
		try {
			const value = await accountSession("seller");
			if (live.current !== life || reads.current !== generation) return;
			const key = `${value.identity.id}:${value.accounts[0].id}`;
			if (identity.current !== key) {
				clearPrivate();
				identity.current = key;
				baseline.current = value.identity.display_name;
				inputs.current = {
					...emptySellerDraft,
					display_name: baseline.current,
				};
				setDraft(inputs.current);
			} else if (inputs.current.display_name === baseline.current) {
				baseline.current = value.identity.display_name;
				inputs.current = { ...inputs.current, display_name: baseline.current };
				setDraft(inputs.current);
			}
			setData(value);
			if (readError.current) {
				setError("");
				readError.current = false;
			}
		} catch (failure) {
			if (live.current !== life || reads.current !== generation) return;
			readError.current = true;
			if (
				failure instanceof AccountError &&
				[401, 403, 404].includes(failure.status ?? 0)
			) {
				clearPrivate();
				setError(t.anonymous);
			} else {
				// A transient read failure must not unmount an editable form.
				setError(t.unavailable);
			}
		} finally {
			if (live.current === life && reads.current === generation)
				setLoading(false);
		}
	}, [clearPrivate, t]);
	useEffect(() => {
		live.current = {};
		const load = () => {
			if (!write.current) void refresh();
		};
		const changed = () => {
			// These owned successes intentionally invalidate the session below.
			if (["password", "logout"].includes(write.current?.kind ?? "")) {
				deferredSessionCheck.current = true;
				return;
			}
			void refresh();
		};
		load();
		window.addEventListener("focus", load);
		window.addEventListener(ACCOUNT_SESSION_CHANGED, changed);
		const timer = setInterval(load, 30000);
		return () => {
			live.current = null;
			operation.current = null;
			reads.current++;
			write.current = null;
			identity.current = null;
			inputs.current = { ...emptySellerDraft };
			window.removeEventListener("focus", load);
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, changed);
			clearInterval(timer);
		};
	}, [refresh]);
	useEffect(() => {
		if (screen === "password") return;
		let current = true;
		void googleAvailability()
			.then((value) => {
				if (current) setAvailable(value.status === "google_available");
			})
			.catch(() => {
				if (current) setAvailable(false);
			});
		return () => {
			current = false;
		};
	}, [screen]);
	async function mutate(
		kind: string,
		path: string,
		payload: Record<string, unknown>,
		expectedLife: object | null,
		expectedIdentity: string | null,
		method = "POST",
	) {
		if (
			!expectedLife ||
			!expectedIdentity ||
			live.current !== expectedLife ||
			identity.current !== expectedIdentity ||
			write.current
		)
			return;
		const owner = {},
			epoch = authority.current;
		write.current = { kind, owner };
		operation.current = owner;
		let navigating = false;
		reads.current++;
		setBusy(true);
		readError.current = false;
		setError("");
		setFields([]);
		setNotice("");
		const owns = () =>
			live.current === expectedLife &&
			authority.current === epoch &&
			identity.current === expectedIdentity &&
			write.current?.owner === owner;
		try {
			const result: AuthResult = await authMutation(path, payload, method);
			if (!owns()) return;
			reads.current++;
			if (result.identity && data && result.identity.id !== data.identity.id) {
				clearPrivate();
				void refresh();
				return;
			}
			if (kind === "google") {
				if (result.status !== "redirect" || !result.authorization_url)
					throw new Error();
				const url = new URL(result.authorization_url);
				if (
					url.origin !== "https://accounts.google.com" ||
					url.pathname !== "/o/oauth2/v2/auth"
				)
					throw new Error();
				// Use the navigation owner so confirmation also permits native unload.
				// A cancelled redirect leaves every unsaved field intact.
				navigate(() => {
					if (
						live.current !== expectedLife ||
						authority.current !== epoch ||
						identity.current !== expectedIdentity ||
						operation.current !== owner
					)
						return;
					navigating = true;
					write.current = { kind, owner };
					setBusy(true);
					window.location.assign(url.href);
				});
			} else if (kind === "password" || kind === "logout") {
				clearPrivate();
				setNotice(kind === "password" ? t.passwordUpdated : t.signedOut);
			} else if (kind === "profile") {
				const name =
					result.identity?.display_name ?? String(payload.display_name ?? "");
				baseline.current = name;
				inputs.current = { ...inputs.current, display_name: name };
				setDraft(inputs.current);
				if (data)
					setData({
						...data,
						identity: { ...data.identity, display_name: name },
					});
				setNotice(t.updated);
				void refresh();
			} else {
				inputs.current = { ...inputs.current, current_password: "" };
				setDraft(inputs.current);
				setNotice(t.linkDone);
				void refresh();
			}
		} catch (failure) {
			if (!owns()) return;
			setError(
				failure instanceof AccountError
					? failure.code === "registration_closed"
						? t.registrationClosed
						: failure.status === 429
							? t.limited
							: failure.code === "csrf_failed"
								? t.stale
								: failure.status === 403
									? t.denied
									: t.invalid
					: kind === "google"
						? googleCopy[locale].provider_error
						: t.unavailable,
			);
			if (failure instanceof AccountError) {
				const allowed =
					kind === "google"
						? ["password"]
						: screen === "profile"
							? ["display_name"]
							: screen === "link"
								? ["password", "current_password"]
								: ["current_password", "password"];
				setFields(
					failure.fields
						.filter((field) => allowed.includes(field))
						.map((field) =>
							kind === "google"
								? "google_password"
								: screen === "link" && field === "password"
									? "current_password"
									: field,
						),
				);
				if ([401, 403, 404].includes(failure.status ?? 0)) void refresh();
			}
		} finally {
			if (owns() && !navigating) {
				write.current = null;
				setBusy(false);
				if (deferredSessionCheck.current) {
					deferredSessionCheck.current = false;
					void refresh();
				}
			}
		}
	}
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (write.current || !data) return;
		if (screen === "password" && draft.password !== draft.repeat) {
			setError(t.mismatch);
			setFields(["repeat"]);
			return;
		}
		void mutate(
			screen,
			screen === "link" ? "seller/link/buyer/" : `seller/${screen}/`,
			screen === "profile"
				? { display_name: draft.display_name }
				: screen === "link"
					? { password: draft.current_password }
					: {
							current_password: draft.current_password,
							password: draft.password,
						},
			live.current,
			identity.current,
			screen === "profile" ? "PATCH" : "POST",
		);
	}
	function googleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (write.current || !available || !data) return;
		void mutate(
			"google",
			"google/start/",
			{
				locale,
				context: screen === "link" ? "buyer" : "seller",
				source_context: "seller",
				action: screen === "link" ? "add-role" : "link",
				...(screen === "profile" ? { password: draft.google_password } : {}),
				return_path: safeReturn(
					sellerHref(locale, screen, seller),
					locale,
					screen === "link" ? "buyer" : "seller",
				),
			},
			live.current,
			identity.current,
		);
	}
	const field = (key: SellerDraftKey, label: string, password = true) => (
		<SellerAccountField
			key={key}
			locale={locale}
			name={key}
			label={label}
			value={draft[key]}
			password={password}
			error={
				fields.includes(key)
					? key === "repeat"
						? t.mismatch
						: copy.fieldError
					: undefined
			}
			disabled={busy}
			onChange={(value) => change(key, value)}
		/>
	);
	const google = (
		<form
			onSubmit={googleSubmit}
			className="max-w-2xl space-y-4"
			aria-busy={busy}
		>
			{screen === "profile" &&
				available &&
				field("google_password", t.currentPassword)}
			<Button type="submit" variant="google" disabled={!available || busy}>
				{busy ? googleCopy[locale].loading : googleCopy[locale].button}
			</Button>
			{available === null ? (
				<p role="status" className="text-sm text-muted">
					{t.loading}
				</p>
			) : (
				!available && (
					<p className="text-sm text-muted">{googleCopy[locale].unavailable}</p>
				)
			)}
		</form>
	);
	return (
		<SettingsPage locale={locale} page={screen}>
			{loading && <p role="status">{s.loading}</p>}
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
					{screen === "profile" ? (
						<>
							<SettingsSection
								title={s.profile}
								description={copy.nameHelp}
								icon="user-circle"
							>
								<form
									onSubmit={submit}
									className="max-w-2xl space-y-4"
									aria-busy={busy}
								>
									{field("display_name", t.name, false)}
									<SettingsActions
										locale={locale}
										dirty={draft.display_name !== baseline.current}
									>
										<Button
											type="submit"
											disabled={busy || draft.display_name === baseline.current}
										>
											{busy ? t.saving : t.editProfile}
										</Button>
									</SettingsActions>
								</form>
							</SettingsSection>
							<SettingsSection
								title={copy.summary}
								description={copy.summaryHelp}
								icon="user-circle"
							>
								<AccountSummary data={data} locale={locale} />
								<p className="text-sm text-muted">
									{organizationCopy[locale].approvalScope}
								</p>
								<Link
									className={settingsSecondary}
									href={sellerHref(locale, "organizations", seller)}
								>
									{organizationCopy[locale].title}
								</Link>
							</SettingsSection>
							<SettingsSection
								title={copy.google}
								description={copy.googleHelp}
								icon="link"
							>
								{google}
							</SettingsSection>
						</>
					) : (
						<>
							<SettingsSection
								title={
									screen === "link" ? copy.buyerPassword : t.passwordChange
								}
								description={
									screen === "link" ? copy.buyerHelp : copy.passwordHelp
								}
								icon={screen === "link" ? "link" : "shield-lock"}
							>
								<form
									onSubmit={submit}
									className="max-w-2xl space-y-4"
									aria-busy={busy}
								>
									{field("current_password", t.currentPassword)}
									{screen === "password" && (
										<>
											{field("password", t.newPassword)}
											{field("repeat", t.repeat)}
										</>
									)}
									<SettingsActions
										locale={locale}
										dirty={
											!!(
												draft.current_password ||
												draft.password ||
												draft.repeat
											)
										}
									>
										<Button type="submit" disabled={busy}>
											{busy ? t.saving : t.submit}
										</Button>
									</SettingsActions>
								</form>
								{notice === t.linkDone && (
									<Link
										className={settingsSecondary}
										href={`/${locale}/auth/buyer-sign-in`}
									>
										{t.buyer} · {t.signin}
									</Link>
								)}
							</SettingsSection>
							{screen === "link" && (
								<SettingsSection
									title={copy.buyerGoogle}
									description={s.linkHelp}
									icon="link"
								>
									{google}
								</SettingsSection>
							)}
							<SettingsSection
								title={googleCopy[locale].recovery}
								description={copy.recoveryHelp}
								icon="shield-lock"
							>
								<Link
									className={settingsSecondary}
									href={`/${locale}/auth/forgot-password`}
								>
									{googleCopy[locale].recovery}
								</Link>
							</SettingsSection>
						</>
					)}
					<SettingsSection
						title={copy.signout}
						description={copy.signoutHelp}
						icon="shield-lock"
					>
						<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
							{[false, true].map((all) => (
								<Button
									key={String(all)}
									type="button"
									variant="secondary"
									disabled={busy}
									onClick={() => {
										const life = live.current,
											account = identity.current,
											epoch = authority.current;
										choose(() => {
											if (authority.current !== epoch) return;
											void mutate(
												"logout",
												all ? "logout-all/" : "seller/logout/",
												{},
												life,
												account,
											);
										});
									}}
								>
									{all ? copy.signoutAll : copy.signout}
								</Button>
							))}
						</div>
					</SettingsSection>
				</>
			) : (
				!loading && (
					<div className="flex flex-wrap gap-3">
						<Link
							className={settingsSecondary}
							href={`/${locale}/auth/seller-sign-in`}
						>
							{t.backSignin}
						</Link>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void refresh()}
						>
							{t.retry}
						</Button>
					</div>
				)
			)}
			{feedback}
		</SettingsPage>
	);
}

function SellerAccountField({
	locale,
	name,
	label,
	value,
	password,
	error,
	disabled,
	onChange,
}: {
	locale: Locale;
	name: SellerDraftKey;
	label: string;
	value: string;
	password: boolean;
	error?: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const [revealed, setRevealed] = useState(false);
	const id = `seller-account-${name}`;
	useEffect(() => {
		if (!value) setRevealed(false);
	}, [value]);
	return (
		<div className="min-w-0 space-y-2">
			<label htmlFor={id} className="block text-sm font-semibold">
				{label}
			</label>
			<div className="flex min-w-0 items-stretch gap-2">
				<input
					id={id}
					name={name}
					className={settingsControl}
					type={password && !revealed ? "password" : "text"}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					required
					minLength={name === "password" || name === "repeat" ? 12 : undefined}
					maxLength={name === "display_name" ? 150 : 128}
					autoComplete={
						password
							? name === "current_password" || name === "google_password"
								? "current-password"
								: "new-password"
							: "name"
					}
					dir={password ? "ltr" : undefined}
					disabled={disabled}
					aria-invalid={!!error}
					aria-describedby={error ? `${id}-error` : undefined}
				/>
				{password && (
					<button
						type="button"
						className="inline-flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50"
						disabled={disabled}
						aria-label={
							revealed
								? sellerSettingsCopy[locale].hide
								: sellerSettingsCopy[locale].show
						}
						title={
							revealed
								? sellerSettingsCopy[locale].hide
								: sellerSettingsCopy[locale].show
						}
						aria-controls={id}
						aria-pressed={revealed}
						onClick={() => setRevealed((value) => !value)}
					>
						<Icon
							name="eye"
							className={revealed ? "size-5" : "size-5 text-muted"}
						/>
					</button>
				)}
			</div>
			{error && (
				<p id={`${id}-error`} className="text-sm text-danger" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
