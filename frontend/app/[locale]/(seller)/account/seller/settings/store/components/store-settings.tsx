"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/shadcn/button";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Input } from "@/components/shadcn/input";
import { Label } from "@/components/shadcn/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/shadcn/native-select";
import { Textarea } from "@/components/shadcn/textarea";
import {
	SettingsPage,
	BusinessDialog,
	useSettingsGuard,
} from "@/components/accounts/seller-settings-ui";
import { DashboardCard, cardClass } from "@/components/ui/dashboard-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, statusVariant } from "@/components/ui/status-badge";
import {
	locales,
	languageNames,
	direction,
	type Locale,
} from "@/lib/i18n/locales";
import { sellerSettingsCopy } from "@/lib/i18n/seller-settings";
import { sellerBusinessSettingsCopy } from "@/lib/i18n/seller-business-settings";
import { authCopy } from "@/lib/i18n/auth";
import { privateRequest, AccountError } from "@/lib/api/private-client";
import { sellerHref } from "@/lib/routes/account-routes";
import { marketplaceCopy } from "@/features/marketplace/copy";
import type {
	PrivateStore,
	StoreBody,
	StoreProfiles,
} from "@/features/marketplace/types";
import { Asset } from "@/features/marketplace/components/cards";
import {
	accessLost,
	useCommunicationSession,
} from "@/features/messaging/hooks";
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
				<Button
					asChild
					variant="outline"
					size="sm"
					className="min-h-11 shadow-none sm:min-h-8"
				>
					<Link href={`/${locale}/auth/seller-sign-in`}>
						{authCopy[locale].backSignin}
					</Link>
				</Button>
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
		[imagesOpen, setImagesOpen] = useState(false),
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
			<p id={`store-${field}-error`} className="m-0 text-sm text-danger">
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
			setImagesOpen(false);
		}
		setFields(safeStoreFields(cause));
		const message =
			cause instanceof AccountError
				? cause.status === 409
					? t.stale
					: cause.status === 403 || cause.status === 404
						? t.denied
						: fallback
				: fallback;
		setError(message);
		toast.error(message);
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
			const message =
				action === "save"
					? copy.draftSaved
					: action === "submit"
						? copy.reviewSubmitted
						: copy.reviewWithdrawn;
			setNotice(message);
			toast.success(message);
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
			toast.success(copy.imageAttached);
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
		approved = current?.revisions.find((row) => row.id === current.published),
		logoImage = current?.media.find((image) => image.id === body?.logo);
	const stateLabel = (state: string) => t[state as "draft"] || state;
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
	const mutationFeedback = (
		<>
			{error && (
				<div
					role="alert"
					className="space-y-1 rounded-xl border border-solid border-danger/30 bg-surface p-3 text-sm text-danger"
				>
					<p className="m-0">{error}</p>
					{fields.length > 0 && (
						<p className="m-0">
							{copy.checkFields}{" "}
							{fields.map((field) => labels[field]).join(" · ")}
						</p>
					)}
				</div>
			)}
			{notice && (
				<p role="status" className="m-0 text-sm text-success">
					{notice}
				</p>
			)}
		</>
	);
	return (
		<SettingsPage
			locale={locale}
			page="settings/store"
			actions={
				<div className="min-w-0 space-y-1.5">
					<Label
						htmlFor="store-business"
						className="text-sm font-medium text-muted"
					>
						{common.businessScope}
					</Label>
					<NativeSelect
						id="store-business"
						aria-label={t.selectStore}
						value={id}
						disabled={busy || loading || profilesLoading}
						className="rounded-lg bg-surface shadow-none"
						onChange={(event) => {
							if (requestOwner.current || loading || profilesLoading) return;
							const value = event.target.value;
							choose(() => {
								if (!requestOwner.current)
									router.push(sellerHref(locale, "settings/store", value));
							});
						}}
					>
						<NativeSelectOption value="">{t.selectStore}</NativeSelectOption>
						{profiles?.results.map((profile) => (
							<NativeSelectOption key={profile.id} value={profile.id}>
								{profile.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
			}
		>
			<div
				className="space-y-4"
				data-testid="store-settings"
				aria-busy={busy || loading || profilesLoading}
			>
				{feedback}
				{(loading || profilesLoading || busy) && (
					<p role="status" className="m-0 text-sm text-muted">
						{common.loading}
					</p>
				)}
				{profilesError && (
					<p
						role="alert"
						className="m-0 rounded-xl border border-solid border-danger/30 bg-surface p-4 text-sm text-danger"
					>
						{copy.profilesFailed}
					</p>
				)}
				{profiles && !profiles.results.length && (
					<EmptyState icon="store" title={t.noEligible} />
				)}
				{!id && !loading && !profilesLoading && !!profiles?.results.length && (
					<EmptyState icon="store" title={copy.selectedRequired} />
				)}
				{!imagesOpen && mutationFeedback}
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
						<div className="min-w-0 overflow-hidden rounded-card border border-transparent bg-surface shadow-card dark:border-border">
							<div className="h-1 bg-primary" aria-hidden="true" />
							<div className="flex min-w-0 items-start gap-4 p-4 desktop:p-6">
								{logoImage ? (
									<span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-solid border-border bg-page">
										<Asset
											asset={{
												...logoImage,
												alt: edition?.logo_alt || "",
											}}
											className="size-14 object-contain"
											loading="eager"
										/>
									</span>
								) : (
									<span
										className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"
										aria-hidden="true"
									>
										<Icon name="store" className="size-6" />
									</span>
								)}
								<div className="min-w-0 flex-1 space-y-1.5">
									<h2 className="m-0 wrap-anywhere text-lg font-bold sm:text-xl">
										<bdi>{current.name}</bdi>
									</h2>
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
										<StatusBadge
											variant={statusVariant(latest?.state ?? "")}
											className="shrink-0"
										>
											<span className="sr-only">{t.status}: </span>
											{latest ? stateLabel(latest.state) : copy.noRevision}
										</StatusBadge>
										<span className="text-xs text-muted">
											{t.version}:{" "}
											<bdi>{current.version.toLocaleString(locale)}</bdi>
										</span>
									</div>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-1.5 border-t border-solid border-border px-4 py-3 desktop:px-6">
								<BusinessDialog
									locale={locale}
									title={copy.draftPreview}
									description={copy.draftPreviewHelp}
									trigger={
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="min-h-11 sm:min-h-8"
										>
											<Icon name="eye" className="size-4" />
											{copy.draftPreview}
										</Button>
									}
								>
									<Preview body={body} locale={locale} media={current.media} />
								</BusinessDialog>
								<BusinessDialog
									locale={locale}
									title={t.approved}
									description={copy.approvedPreviewHelp}
									trigger={
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="min-h-11 sm:min-h-8"
										>
											<Icon name="check-circle" className="size-4" />
											{t.approved}
										</Button>
									}
								>
									{approved ? (
										<Preview
											body={approved.body as StoreBody}
											locale={locale}
											media={current.media}
										/>
									) : (
										<p className="m-0 text-sm text-muted">{t.noAbout}</p>
									)}
								</BusinessDialog>
								<BusinessDialog
									locale={locale}
									title={t.history}
									trigger={
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="min-h-11 sm:min-h-8"
										>
											<Icon name="history" className="size-4" />
											{t.history}
										</Button>
									}
								>
									{current.revisions.length ? (
										<ol className="m-0 list-none divide-y divide-border p-0">
											{current.revisions.map((revision) => (
												<li
													key={revision.id}
													className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0"
												>
													<span
														className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info text-action"
														aria-hidden="true"
													>
														<Icon name="history" className="size-4" />
													</span>
													<span className="min-w-0 flex-1">
														<span className="block text-sm font-medium">
															{t.version}{" "}
															<bdi>
																{revision.number.toLocaleString(locale)}
															</bdi>
														</span>
														{revision.reason && (
															<span className="mt-0.5 block whitespace-pre-wrap wrap-anywhere text-sm text-muted">
																{t.reason}: {revision.reason}
															</span>
														)}
													</span>
													<StatusBadge
														size="sm"
														variant={statusVariant(revision.state)}
														className="shrink-0"
													>
														{stateLabel(revision.state)}
													</StatusBadge>
												</li>
											))}
										</ol>
									) : (
										<p className="m-0 text-sm text-muted">{copy.noRevision}</p>
									)}
								</BusinessDialog>
								<Button
									asChild
									variant="ghost"
									size="sm"
									className="min-h-11 sm:min-h-8"
								>
									<Link href={`/${locale}/stores/${id}`}>
										<ExternalLink aria-hidden="true" className="size-4" />
										{t.openStore}
									</Link>
								</Button>
							</div>
						</div>
						<div className="grid auto-rows-fr grid-cols-2 gap-2 sm:gap-4">
							<StatCard
								compact
								icon="shield"
								chip={statusVariant(latest?.state ?? "")}
								label={t.status}
								value={latest ? stateLabel(latest.state) : "—"}
								locale={locale}
							/>
							<StatCard
								compact
								icon="award"
								chip={approved ? "success" : "neutral"}
								label={t.approved}
								value={approved ? approved.number : "—"}
								locale={locale}
							/>
						</div>
						{latest?.reason && (
							<p className="m-0 rounded-xl bg-info p-3 text-sm leading-relaxed">
								<span className="font-medium">{t.reason}: </span>
								<span className="whitespace-pre-wrap wrap-anywhere">
									{latest.reason}
								</span>
							</p>
						)}
						<p className="m-0 text-sm leading-relaxed text-muted">
							{!current.can_edit && <span className="block">{t.readOnly}</span>}
							{pending && (
								<span className="block text-action">{copy.pendingHelp}</span>
							)}
							<span className="block">
								{approved ? copy.approvedPreviewHelp : t.noAbout}
							</span>
						</p>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								if (dirty) void mutate("save");
								else if (canSubmit) void mutate("submit");
							}}
						>
							<DashboardCard
								title={copy.publicInformation}
								description={copy.manualLanguages}
								icon="globe"
							>
								<p className="m-0 text-xs leading-relaxed text-muted">
									{t.privacy}
								</p>
								<fieldset
									disabled={!editable}
									className="m-0 min-w-0 space-y-3 border-0 p-0"
								>
									<div className="grid items-start gap-3 md:grid-cols-3">
										<div className="min-w-0 space-y-1.5">
											<Label htmlFor="store-source">{t.source}</Label>
											<NativeSelect
												id="store-source"
												value={body.source_locale}
												className="rounded-lg shadow-none"
												aria-invalid={fieldInvalid("source_locale")}
												aria-describedby={`store-source-help${fieldInvalid("source_locale") ? " store-source_locale-error" : ""}`}
												onChange={(event) => {
													const source = event.target.value as Locale;
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
											>
												{locales.map((value) => (
													<NativeSelectOption
														key={value}
														value={value}
														lang={value}
													>
														{languageNames[value]}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<p
												id="store-source-help"
												className="m-0 text-xs leading-relaxed text-muted"
											>
												{copy.sourceHelp}
											</p>
											{fieldFeedback("source_locale")}
										</div>
										<div className="grid min-w-0 gap-3 sm:grid-cols-2 md:col-span-2">
											{(["country", "city"] as const).map((field) => (
												<div key={field} className="min-w-0 space-y-1.5">
													<Label htmlFor={`store-${field}`}>{t[field]}</Label>
													<Input
														id={`store-${field}`}
														className="rounded-lg shadow-none"
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
									<p className="m-0 text-xs leading-relaxed text-muted">
										{t.locationNote}
									</p>
								</fieldset>
								<div
									role="tablist"
									aria-label={t.edition}
									className="flex min-w-0 flex-wrap gap-1 border-0 border-b border-solid border-border"
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
											className={`min-h-11 cursor-pointer border-b-2 border-solid px-4 py-2 text-body font-semibold transition-colors motion-reduce:transition-none ${
												language === value
													? "border-action text-action"
													: "border-transparent text-muted hover:text-foreground"
											}`}
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
										<div
											className="flex min-h-9 items-center gap-2"
											lang={locale}
											dir={direction(locale)}
										>
											<Checkbox
												id="store-include-language"
												checked={!!edition}
												disabled={!editable || body.source_locale === language}
												aria-invalid={fieldInvalid("editions")}
												aria-describedby={
													fieldInvalid("editions")
														? "store-editions-error"
														: undefined
												}
												onCheckedChange={(checked) => {
													const editions = { ...body.editions };
													if (checked === true)
														editions[language] = {
															description: "",
															logo_alt: "",
															banner_alt: "",
														};
													else delete editions[language];
													changeBody({ ...body, editions });
												}}
											/>
											<Label
												htmlFor="store-include-language"
												className="cursor-pointer"
											>
												{t.edition}
											</Label>
										</div>
										<div lang={locale} dir={direction(locale)}>
											{fieldFeedback("editions")}
										</div>
										{!edition && (
											<p
												className="m-0 text-sm text-muted"
												lang={locale}
												dir={direction(locale)}
											>
												{copy.missingEdition}
											</p>
										)}
										{edition && (
											<div className="grid gap-3 md:grid-cols-2">
												{(
													["description", "logo_alt", "banner_alt"] as const
												).map((field) => (
													<div
														key={field}
														className={`min-w-0 space-y-1.5 ${field === "description" ? "md:col-span-2" : ""}`}
													>
														<Label
															htmlFor={`store-${field}`}
															lang={locale}
															dir={direction(locale)}
														>
															{t[field]}
														</Label>
														{field === "description" ? (
															<Textarea
																id={`store-${field}`}
																className="min-h-28 resize-y rounded-lg shadow-none"
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
															<Input
																id={`store-${field}`}
																className="rounded-lg shadow-none"
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
							</DashboardCard>
							<DashboardCard
								title={copy.images}
								icon="image"
								action={
									<BusinessDialog
										locale={locale}
										title={copy.images}
										description={copy.imageHelp}
										open={imagesOpen}
										onOpenChange={setImagesOpen}
										busy={busy}
										trigger={
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="min-h-11 shadow-none sm:min-h-8"
												disabled={busy || loading}
											>
												<Icon name="image" className="size-4" />
												{current.can_edit && !pending
													? common.edit
													: t.viewDetails}
											</Button>
										}
									>
										<div className="min-w-0 space-y-4" aria-busy={busy}>
											{mutationFeedback}
											{busy && (
												<p role="status" className="m-0 text-sm text-muted">
													{common.loading}
												</p>
											)}
											{pending && (
												<p className="m-0 text-sm text-action">
													{copy.pendingHelp}
												</p>
											)}
											{!current.can_edit && (
												<p className="m-0 text-sm text-muted">{t.readOnly}</p>
											)}
											<fieldset
												disabled={!editable}
												className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2"
											>
												{(["logo", "banner"] as const).map((role) => {
													const image = current.media.find(
														(image) => image.id === body[role],
													);
													const invalid =
														fieldInvalid(role) || fieldInvalid("file");
													return (
														<div
															key={role}
															className="min-w-0 space-y-2 rounded-xl border border-solid border-border p-3"
														>
															<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
																<h3 className="m-0 text-sm font-semibold">
																	{t[role]}
																</h3>
																{body[role] && (
																	<Button
																		type="button"
																		variant="ghost"
																		size="sm"
																		className="min-h-11 text-danger hover:text-danger sm:min-h-8"
																		disabled={!editable}
																		onClick={() =>
																			changeBody({ ...body, [role]: null })
																		}
																	>
																		<Icon name="trash" className="size-4" />
																		{t.remove}
																	</Button>
																)}
															</div>
															<div className="flex min-h-28 items-center justify-center overflow-hidden rounded-lg bg-page p-2">
																{image ? (
																	<Asset
																		asset={{
																			...image,
																			alt: edition?.[`${role}_alt`] || "",
																		}}
																		className="max-h-32 w-full object-contain"
																	/>
																) : (
																	<p className="m-0 text-sm text-muted">
																		{copy.noImage}
																	</p>
																)}
															</div>
															<Label htmlFor={`store-upload-${role}`}>
																{t.upload} · {t[role]}
															</Label>
															<Input
																id={`store-upload-${role}`}
																type="file"
																accept="image/jpeg,image/png,image/webp"
																disabled={!editable}
																aria-invalid={invalid}
																aria-describedby={
																	invalid
																		? `store-upload-${role}-error`
																		: undefined
																}
																onChange={(event) => {
																	void upload(role, event.target.files?.[0]);
																	event.target.value = "";
																}}
																className="h-auto min-h-11 rounded-lg px-2 py-1.5 shadow-none file:me-2 file:cursor-pointer file:rounded-md file:bg-info file:px-2 file:text-action"
															/>
															{invalid && (
																<p
																	id={`store-upload-${role}-error`}
																	className="m-0 text-sm text-danger"
																>
																	{copy.fieldError}
																</p>
															)}
														</div>
													);
												})}
											</fieldset>
											<p className="m-0 text-xs leading-relaxed text-muted">
												{dirty && (
													<span className="font-medium text-warning">
														{common.unsaved} ·{" "}
													</span>
												)}
												{copy.reviewHelp}
											</p>
										</div>
									</BusinessDialog>
								}
							>
								<ul className="m-0 list-none divide-y divide-border p-0">
									{(["logo", "banner"] as const).map((role) => {
										const image = current.media.find(
											(image) => image.id === body[role],
										);
										const alt = edition?.[`${role}_alt`];
										return (
											<li
												key={role}
												className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
											>
												<span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-page">
													{image ? (
														<Asset
															asset={{ ...image, alt: alt || "" }}
															className="h-12 w-16 object-contain"
														/>
													) : (
														<Icon
															name="image"
															className="size-4 text-muted"
															aria-hidden="true"
														/>
													)}
												</span>
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-medium">
														{t[role]}
													</span>
													{image ? (
														alt && (
															<span className="mt-0.5 block wrap-anywhere text-xs text-muted">
																{alt}
															</span>
														)
													) : (
														<span className="mt-0.5 block text-xs text-muted">
															{copy.noImage}
														</span>
													)}
													{(fieldInvalid(role) || fieldInvalid("file")) && (
														<span className="mt-0.5 block text-xs text-danger">
															{copy.fieldError}
														</span>
													)}
												</span>
											</li>
										);
									})}
								</ul>
							</DashboardCard>
							<div
								className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
							>
								<div className="min-w-0 space-y-1">
									<h2 className="m-0 text-base font-semibold">
										{copy.reviewActions}
									</h2>
									<p
										id="store-review-help"
										className="m-0 text-sm leading-relaxed text-muted"
									>
										{copy.reviewHelp}
									</p>
									{dirty && (
										<p className="m-0 text-sm font-medium text-warning">
											{common.unsaved}
										</p>
									)}
								</div>
								<div className="flex flex-wrap gap-2 [&>button]:min-h-11 sm:[&>button]:min-h-9">
									{dirty ? (
										<Button
											type="submit"
											disabled={!editable}
											aria-describedby="store-review-help"
										>
											<Icon name="check" className="size-4" />
											{t.save}
										</Button>
									) : current.can_edit && latest?.state === "draft" ? (
										<Button
											type="submit"
											disabled={!canSubmit}
											aria-describedby="store-review-help"
										>
											<Icon name="send" className="size-4" />
											{t.submit}
										</Button>
									) : null}
									{pending && (
										<Button
											type="button"
											variant="outline"
											className="shadow-none"
											disabled={!current.can_edit || busy || loading}
											onClick={() => void mutate("withdraw")}
										>
											{t.withdraw}
										</Button>
									)}
									<Button
										type="button"
										variant="outline"
										className="shadow-none"
										disabled={busy || loading || profilesLoading}
										onClick={reloadCurrent}
									>
										<Icon name="history" className="size-4" />
										{common.reload}
									</Button>
								</div>
							</div>
						</form>
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
				<p className="m-0 rounded-lg bg-info p-2 text-xs leading-relaxed text-muted">
					{sellerBusinessSettingsCopy[locale].sourceFallback}
				</p>
			)}
			{(["logo", "banner"] as const).map((role) => {
				const image = media.find((image) => image.id === body[role]);
				return image ? (
					<div
						key={role}
						className="flex items-center justify-center overflow-hidden rounded-xl border border-solid border-border bg-page p-3"
					>
						<Asset
							asset={{ ...image, alt: edition?.[`${role}_alt`] || "" }}
							className={
								role === "logo"
									? "max-h-32 object-contain"
									: "max-h-48 w-full object-contain"
							}
							loading="eager"
						/>
					</div>
				) : null;
			})}
			<p
				className="m-0 whitespace-pre-wrap wrap-anywhere text-base leading-relaxed"
				lang={language}
				dir={direction(language)}
			>
				{edition?.description}
			</p>
			<p className="m-0 flex items-center gap-1.5 text-sm text-muted">
				<Icon name="map-pin" className="size-4 shrink-0" aria-hidden="true" />
				<bdi>{body.city}</bdi> <bdi>{body.country}</bdi>
			</p>
		</div>
	);
}
