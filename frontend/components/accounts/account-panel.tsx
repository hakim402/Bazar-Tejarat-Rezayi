"use client";
import { organizationCopy } from "../../lib/i18n/organizations";
import toast from "react-hot-toast";
import { Camera, Pencil, Trash2 } from "lucide-react";
import type { ProfileIdentity } from "../../features/identity/api/profile";
import {
	emptyProfileDraft,
	profileDraft,
	profileFieldNames,
	ProfileFields,
} from "../../features/identity/components/profile-fields";
import { mediaUrl } from "../../features/marketplace/api";
import { ConfirmDialog } from "../../features/orders/components/detail-dialog";
import { buyerProfileCopy } from "../../lib/i18n/buyer-profile";
import { Card } from "../shadcn/card";
import { Badge } from "../shadcn/badge";
import { salesTableCard } from "../../features/sales/components/seller-sales-ui";
import { Button } from "../shadcn/button";
import { Input } from "../shadcn/input";
import { FormField } from "../ui/dialog-form";
import { GoogleMark } from "../authentication/google-entry";
import { Alert } from "../ui/alert";
import Link from "next/link";
import { AccountSummary } from "./account-summary";
import { Icon } from "../ui/icon";
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
	BusinessSection,
	BusinessDialog,
	SettingsActions,
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
	return (
		<SellerAccountPanel
			key={`${props.locale}:${props.screen ?? "profile"}`}
			locale={props.locale}
			screen={(props.screen ?? "profile") as "profile" | "password" | "link"}
		/>
	);
}
type SellerSession = SessionData & { identity: ProfileIdentity };
const emptySellerDraft = {
	...emptyProfileDraft,
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
		copy = sellerAccountSettingsCopy[locale],
		profileCopy = buyerProfileCopy[locale];
	const query = useSearchParams().get("seller");
	const seller = query && uuidPattern.test(query) ? query : null;
	const [data, setData] = useState<SellerSession | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState({ ...emptySellerDraft });
	const [fields, setFields] = useState<string[]>([]);
	const [available, setAvailable] = useState<boolean | null>(null);
	const [dialog, setDialog] = useState<"profile" | "photo" | "google" | null>(
		null,
	);
	const [photo, setPhoto] = useState<File | null>(null);
	const [removePhoto, setRemovePhoto] = useState(false);
	const [preview, setPreview] = useState("");
	useEffect(() => {
		if (!photo) {
			setPreview("");
			return;
		}
		const url = URL.createObjectURL(photo);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [photo]);
	useEffect(() => {
		if (error) toast.error(error);
	}, [error]);
	useEffect(() => {
		if (notice) toast.success(notice);
	}, [notice]);
	const live = useRef<object | null>(null),
		reads = useRef(0),
		identity = useRef<string | null>(null);
	const baseline = useRef({ ...emptyProfileDraft }),
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
	const profileDirty = profileFieldNames.some(
		(key) => draft[key] !== baseline.current[key],
	);
	const dirty =
		profileDirty ||
		!!photo ||
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
		baseline.current = { ...emptyProfileDraft };
		setPhoto(null);
		setRemovePhoto(false);
		inputs.current = { ...emptySellerDraft };
		setDraft(inputs.current);
		setData(null);
		setDialog(null);
		setBusy(false);
		setFields([]);
		setNotice("");
	}, []);
	const refresh = useCallback(async () => {
		const life = live.current,
			generation = ++reads.current;
		if (!life) return;
		try {
			const value = (await accountSession("seller")) as SellerSession;
			if (live.current !== life || reads.current !== generation) return;
			const key = `${value.identity.id}:${value.accounts[0].id}`;
			if (identity.current !== key) {
				clearPrivate();
				identity.current = key;
				baseline.current = profileDraft(value.identity);
				inputs.current = { ...emptySellerDraft, ...baseline.current };
				setDraft(inputs.current);
			} else if (
				profileFieldNames.every(
					(key) => inputs.current[key] === baseline.current[key],
				)
			) {
				baseline.current = profileDraft(value.identity);
				inputs.current = { ...inputs.current, ...baseline.current };
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
		payload: Record<string, unknown> | FormData,
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
			} else if (["profile", "photo", "remove-photo"].includes(kind)) {
				if (!result.identity) throw new Error();
				const updated = result.identity as ProfileIdentity;
				baseline.current = profileDraft(updated);
				inputs.current = { ...inputs.current, ...baseline.current };
				setDraft(inputs.current);
				setData((current) =>
					current ? { ...current, identity: updated } : null,
				);
				setPhoto(null);
				setDialog(null);
				setNotice(
					kind === "profile"
						? profileCopy.saved
						: kind === "photo"
							? profileCopy.photoSaved
							: profileCopy.photoRemoved,
				);
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
							? [...profileFieldNames, "file"]
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
				? Object.fromEntries(
						profileFieldNames
							.filter((key) => draft[key] !== baseline.current[key])
							.map((key) => [
								key,
								key === "date_of_birth" ? draft[key] || null : draft[key],
							]),
					)
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
	function closeDialog() {
		if (busy) return;
		choose(() => {
			if (dialog === "profile") {
				baseline.current = data
					? profileDraft(data.identity)
					: { ...emptyProfileDraft };
				inputs.current = { ...inputs.current, ...baseline.current };
				setDraft(inputs.current);
			} else if (dialog === "photo") setPhoto(null);
			else change("google_password", "");
			setError("");
			setFields([]);
			setDialog(null);
		});
	}
	function uploadPhoto(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!photo || write.current) return;
		const form = new FormData();
		form.append("file", photo);
		void mutate(
			"photo",
			"seller/profile/avatar/",
			form,
			live.current,
			identity.current,
		);
	}
	const avatarUrl = data?.identity.avatar
		? mediaUrl(data.identity.avatar.url)
		: null;
	const photoUrl = preview || avatarUrl;
	const google = (
		<form
			onSubmit={googleSubmit}
			className="max-w-2xl space-y-4"
			aria-busy={busy}
		>
			{screen === "profile" &&
				available &&
				field("google_password", t.currentPassword)}
			<Button
				type="submit"
				variant="outline"
				disabled={!available || busy}
				className="google-button h-auto min-h-11 gap-2 whitespace-normal"
			>
				<GoogleMark />
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
							<Card className={salesTableCard}>
								<div className="flex flex-col items-center gap-3 border-0 border-b border-solid border-border px-4 py-6 text-center sm:px-5">
									<BusinessDialog
										locale={locale}
										title={profileCopy.photo}
										description={profileCopy.photoHelp}
										open={dialog === "photo"}
										onOpenChange={(open) =>
											open ? setDialog("photo") : closeDialog()
										}
										busy={busy}
										trigger={
											<Button
												type="button"
												variant="ghost"
												className="relative size-24 rounded-full border border-solid border-border bg-page p-0"
												aria-label={profileCopy.changePhoto}
												title={profileCopy.changePhoto}
											>
												{avatarUrl ? (
													<img
														src={avatarUrl}
														alt=""
														width={96}
														height={96}
														className="size-full rounded-full object-cover"
													/>
												) : (
													<Icon
														name="user-circle"
														className="size-12 text-muted"
													/>
												)}
												<span className="absolute bottom-0 end-0 flex size-8 items-center justify-center rounded-full border border-solid border-border bg-surface text-action">
													<Camera className="size-4" aria-hidden="true" />
												</span>
											</Button>
										}
									>
										{error && (
											<Alert variant="danger" role="alert">
												{error}
											</Alert>
										)}
										<form
											onSubmit={uploadPhoto}
											className="space-y-5"
											aria-busy={busy}
										>
											<div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full border border-solid border-border bg-page">
												{photoUrl ? (
													<img
														src={photoUrl}
														alt={profileCopy.photoPreview}
														width={112}
														height={112}
														className="size-full object-cover"
													/>
												) : (
													<Icon
														name="user-circle"
														className="size-14 text-muted"
													/>
												)}
											</div>
											<FormField
												id="seller-profile-photo"
												label={profileCopy.choosePhoto}
												error={
													fields.includes("file") ? copy.fieldError : undefined
												}
											>
												<Input
													id="seller-profile-photo"
													type="file"
													accept="image/jpeg,image/png,image/webp"
													disabled={busy}
													aria-invalid={fields.includes("file")}
													aria-describedby={
														fields.includes("file")
															? "seller-profile-photo-error"
															: undefined
													}
													onChange={(event) => {
														const file = event.target.files?.[0];
														if (!file) return;
														setError("");
														setFields([]);
														if (
															![
																"image/jpeg",
																"image/png",
																"image/webp",
															].includes(file.type) ||
															file.size > 8 * 1024 * 1024 ||
															file.size === 0
														) {
															setPhoto(null);
															event.target.value = "";
															setError(t.invalid);
															setFields(["file"]);
															return;
														}
														setPhoto(file);
													}}
												/>
											</FormField>
											<SettingsActions locale={locale} dirty={!!photo}>
												{avatarUrl && (
													<Button
														type="button"
														variant="outline"
														className="text-danger"
														disabled={busy || !!photo}
														onClick={() => setRemovePhoto(true)}
													>
														<Trash2 className="size-4" aria-hidden="true" />
														{profileCopy.removePhoto}
													</Button>
												)}
												<Button
													type="button"
													variant="outline"
													disabled={busy}
													onClick={closeDialog}
												>
													{profileCopy.cancel}
												</Button>
												<Button type="submit" disabled={busy || !photo}>
													{busy ? t.saving : profileCopy.uploadPhoto}
												</Button>
											</SettingsActions>
										</form>
										<ConfirmDialog
											locale={locale}
											open={removePhoto}
											title={profileCopy.removePhoto}
											body={copy.sharedProfileHelp}
											confirmLabel={profileCopy.removePhoto}
											destructive
											busy={busy}
											onCancel={() => setRemovePhoto(false)}
											onConfirm={() => {
												setRemovePhoto(false);
												void mutate(
													"remove-photo",
													"seller/profile/avatar/",
													{},
													live.current,
													identity.current,
													"DELETE",
												);
											}}
										/>
									</BusinessDialog>
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center justify-center gap-2">
											<h2 className="m-0 text-lg font-semibold wrap-anywhere">
												<bdi>{data.identity.display_name}</bdi>
											</h2>
											<Badge
												variant="secondary"
												className={
													data.identity.email_verified
														? "border-0 bg-success-surface text-success"
														: "border-0 bg-warning-surface text-warning"
												}
											>
												{data.identity.email_verified
													? t.verifiedLabel
													: profileCopy.notVerified}
											</Badge>
										</div>
										<p className="m-0 text-sm text-muted wrap-anywhere">
											<bdi dir="ltr">{data.identity.email}</bdi>
										</p>
										<p className="m-0 text-xs text-muted">
											{profileCopy.memberSince.replace(
												"{date}",
												new Intl.DateTimeFormat(locale, {
													year: "numeric",
													month: "long",
													day: "numeric",
												}).format(new Date(data.identity.date_joined)),
											)}
										</p>
									</div>
								</div>
								<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
									<div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
										<h3 className="m-0 text-base font-semibold">
											{profileCopy.personalDetails}
										</h3>
										<p className="m-0 mt-1 text-xs text-muted">
											{copy.sharedProfileHelp}
										</p>
									</div>
									<BusinessDialog
										locale={locale}
										title={profileCopy.editProfile}
										description={copy.sharedProfileHelp}
										open={dialog === "profile"}
										onOpenChange={(open) =>
											open ? setDialog("profile") : closeDialog()
										}
										busy={busy}
										trigger={
											<Button type="button" variant="outline" size="sm">
												<Pencil className="size-4" aria-hidden="true" />
												{profileCopy.editProfile}
											</Button>
										}
									>
										{error && (
											<Alert variant="danger" role="alert">
												{error}
											</Alert>
										)}
										<form
											onSubmit={submit}
											className="max-w-2xl space-y-4"
											aria-busy={busy}
										>
											<div className="grid gap-4 sm:grid-cols-2">
												<ProfileFields
													locale={locale}
													idPrefix="seller-profile"
													draft={draft}
													onChange={change}
													disabled={busy}
													errors={fields}
												/>
											</div>
											<SettingsActions locale={locale} dirty={profileDirty}>
												<Button
													type="button"
													variant="outline"
													disabled={busy}
													onClick={closeDialog}
												>
													{profileCopy.cancel}
												</Button>
												<Button type="submit" disabled={busy || !profileDirty}>
													{busy ? t.saving : profileCopy.save}
												</Button>
											</SettingsActions>
										</form>
									</BusinessDialog>
								</div>
								<div className="px-4 sm:px-5">
									<AccountSummary data={data} locale={locale} />
								</div>
							</Card>
							<div className="grid items-start gap-4 lg:grid-cols-2">
								<BusinessSection
									title={profileCopy.security}
									description={profileCopy.securityHelp}
								>
									<div className="space-y-2">
										{(
											[
												{
													path: "password",
													label: s.password,
													icon: "shield-lock",
												},
												{ path: "link", label: s.link, icon: "link" },
												{
													path: "settings",
													label: profileCopy.accountSettings,
													icon: "gear",
												},
											] as const
										).map((row) => (
											<Button
												key={row.path}
												asChild
												variant="ghost"
												className="h-auto min-h-11 w-full justify-start whitespace-normal px-3 py-3 text-start"
											>
												<Link href={sellerHref(locale, row.path, seller)}>
													<Icon
														name={row.icon}
														className="size-4 shrink-0 text-muted"
													/>
													<span className="flex-1">{row.label}</span>
													<Icon
														name="arrow"
														className="size-4 shrink-0 rtl:rotate-180"
													/>
												</Link>
											</Button>
										))}
										<BusinessDialog
											locale={locale}
											title={copy.google}
											description={copy.googleHelp}
											open={dialog === "google"}
											onOpenChange={(open) =>
												open ? setDialog("google") : closeDialog()
											}
											busy={busy}
											trigger={
												<Button
													type="button"
													variant="outline"
													className="w-full justify-start"
												>
													<GoogleMark />
													{copy.google}
												</Button>
											}
										>
											{error && (
												<Alert variant="danger" role="alert">
													{error}
												</Alert>
											)}
											{google}
										</BusinessDialog>
									</div>
								</BusinessSection>
								<BusinessSection
									title={organizationCopy[locale].title}
									icon="store"
								>
									<p className="text-sm text-muted">
										{organizationCopy[locale].approvalScope}
									</p>
									<Link
										className={settingsSecondary}
										href={sellerHref(locale, "organizations", seller)}
									>
										{organizationCopy[locale].title}
									</Link>
								</BusinessSection>
							</div>
						</>
					) : (
						<>
							<Card
								className={`${salesTableCard} flex-row items-center gap-3 p-4! sm:px-5!`}
							>
								<span
									className="flex size-11 shrink-0 items-center justify-center rounded-full bg-info text-action"
									aria-hidden="true"
								>
									<Icon name="user-circle" className="size-6" />
								</span>
								<div className="min-w-0">
									<p className="m-0 text-sm font-semibold wrap-anywhere">
										<bdi>{data.identity.display_name}</bdi>
									</p>
									<p className="m-0 text-xs text-muted wrap-anywhere">
										<bdi dir="ltr">{data.identity.email}</bdi>
									</p>
								</div>
							</Card>
							<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
								<BusinessSection
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
								</BusinessSection>
								<div className="space-y-4">
									{screen === "link" && (
										<BusinessSection
											title={copy.buyerGoogle}
											description={s.linkHelp}
											icon="link"
										>
											{google}
										</BusinessSection>
									)}
									<BusinessSection
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
									</BusinessSection>
								</div>
							</div>
						</>
					)}
					<BusinessSection
						title={copy.signout}
						description={copy.signoutHelp}
						icon="shield-lock"
					>
						<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
							{[false, true].map((all) => (
								<Button
									key={String(all)}
									type="button"
									className="h-auto min-h-11 whitespace-normal text-start"
									variant="outline"
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
					</BusinessSection>
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
							variant="outline"
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
	const toggle = revealed
		? sellerSettingsCopy[locale].hide
		: sellerSettingsCopy[locale].show;
	return (
		<FormField
			id={id}
			label={label}
			required
			error={error}
			trailing={
				password ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={disabled}
						aria-label={toggle}
						title={toggle}
						aria-controls={id}
						aria-pressed={revealed}
						onClick={() => setRevealed((value) => !value)}
					>
						<Icon
							name="eye"
							className={revealed ? "size-4" : "size-4 text-muted"}
						/>
					</Button>
				) : undefined
			}
		>
			<Input
				id={id}
				name={name}
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
		</FormField>
	);
}
