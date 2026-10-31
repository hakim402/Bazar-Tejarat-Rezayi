"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
	useNavigation,
	useUnsavedNavigation,
} from "../../../../../../../../components/layout/navigation-guard";
import { Button } from "../../../../../../../../components/ui/button";
const blank = (locale: Locale): StoreBody => ({
	source_locale: locale,
	editions: { [locale]: { description: "", logo_alt: "", banner_alt: "" } },
	country: "",
	city: "",
	logo: null,
	banner: null,
});
const control =
	"min-h-11 w-full min-w-0 rounded-control border border-border bg-page px-3 text-foreground disabled:opacity-60";
export function StoreSettings({ locale }: { locale: Locale }) {
	const id = useSearchParams().get("seller") || "";
	// Each visited business/locale owns a new lifecycle, including A → B → A.
	return <StoreEditor key={`${locale}:${id}`} locale={locale} id={id} />;
}
function StoreEditor({ locale, id }: { locale: Locale; id: string }) {
	const t = marketplaceCopy[locale],
		router = useRouter(),
		navigate = useNavigation();
	const [profiles, setProfiles] = useState<StoreProfiles | null>(null),
		[item, setItem] = useState<PrivateStore | null>(null),
		[body, setBody] = useState<StoreBody | null>(null),
		[baseline, setBaseline] = useState(""),
		[language, setLanguage] = useState<Locale>(locale),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false),
		[loading, setLoading] = useState(true),
		[reload, setReload] = useState(0);
	const requestOwner = useRef<object | null>(null);
	const dirty = !!body && JSON.stringify(body) !== baseline;
	const guard = useCallback(
		(action: () => void) => {
			if (window.confirm(t.discard)) action();
		},
		[t.discard],
	);
	useUnsavedNavigation(dirty, guard);
	useEffect(() => {
		let active = true;
		setProfiles(null);
		privateRequest<StoreProfiles>("marketplace/seller/stores/")
			.then((value) => {
				if (active) setProfiles(value);
			})
			.catch(() => {
				if (active) {
					setError(t.failed);
					setLoading(false);
				}
			});
		return () => {
			active = false;
		};
	}, [t.failed]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload is an intentional explicit refresh token; never refresh on stale writes.
	useEffect(() => {
		let active = true;
		requestOwner.current = null;
		setBusy(false);
		setItem(null);
		setBody(null);
		setError("");
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
	function failure(cause: unknown) {
		setError(
			cause instanceof AccountError
				? cause.status === 409
					? t.stale
					: cause.status === 403 || cause.status === 404
						? t.denied
						: `${t.failed}${cause.fields.length ? ` (${cause.fields.join(", ")})` : ""}`
				: t.failed,
		);
	}
	async function mutate(action: "save" | "submit" | "withdraw") {
		if (!item || !body || requestOwner.current || !item.can_edit) return;
		const current = {};
		requestOwner.current = current;
		setBusy(true);
		setError("");
		setNotice("");
		try {
			const value = await privateRequest<PrivateStore>(
				`marketplace/seller/stores/${id}/${action === "save" ? "" : "actions/"}`,
				action === "save"
					? { version: item.version, body }
					: { version: item.version, revision: item.revisions[0]?.id, action },
			);
			if (requestOwner.current !== current) return;
			setItem(value);
			if (action === "save") setBaseline(JSON.stringify(body));
			setNotice(t.saved);
		} catch (cause) {
			if (requestOwner.current === current) failure(cause);
		} finally {
			if (requestOwner.current === current) {
				requestOwner.current = null;
				setBusy(false);
			}
		}
	}
	async function upload(role: "logo" | "banner", file: File | undefined) {
		if (!file || !item || !body || requestOwner.current || !item.can_edit)
			return;
		const current = {};
		requestOwner.current = current;
		setBusy(true);
		setError("");
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
		} catch (cause) {
			if (requestOwner.current === current) failure(cause);
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
		editable = !!current?.can_edit && !pending && !busy;
	const edition = body?.editions[language],
		approved = current?.revisions.find((row) => row.id === current.published);
	return (
		<section className="space-y-6" data-testid="store-settings">
			<span className="sr-only" role="status">
				{busy ? t.loading : ""}
			</span>
			<h1 className="text-3xl">{t.storeSettings}</h1>
			<Link
				className="inline-flex min-h-11 items-center"
				href={`/${locale}/account/seller/settings`}
			>
				{t.previous}
			</Link>
			<label className="block max-w-xl space-y-2">
				<span>{t.selectStore}</span>
				<select
					className={control}
					value={id}
					disabled={busy}
					onChange={(event) => {
						const value = event.target.value;
						navigate(() =>
							router.push(
								`/${locale}/account/seller/settings/store${value ? `?seller=${value}` : ""}`,
							),
						);
					}}
				>
					<option value="">{t.selectStore}</option>
					{profiles?.results.map((profile) => (
						<option key={profile.id} value={profile.id}>
							{profile.name}
						</option>
					))}
				</select>
			</label>
			{loading && <p role="status">{t.loading}</p>}
			{profiles && !profiles.results.length && <p>{t.noEligible}</p>}
			{error && (
				<p
					role="alert"
					className="rounded-control border border-danger p-3 text-danger"
				>
					{error}
				</p>
			)}
			{notice && (
				<p role="status" className="text-success">
					{notice}
				</p>
			)}
			{id && (
				<Button
					variant="secondary"
					disabled={busy}
					onClick={() => {
						if (!dirty || window.confirm(t.discard))
							setReload((value) => value + 1);
					}}
				>
					{t.reload}
				</Button>
			)}
			{current && body && (
				<>
					<p className="rounded-card border border-border bg-info p-4">
						{t.private}
					</p>
					<p className="text-sm text-muted">{t.privacy}</p>
					<div className="flex flex-wrap gap-5">
						<p>{current.name}</p>
						<p>
							{t.version}: <bdi>{current.version}</bdi>
						</p>
						<Link
							className="inline-flex min-h-11 items-center"
							href={`/${locale}/stores/${id}`}
						>
							{t.openStore}
						</Link>
					</div>
					{!current.can_edit && <p>{t.readOnly}</p>}
					{latest && (
						<p>
							{t.status}: {t[latest.state as "draft"] || latest.state}
						</p>
					)}
					{latest?.reason && (
						<p>
							{t.reason}: {latest.reason}
						</p>
					)}
					{approved && (
						<details className="rounded-card border border-border bg-surface p-4">
							<summary className="min-h-11 cursor-pointer font-bold">
								{t.approved}
							</summary>
							<Preview
								body={approved.body as StoreBody}
								locale={locale}
								media={current.media}
							/>
						</details>
					)}
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void mutate("save");
						}}
						className="space-y-5 rounded-card border border-border bg-surface p-5"
					>
						<label className="block space-y-2">
							<span>{t.source}</span>
							<select
								className={control}
								disabled={!editable}
								value={body.source_locale}
								onChange={(event) => {
									const language = event.target.value as Locale;
									setBody({
										...body,
										source_locale: language,
										editions: {
											...body.editions,
											[language]: body.editions[language] || {
												description: "",
												logo_alt: "",
												banner_alt: "",
											},
										},
									});
								}}
							>
								{locales.map((language) => (
									<option key={language} value={language}>
										{languageNames[language]}
									</option>
								))}
							</select>
						</label>
						<div
							role="tablist"
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
												: (current + step + locales.length) % locales.length;
								setLanguage(locales[index]);
								document.getElementById(`store-tab-${locales[index]}`)?.focus();
							}}
							aria-label={t.source}
							className="flex flex-wrap gap-3"
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
									className="min-h-11 rounded-control border border-border px-4 aria-selected:bg-info aria-selected:text-action"
								>
									{languageNames[value]}
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
							<label className="flex min-h-11 items-center gap-3">
								<input
									type="checkbox"
									checked={!!edition}
									disabled={!editable || body.source_locale === language}
									onChange={(event) => {
										const editions = { ...body.editions };
										if (event.target.checked)
											editions[language] = {
												description: "",
												logo_alt: "",
												banner_alt: "",
											};
										else delete editions[language];
										setBody({ ...body, editions });
									}}
								/>
								{t.edition}
							</label>
							{edition &&
								(["description", "logo_alt", "banner_alt"] as const).map(
									(field) => (
										<label
											htmlFor={`store-${field}`}
											className="block space-y-2"
											key={field}
										>
											<span lang={locale} dir={direction(locale)}>
												{t[field]}
											</span>
											{field === "description" ? (
												<textarea
													id={`store-${field}`}
													className={`${control} min-h-40 py-3`}
													disabled={!editable}
													maxLength={2000}
													value={edition[field]}
													onChange={(event) =>
														setBody({
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
													className={control}
													disabled={!editable}
													maxLength={200}
													value={edition[field]}
													onChange={(event) =>
														setBody({
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
										</label>
									),
								)}
						</div>
						<div className="grid gap-4 desktop:grid-cols-2">
							{(["country", "city"] as const).map((field) => (
								<label key={field} className="space-y-2">
									<span>{t[field]}</span>
									<input
										className={control}
										maxLength={80}
										disabled={!editable}
										value={body[field]}
										onChange={(event) =>
											setBody({ ...body, [field]: event.target.value })
										}
									/>
								</label>
							))}
						</div>
						<div className="grid gap-5 desktop:grid-cols-2">
							{(["logo", "banner"] as const).map((role) => {
								const image = current.media.find(
									(image) => image.id === body[role],
								);
								return (
									<fieldset
										key={role}
										className="min-w-0 space-y-3 rounded-card border border-border p-4"
									>
										<legend>{t[role]}</legend>
										{image && (
											<Asset
												asset={image}
												className="max-h-48 w-full object-contain"
											/>
										)}
										<label className="block space-y-2">
											<span>{t.upload}</span>
											<input
												type="file"
												accept="image/jpeg,image/png,image/webp"
												disabled={!editable}
												onChange={(event) => {
													void upload(role, event.target.files?.[0]);
													event.target.value = "";
												}}
												className="min-h-11 w-full min-w-0 text-sm"
											/>
										</label>
										{body[role] && (
											<Button
												type="button"
												variant="secondary"
												disabled={!editable}
												onClick={() => setBody({ ...body, [role]: null })}
											>
												{t.remove}
											</Button>
										)}
									</fieldset>
								);
							})}
						</div>
						<div className="flex flex-wrap gap-3">
							<Button type="submit" disabled={!editable || !dirty}>
								{t.save}
							</Button>
							<Button
								type="button"
								disabled={
									!current.can_edit ||
									busy ||
									dirty ||
									latest?.state !== "draft"
								}
								onClick={() => void mutate("submit")}
							>
								{t.submit}
							</Button>
							{pending && (
								<Button
									type="button"
									variant="secondary"
									disabled={!current.can_edit || busy}
									onClick={() => void mutate("withdraw")}
								>
									{t.withdraw}
								</Button>
							)}
						</div>
					</form>
					<details
						className="rounded-card border border-border bg-surface p-4"
						open
					>
						<summary className="min-h-11 cursor-pointer font-bold">
							{t.private}
						</summary>
						<Preview body={body} locale={locale} media={current.media} />
					</details>
					<details>
						<summary className="min-h-11 cursor-pointer font-bold">
							{t.history}
						</summary>
						<ol className="space-y-3">
							{current.revisions.map((revision) => (
								<li key={revision.id}>
									{t.version} <bdi>{revision.number}</bdi> ·{" "}
									{t[revision.state as "draft"] || revision.state}
									{revision.reason && <p>{revision.reason}</p>}
								</li>
							))}
						</ol>
					</details>
				</>
			)}
		</section>
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
	const edition = body.editions[locale] || body.editions[body.source_locale];
	return (
		<div className="space-y-4 py-3">
			{!body.editions[locale] && (
				<p className="text-sm text-muted">{marketplaceCopy[locale].fallback}</p>
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
				className="whitespace-pre-wrap break-words"
				lang={body.editions[locale] ? locale : body.source_locale}
				dir={direction(body.editions[locale] ? locale : body.source_locale)}
			>
				{edition?.description}
			</p>
			<p>
				{body.city} {body.country}
			</p>
		</div>
	);
}
