"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
	locales,
	languageNames,
	direction,
	type Locale,
} from "../../../../../../../../lib/i18n/locales";
import {
	privateRequest,
	AccountError,
} from "../../../../../../../../lib/api/private-client";
import { marketplaceCopy } from "../../../../../../../../features/marketplace/copy";
import type {
	PrivateStore,
	StoreBody,
	StoreProfiles,
} from "../../../../../../../../features/marketplace/types";
import { Asset } from "../../../../../../../../features/marketplace/components/cards";
import {
	SettingsPage,
	SettingsSection,
	SettingsActions,
	settingsControl,
	settingsSecondary,
	useSettingsGuard,
} from "../../../../../../../../components/accounts/seller-settings-ui";
import { sellerSettingsCopy } from "../../../../../../../../lib/i18n/seller-settings";
import { sellerBusinessSettingsCopy } from "../../../../../../../../lib/i18n/seller-business-settings";
import { sellerHref } from "../../../../../../../../lib/routes/account-routes";
import { SellerSelect } from "../../../components/seller-select";
import { Button } from "../../../../../../../../components/ui/button";
import {
	accessLost,
	useCommunicationSession,
} from "../../../../../../../../features/messaging/hooks";
import { authCopy } from "../../../../../../../../lib/i18n/auth";
const blank = (locale: Locale): StoreBody => ({
	source_locale: locale,
	editions: { [locale]: { description: "", logo_alt: "", banner_alt: "" } },
	country: "",
	city: "",
	logo: null,
	banner: null,
});
const storeFields = [
	"source_locale",
	"editions",
	"description",
	"logo_alt",
	"banner_alt",
	"country",
	"city",
	"logo",
	"banner",
	"file",
	"version",
	"revision",
] as const;
function safeStoreFields(cause: unknown): string[] {
	if (!(cause instanceof AccountError)) return [];
	return [
		...new Set(
			cause.fields.slice(0, 32).flatMap((path) => {
				// Render only known field labels, never arbitrary server strings/messages.
				if (path === "body")
					return ["editions", "country", "city", "logo", "banner"];
				const field = path.split(".").at(-1);
				return storeFields.filter((name) => name === field);
			}),
		),
	];
}
export function StoreSettings({ locale }: { locale: Locale }) {
	const id = useSearchParams().get("seller") || "";
	const session = useCommunicationSession("seller");
	if (session.loading)
		return (
			<SettingsPage locale={locale} page="settings/store">
				<p role="status">{sellerSettingsCopy[locale].loading}</p>
			</SettingsPage>
		);
	if (!session.session)
		return (
			<SettingsPage locale={locale} page="settings/store">
				<p role="alert">
					{accessLost(session.error)
						? authCopy[locale].anonymous
						: authCopy[locale].unavailable}
				</p>
				<Link
					className={settingsSecondary}
					href={`/${locale}/auth/seller-sign-in`}
				>
					{authCopy[locale].backSignin}
				</Link>
			</SettingsPage>
		);
	return (
		<StoreEditor
			key={`${locale}:${session.session.identity.id}:${session.session.accounts[0].id}:${id}`}
			locale={locale}
			id={id}
		/>
	);
}
function StoreEditor({ locale, id }: { locale: Locale; id: string }) {
	const t = marketplaceCopy[locale],
		copy = sellerBusinessSettingsCopy[locale],
		common = sellerSettingsCopy[locale],
		router = useRouter();
	const [profiles, setProfiles] = useState<StoreProfiles | null>(null),
		[item, setItem] = useState<PrivateStore | null>(null),
		[body, setBody] = useState<StoreBody | null>(null),
		[baseline, setBaseline] = useState(""),
		[language, setLanguage] = useState<Locale>(locale),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false),
		[loading, setLoading] = useState(true),
		[reload, setReload] = useState(0),
		[profilesLoading, setProfilesLoading] = useState(true),
		[profilesError, setProfilesError] = useState(false),
		[fields, setFields] = useState<string[]>([]);
	const requestOwner = useRef<object | null>(null);
	const dirty = !!body && JSON.stringify(body) !== baseline;
	const { choose, feedback } = useSettingsGuard(locale, dirty);
	const fieldInvalid = (field: string) =>
		fields.includes(field) ||
		(["description", "logo_alt", "banner_alt"].includes(field) &&
			fields.includes("editions"));
	const fieldFeedback = (field: string) =>
		fieldInvalid(field) ? (
			<p id={`store-${field}-error`} className="text-sm text-danger">
				{copy.fieldError}
			</p>
		) : null;
	function changeBody(value: StoreBody) {
		if (
			requestOwner.current ||
			loading ||
			!item?.can_edit ||
			item.id !== id ||
			item.revisions[0]?.state === "submitted"
		)
			return;
		setBody(value);
		setNotice("");
	}
	function reloadCurrent() {
		if (requestOwner.current || loading || profilesLoading) return;
		choose(() => {
			if (requestOwner.current) return;
			requestOwner.current = {};
			setBusy(true);
			setLoading(true);
			setReload((value) => value + 1);
		});
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit reload owns the profile refresh too.
	useEffect(() => {
		let active = true;
		setProfiles(null);
		setProfilesLoading(true);
		setProfilesError(false);
		privateRequest<StoreProfiles>("marketplace/seller/stores/")
			.then((value) => {
				if (active) setProfiles(value);
			})
			.catch(() => {
				if (active) setProfilesError(true);
			})
			.finally(() => {
				if (active) setProfilesLoading(false);
			});
		return () => {
			active = false;
		};
	}, [reload]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload is an intentional explicit refresh token; never refresh on stale writes.
	useEffect(() => {
		let active = true;
		requestOwner.current = null;
		setBusy(false);
		setItem(null);
		setBody(null);
		setError("");
		setFields([]);
		setNotice("");
		setLoading(true);
		if (!id) {
			setLoading(false);
			return;
		}
		privateRequest<PrivateStore>(`marketplace/seller/stores/${id}/`)
			.then((value) => {
				if (!active) return;
				const latest = value.revisions[0];
				const draft = (latest?.body as StoreBody | undefined) || blank(locale);
				setItem(value);
				setBody(structuredClone(draft));
				setLanguage(draft.editions[locale] ? locale : draft.source_locale);
				setBaseline(JSON.stringify(draft));
			})
			.catch((cause) => {
				if (active)
					setError(
						cause instanceof AccountError &&
							[403, 404].includes(cause.status || 0)
							? t.denied
							: t.unavailable,
					);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
			requestOwner.current = null;
		};
	}, [id, locale, reload, t.denied, t.unavailable]);
	function failure(cause: unknown, fallback: string) {
		if (accessLost(cause)) {
			setItem(null);
			setBody(null);
			setBaseline("");
			setProfiles(null);
			setNotice("");
		}
		setFields(safeStoreFields(cause));
		setError(
			cause instanceof AccountError
				? cause.status === 409
					? t.stale
					: cause.status === 403 || cause.status === 404
						? t.denied
						: fallback
				: fallback,
		);
	}
	async function mutate(action: "save" | "submit" | "withdraw") {
		if (
			!item ||
			item.id !== id ||
			!body ||
			requestOwner.current ||
			!item.can_edit ||
			loading
		)
			return;
		const latest = item.revisions[0];
		if (action === "save" && (latest?.state === "submitted" || !dirty)) return;
		if (action === "submit" && (dirty || latest?.state !== "draft")) return;
		if (action === "withdraw" && latest?.state !== "submitted") return;
		const current = {};
		requestOwner.current = current;
		setBusy(true);
		setError("");
		setFields([]);
		setNotice("");
		try {
			const value = await privateRequest<PrivateStore>(
				`marketplace/seller/stores/${id}/${action === "save" ? "" : "actions/"}`,
				action === "save"
					? { version: item.version, body }
					: { version: item.version, revision: latest?.id, action },
			);
			if (requestOwner.current !== current) return;
			setItem(value);
			if (action === "save") setBaseline(JSON.stringify(body));
			setNotice(
				action === "save"
					? copy.draftSaved
					: action === "submit"
						? copy.reviewSubmitted
						: copy.reviewWithdrawn,
			);
		} catch (cause) {
			if (requestOwner.current === current)
				failure(
					cause,
					action === "save"
						? copy.saveFailed
						: action === "submit"
							? copy.submitFailed
							: copy.withdrawFailed,
				);
		} finally {
			if (requestOwner.current === current) {
				requestOwner.current = null;
				setBusy(false);
			}
		}
	}
	async function upload(role: "logo" | "banner", file: File | undefined) {
		if (
			!file ||
			!item ||
			item.id !== id ||
			!body ||
			requestOwner.current ||
			!item.can_edit ||
			loading ||
			item.revisions[0]?.state === "submitted"
		)
			return;
		const current = {};
		requestOwner.current = current;
		setBusy(true);
		setError("");
		setFields([]);
		setNotice("");
		const data = new FormData();
		data.set("version", String(item.version));
		data.set("file", file);
		try {
			const result = await privateRequest<{
				id: string;
				url: string;
				width: number;
				height: number;
				version: number;
			}>(`marketplace/seller/stores/${id}/uploads/`, data);
			if (requestOwner.current !== current) return;
			setItem({
				...item,
				version: result.version,
				media: [...item.media, result],
			});
			setBody({ ...body, [role]: result.id });
			setNotice(copy.imageAttached);
		} catch (cause) {
			if (requestOwner.current === current) failure(cause, copy.uploadFailed);
		} finally {
			if (requestOwner.current === current) {
				requestOwner.current = null;
				setBusy(false);
			}
		}
	}
	const current = item?.id === id ? item : null,
		latest = current?.revisions[0],
		pending = latest?.state === "submitted",
		editable = !!current?.can_edit && !pending && !busy && !loading,
		canSubmit =
			!!current?.can_edit &&
			!busy &&
			!loading &&
			!dirty &&
			latest?.state === "draft";
	const edition = body?.editions[language],
		approved = current?.revisions.find((row) => row.id === current.published);
	const labels: Record<string, string> = {
		source_locale: t.source,
		editions: copy.publicInformation,
		description: t.description,
		logo_alt: t.logo_alt,
		banner_alt: t.banner_alt,
		country: t.country,
		city: t.city,
		logo: t.logo,
		banner: t.banner,
		file: t.upload,
		version: t.version,
		revision: t.history,
	};
	return (
		<SettingsPage
			locale={locale}
			page="settings/store"
			actions={
				<fieldset
					disabled={busy || loading || profilesLoading}
					className="m-0 min-w-0 space-y-2 border-0 p-0 [&_button]:text-base"
				>
					<p className="text-sm font-medium text-muted">
						{common.businessScope}
					</p>
					<SellerSelect
						label={t.selectStore}
						value={id}
						icon="store"
						options={[
							{ value: "", label: t.selectStore },
							...(profiles?.results.map((profile) => ({
								value: profile.id,
								label: profile.name,
							})) ?? []),
						]}
						onChange={(value) => {
							if (requestOwner.current || loading || profilesLoading) return;
							choose(() => {
								if (!requestOwner.current)
									router.push(sellerHref(locale, "settings/store", value));
							});
						}}
					/>
				</fieldset>
			}
		>
			<div
				className="space-y-6"
				data-testid="store-settings"
				aria-busy={busy || loading || profilesLoading}
			>
				{feedback}
				{(loading || profilesLoading || busy) && (
					<p role="status" className="text-sm text-muted">
						{common.loading}
					</p>
				)}
				{profilesError && (
					<p
						role="alert"
						className="rounded-xl border border-danger bg-surface p-4 text-danger"
					>
						{copy.profilesFailed}
					</p>
				)}
				{profiles && !profiles.results.length && (
					<p className="rounded-xl border border-border bg-surface p-4">
						{t.noEligible}
					</p>
				)}
				{!id && !loading && !profilesLoading && !!profiles?.results.length && (
					<p className="rounded-xl border border-border bg-surface p-4">
						{copy.selectedRequired}
					</p>
				)}
				{error && (
					<div
						role="alert"
						className="space-y-2 rounded-xl border border-danger bg-surface p-4 text-danger"
					>
						<p>{error}</p>
						{fields.length > 0 && (
							<p>
								{copy.checkFields}{" "}
								{fields.map((field) => labels[field]).join(" · ")}
							</p>
						)}
					</div>
				)}
				{notice && (
					<p
						role="status"
						className="rounded-xl border border-border bg-success-surface p-4 text-success"
					>
						{notice}
					</p>
				)}
				{(!current || !body) && (
					<Button
						variant="secondary"
						disabled={busy || loading || profilesLoading}
						onClick={reloadCurrent}
					>
						{common.reload}
					</Button>
				)}
				{current && body && (
					<>
						<SettingsSection
							title={copy.businessStatus}
							icon="store"
							actions={
								<Link
									className={settingsSecondary}
									href={`/${locale}/stores/${id}`}
								>
									{t.openStore}
								</Link>
							}
						>
							<div className="grid gap-4 md:grid-cols-2">
								<div>
									<p className="text-sm text-muted">{common.businessScope}</p>
									<p className="mt-1 text-lg font-semibold">
										<bdi>{current.name}</bdi>
									</p>
								</div>
								<div className="space-y-2">
									<p>
										{t.version}: <bdi>{current.version}</bdi>
									</p>
									<p>
										{t.status}:{" "}
										<span className="font-semibold">
											{latest
												? t[latest.state as "draft"] || latest.state
												: copy.noRevision}
										</span>
									</p>
								</div>
							</div>
							{!current.can_edit && (
								<p className="rounded-xl bg-info p-4 text-sm">{t.readOnly}</p>
							)}
							{pending && (
								<p className="rounded-xl bg-info p-4 text-sm">
									{copy.pendingHelp}
								</p>
							)}
							{latest?.reason && (
								<p className="whitespace-pre-wrap wrap-anywhere text-sm">
									<span className="font-semibold">{t.reason}: </span>
									{latest.reason}
								</p>
							)}
						</SettingsSection>
						<form
							className="space-y-6"
							onSubmit={(event) => {
								event.preventDefault();
								void mutate("save");
							}}
						>
							<SettingsSection
								title={copy.publicInformation}
								description={copy.manualLanguages}
								icon="globe"
							>
								<p className="rounded-xl bg-info p-4 text-sm leading-relaxed">
									{t.privacy}
								</p>
								<fieldset
									disabled={!editable}
									className="m-0 min-w-0 space-y-5 border-0 p-0"
								>
									<div className="grid items-start gap-5 md:grid-cols-2">
										<div className="space-y-2 [&_button]:text-base">
											<label
												htmlFor="store-source"
												className="block text-sm font-medium"
											>
												{t.source}
											</label>
											<SellerSelect
												id="store-source"
												label={t.source}
												value={body.source_locale}
												options={locales.map((value) => ({
													value,
													label: languageNames[value],
													lang: value,
												}))}
												onChange={(value) => {
													const source = value as Locale;
													changeBody({
														...body,
														source_locale: source,
														editions: {
															...body.editions,
															[source]: body.editions[source] || {
																description: "",
																logo_alt: "",
																banner_alt: "",
															},
														},
													});
												}}
											/>
											<p className="text-sm text-muted">{copy.sourceHelp}</p>
											{fieldFeedback("source_locale")}
										</div>
										<div className="grid gap-4 sm:grid-cols-2">
											{(["country", "city"] as const).map((field) => (
												<div key={field} className="space-y-2">
													<label
														htmlFor={`store-${field}`}
														className="block text-sm font-medium"
													>
														{t[field]}
													</label>
													<input
														id={`store-${field}`}
														className={settingsControl}
														maxLength={80}
														value={body[field]}
														aria-invalid={fieldInvalid(field)}
														aria-describedby={
															fieldInvalid(field)
																? `store-${field}-error`
																: undefined
														}
														onChange={(event) =>
															changeBody({
																...body,
																[field]: event.target.value,
															})
														}
													/>
													{fieldFeedback(field)}
												</div>
											))}
										</div>
									</div>
									<p className="text-sm text-muted">{t.locationNote}</p>
								</fieldset>
								<div
									role="tablist"
									aria-label={t.edition}
									className="flex flex-wrap gap-2 rounded-xl bg-page p-2"
									onKeyDown={(event) => {
										if (
											!["ArrowLeft", "ArrowRight", "Home", "End"].includes(
												event.key,
											)
										)
											return;
										event.preventDefault();
										const current = locales.indexOf(language),
											step =
												(event.key === "ArrowRight" ? 1 : -1) *
												(direction(locale) === "rtl" ? -1 : 1),
											index =
												event.key === "Home"
													? 0
													: event.key === "End"
														? locales.length - 1
														: (current + step + locales.length) %
															locales.length;
										setLanguage(locales[index]);
										document
											.getElementById(`store-tab-${locales[index]}`)
											?.focus();
									}}
								>
									{locales.map((value) => (
										<button
											type="button"
											role="tab"
											id={`store-tab-${value}`}
											aria-controls="store-edition"
											aria-selected={language === value}
											tabIndex={language === value ? 0 : -1}
											key={value}
											onClick={() => setLanguage(value)}
											className="min-h-11 rounded-xl border-0 bg-transparent px-4 py-2 text-base font-medium text-muted aria-selected:bg-surface aria-selected:text-action aria-selected:shadow-sm"
										>
											<span lang={value}>{languageNames[value]}</span>
										</button>
									))}
								</div>
								<div
									role="tabpanel"
									id="store-edition"
									aria-labelledby={`store-tab-${language}`}
									className="space-y-4"
									lang={language}
									dir={direction(language)}
								>
									<fieldset
										disabled={!editable}
										className="m-0 min-w-0 space-y-4 border-0 p-0"
									>
										<label
											className="flex min-h-11 items-center gap-3 text-base"
											lang={locale}
											dir={direction(locale)}
										>
											<input
												type="checkbox"
												className="size-5 accent-action"
												checked={!!edition}
												disabled={body.source_locale === language}
												onChange={(event) => {
													const editions = { ...body.editions };
													if (event.target.checked)
														editions[language] = {
															description: "",
															logo_alt: "",
															banner_alt: "",
														};
													else delete editions[language];
													changeBody({ ...body, editions });
												}}
											/>
											{t.edition}
										</label>
										{!edition && (
											<p
												className="text-sm text-muted"
												lang={locale}
												dir={direction(locale)}
											>
												{copy.missingEdition}
											</p>
										)}
										{edition && (
											<div className="grid gap-5 md:grid-cols-2">
												{(
													["description", "logo_alt", "banner_alt"] as const
												).map((field) => (
													<div
														key={field}
														className={`space-y-2 ${field === "description" ? "md:col-span-2" : ""}`}
													>
														<label
															htmlFor={`store-${field}`}
															className="block text-sm font-medium"
															lang={locale}
															dir={direction(locale)}
														>
															{t[field]}
														</label>
														{field === "description" ? (
															<textarea
																id={`store-${field}`}
																className={`${settingsControl} min-h-40`}
																maxLength={2000}
																value={edition[field]}
																aria-invalid={fieldInvalid(field)}
																aria-describedby={
																	fieldInvalid(field)
																		? `store-${field}-error`
																		: undefined
																}
																onChange={(event) =>
																	changeBody({
																		...body,
																		editions: {
																			...body.editions,
																			[language]: {
																				...edition,
																				[field]: event.target.value,
																			},
																		},
																	})
																}
															/>
														) : (
															<input
																id={`store-${field}`}
																className={settingsControl}
																maxLength={200}
																value={edition[field]}
																aria-invalid={fieldInvalid(field)}
																aria-describedby={
																	fieldInvalid(field)
																		? `store-${field}-error`
																		: undefined
																}
																onChange={(event) =>
																	changeBody({
																		...body,
																		editions: {
																			...body.editions,
																			[language]: {
																				...edition,
																				[field]: event.target.value,
																			},
																		},
																	})
																}
															/>
														)}
														<div lang={locale} dir={direction(locale)}>
															{fieldFeedback(field)}
														</div>
													</div>
												))}
											</div>
										)}
									</fieldset>
								</div>
							</SettingsSection>
							<SettingsSection
								title={copy.images}
								description={copy.imageHelp}
								icon="image"
							>
								<fieldset
									disabled={!editable}
									className="m-0 grid min-w-0 gap-5 border-0 p-0 md:grid-cols-2"
								>
									{(["logo", "banner"] as const).map((role) => {
										const image = current.media.find(
											(image) => image.id === body[role],
										);
										const invalid = fieldInvalid(role) || fieldInvalid("file");
										return (
											<div
												key={role}
												className="min-w-0 space-y-3 rounded-xl border border-border p-4"
											>
												<h3 className="font-semibold">{t[role]}</h3>
												<div className="flex min-h-36 items-center justify-center rounded-xl bg-page p-3">
													{image ? (
														<Asset
															asset={{
																...image,
																alt: edition?.[`${role}_alt`] || "",
															}}
															className="max-h-48 w-full object-contain"
														/>
													) : (
														<p className="text-sm text-muted">{copy.noImage}</p>
													)}
												</div>
												<label
													htmlFor={`store-upload-${role}`}
													className="block text-sm font-medium"
												>
													{t.upload} · {t[role]}
												</label>
												<input
													id={`store-upload-${role}`}
													type="file"
													accept="image/jpeg,image/png,image/webp"
													aria-invalid={invalid}
													aria-describedby={
														invalid ? `store-upload-${role}-error` : undefined
													}
													onChange={(event) => {
														void upload(role, event.target.files?.[0]);
														event.target.value = "";
													}}
													className="min-h-12 w-full min-w-0 rounded-xl border border-control bg-surface p-2 text-base file:me-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-info file:px-3 file:text-base file:font-medium file:text-action disabled:opacity-50"
												/>
												{invalid && (
													<p
														id={`store-upload-${role}-error`}
														className="text-sm text-danger"
													>
														{copy.fieldError}
													</p>
												)}
												{body[role] && (
													<Button
														variant="secondary"
														onClick={() =>
															changeBody({ ...body, [role]: null })
														}
													>
														{t.remove}
													</Button>
												)}
											</div>
										);
									})}
								</fieldset>
							</SettingsSection>
							<div className="grid items-start gap-6 md:grid-cols-2">
								<SettingsSection
									title={copy.draftPreview}
									description={copy.draftPreviewHelp}
									icon="eye"
								>
									<Preview body={body} locale={locale} media={current.media} />
								</SettingsSection>
								<SettingsSection
									title={t.approved}
									description={copy.approvedPreviewHelp}
									icon="check-circle"
								>
									{approved ? (
										<Preview
											body={approved.body as StoreBody}
											locale={locale}
											media={current.media}
										/>
									) : (
										<p className="text-sm text-muted">{t.noAbout}</p>
									)}
								</SettingsSection>
							</div>
							<SettingsSection
								title={copy.reviewActions}
								description={copy.reviewHelp}
								icon="shield"
							>
								<p className="text-sm text-muted">
									{t.version}: <bdi>{current.version}</bdi>
									{latest && (
										<>
											{" "}
											· {t.status}: {t[latest.state as "draft"] || latest.state}
										</>
									)}
								</p>
								<SettingsActions dirty={dirty} locale={locale}>
									<Button type="submit" disabled={!editable || !dirty}>
										{t.save}
									</Button>
									<Button
										disabled={!canSubmit}
										onClick={() => void mutate("submit")}
									>
										{t.submit}
									</Button>
									{pending && (
										<Button
											variant="secondary"
											disabled={!current.can_edit || busy || loading}
											onClick={() => void mutate("withdraw")}
										>
											{t.withdraw}
										</Button>
									)}
									<Button
										variant="secondary"
										disabled={busy || loading || profilesLoading}
										onClick={reloadCurrent}
									>
										{common.reload}
									</Button>
								</SettingsActions>
							</SettingsSection>
						</form>
						<SettingsSection title={t.history} icon="history">
							{current.revisions.length ? (
								<ol className="space-y-3">
									{current.revisions.map((revision) => (
										<li
											key={revision.id}
											className="space-y-2 rounded-xl border border-border p-4"
										>
											<p className="text-sm font-semibold">
												{t.version} <bdi>{revision.number}</bdi> ·{" "}
												{t[revision.state as "draft"] || revision.state}
											</p>
											{revision.reason && (
												<p className="whitespace-pre-wrap wrap-anywhere text-sm text-muted">
													{t.reason}: {revision.reason}
												</p>
											)}
										</li>
									))}
								</ol>
							) : (
								<p className="text-sm text-muted">{copy.noRevision}</p>
							)}
						</SettingsSection>
					</>
				)}
			</div>
		</SettingsPage>
	);
}
function Preview({
	body,
	locale,
	media,
}: {
	body: StoreBody;
	locale: Locale;
	media: PrivateStore["media"];
}) {
	const language = body.editions[locale] ? locale : body.source_locale;
	const edition = body.editions[language];
	return (
		<div className="min-w-0 space-y-4">
			{!body.editions[locale] && (
				<p className="text-sm text-muted">
					{sellerBusinessSettingsCopy[locale].sourceFallback}
				</p>
			)}
			{(["logo", "banner"] as const).map((role) => {
				const image = media.find((image) => image.id === body[role]);
				return image ? (
					<Asset
						key={role}
						asset={{ ...image, alt: edition?.[`${role}_alt`] || "" }}
						className="max-h-48 w-full object-contain"
					/>
				) : null;
			})}
			<p
				className="whitespace-pre-wrap wrap-anywhere text-base"
				lang={language}
				dir={direction(language)}
			>
				{edition?.description}
			</p>
			<p className="text-sm text-muted">
				<bdi>{body.city}</bdi> <bdi>{body.country}</bdi>
			</p>
		</div>
	);
}
