"use client";
import { SessionEntry } from "./session-entry";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { useCommunicationSession } from "../../messaging/hooks";
import { commerce, type Terms, type Profile } from "../api";
import { commerceCopy } from "../copy";
import { AccountError } from "../../../lib/api/private-client";
import {
	SettingsPage,
	SettingsSection,
	SettingsActions,
	settingsControl,
	useSettingsGuard,
} from "../../../components/accounts/seller-settings-ui";
import { Button } from "../../../components/ui/button";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { sellerBusinessSettingsCopy } from "../../../lib/i18n/seller-business-settings";
import { sellerHref } from "../../../lib/routes/account-routes";
import { SellerSelect } from "../../../app/[locale]/(seller)/account/seller/components/seller-select";
function safeTermsFields(cause: unknown): string[] {
	if (!(cause instanceof AccountError)) return [];
	return cause.fields
		.slice(0, 32)
		.filter(
			(field) =>
				/^(version|enabled|destinations|methods|reason|country|all_cities|cities)$/.test(
					field,
				) || /^destinations\.\d{1,2}\.(country|all_cities|cities)$/.test(field),
		);
}
export function CheckoutSettings({ locale }: { locale: Locale }) {
	const s = useCommunicationSession("seller"),
		seller = useSearchParams().get("seller") ?? "";
	if (s.loading)
		return (
			<SettingsPage locale={locale} page="settings/checkout">
				<p role="status">{sellerSettingsCopy[locale].loading}</p>
			</SettingsPage>
		);
	if (!s.session)
		return (
			<SettingsPage locale={locale} page="settings/checkout">
				<SessionEntry locale={locale} context="seller" error={s.error} />
			</SettingsPage>
		);
	return (
		<Settings
			key={`${s.session.identity.id}:${s.session.accounts[0].id}:${seller}:${locale}`}
			locale={locale}
			seller={seller}
		/>
	);
}
function Settings({ locale, seller }: { locale: Locale; seller: string }) {
	const t = commerceCopy[locale],
		copy = sellerBusinessSettingsCopy[locale],
		common = sellerSettingsCopy[locale],
		router = useRouter(),
		[profiles, setProfiles] = useState<Profile[]>([]),
		[terms, setTerms] = useState<Terms | null>(null),
		[baseline, setBaseline] = useState(""),
		[reason, setReason] = useState(""),
		[error, setError] = useState(""),
		[fields, setFields] = useState<string[]>([]),
		[loading, setLoading] = useState(true),
		[busy, setBusy] = useState(false),
		[saved, setSaved] = useState(false),
		[reload, setReload] = useState(0),
		live = useRef<object | null>(null),
		owned = useRef<object | null>(null);
	useEffect(() => {
		void reload;
		const mine = {};
		live.current = mine;
		owned.current = null;
		const c = new AbortController();
		setLoading(true);
		setBusy(false);
		setSaved(false);
		setError("");
		setFields([]);
		// A failed explicit reload must not erase the last owned draft/reason.
		// This component is still remounted for identity/account/business/locale changes.
		void (async () => {
			const p = await commerce<{ results: Profile[] }>(
				"orders/seller/profiles/",
				undefined,
				"GET",
				c.signal,
			);
			if (live.current !== mine) return;
			const rows = p.results.filter((x) => x.terms);
			setProfiles(rows);
			if (!seller) {
				if (rows[0])
					router.replace(sellerHref(locale, "settings/checkout", rows[0].id));
				return;
			}
			if (!rows.some((x) => x.id === seller)) throw new AccountError(403);
			const value = await commerce<Terms>(
				`orders/seller/checkout-terms/${seller}/`,
				undefined,
				"GET",
				c.signal,
			);
			if (live.current === mine) {
				const fresh = {
					...value,
					destinations: value.destinations.map((d) => ({
						...d,
						uiKey: crypto.randomUUID(),
					})),
				};
				setTerms(fresh);
				setBaseline(JSON.stringify(fresh));
				setError("");
				setReason("");
			}
		})()
			.catch((cause) => {
				if (live.current !== mine) return;
				const denied =
					cause instanceof AccountError &&
					[401, 403, 404].includes(cause.status || 0);
				if (denied) {
					setTerms(null);
					setBaseline("");
					setReason("");
				}
				setError(denied ? copy.checkoutDenied : copy.profilesFailed);
			})
			.finally(() => {
				if (live.current === mine) setLoading(false);
			});
		return () => {
			live.current = null;
			owned.current = null;
			c.abort();
		};
	}, [
		locale,
		seller,
		reload,
		router,
		copy.checkoutDenied,
		copy.profilesFailed,
	]);
	const dirty = !!terms && (!!reason || JSON.stringify(terms) !== baseline);
	const navigation = useSettingsGuard(locale, dirty);
	function changeTerms(value: Terms) {
		if (owned.current || loading) return;
		setTerms(value);
		setSaved(false);
	}
	function reloadCurrent() {
		if (owned.current || loading) return;
		navigation.choose(() => {
			if (owned.current) return;
			owned.current = {};
			setBusy(true);
			setLoading(true);
			setSaved(false);
			setError("");
			setFields([]);
			setReload((value) => value + 1);
		});
	}
	const fieldInvalid = (field: string) =>
		fields.includes(field) ||
		(field.startsWith("destinations.") &&
			(fields.includes("destinations") ||
				fields.includes(field.split(".").at(-1) || "")));
	const fieldFeedback = (field: string, id: string) =>
		fieldInvalid(field) ? (
			<p id={id} className="text-sm text-danger">
				{copy.fieldError}
			</p>
		) : null;
	async function save() {
		if (
			!terms ||
			terms.seller !== seller ||
			!live.current ||
			owned.current ||
			loading ||
			!profiles.some((profile) => profile.id === seller && profile.terms)
		)
			return;
		// Keep the explicit schema and input intact; enforce the existing bounds locally too.
		const invalid: string[] = [];
		if (reason.trim().length < 3 || reason.length > 1000)
			invalid.push("reason");
		if (terms.destinations.length > 20) invalid.push("destinations");
		terms.destinations.forEach((destination, index) => {
			if (!/^[A-Z]{2}$/.test(destination.country))
				invalid.push(`destinations.${index}.country`);
			if (
				!destination.all_cities &&
				(destination.cities.length > 20 ||
					!destination.cities.some((city) => city.trim()) ||
					destination.cities.some((city) => city.length > 100))
			)
				invalid.push(`destinations.${index}.cities`);
		});
		if (invalid.length) {
			setFields(invalid);
			setError(copy.checkFields);
			setSaved(false);
			return;
		}
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		setError("");
		setFields([]);
		setSaved(false);
		try {
			const { version, enabled, destinations, methods } = terms;
			const value = await commerce<Terms>(
				`orders/seller/checkout-terms/${seller}/`,
				{
					version,
					enabled,
					destinations: destinations.map(({ country, all_cities, cities }) => ({
						country,
						all_cities,
						cities,
					})),
					methods,
					reason,
				},
				"PUT",
			);
			if (live.current === mine && owned.current === write) {
				const fresh = {
					...value,
					destinations: value.destinations.map((d) => ({
						...d,
						uiKey: crypto.randomUUID(),
					})),
				};
				setTerms(fresh);
				setBaseline(JSON.stringify(fresh));
				setReason("");
				setSaved(true);
			}
		} catch (cause) {
			if (live.current === mine && owned.current === write) {
				setFields(safeTermsFields(cause));
				if (
					cause instanceof AccountError &&
					[401, 403, 404].includes(cause.status || 0)
				) {
					setTerms(null);
					setBaseline("");
					setReason("");
				}
				setError(
					cause instanceof AccountError
						? cause.status === 409
							? copy.checkoutStale
							: [401, 403, 404].includes(cause.status || 0)
								? copy.checkoutDenied
								: copy.checkoutFailed
						: copy.checkoutFailed,
				);
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	return (
		<SettingsPage
			locale={locale}
			page="settings/checkout"
			actions={
				<fieldset
					disabled={busy || loading}
					className="m-0 min-w-0 space-y-2 border-0 p-0 [&_button]:text-base"
				>
					<p className="text-sm font-medium text-muted">
						{common.businessScope}
					</p>
					<SellerSelect
						label={t.business}
						value={seller}
						icon="store"
						options={[
							{ value: "", label: t.choose },
							...profiles.map((profile) => ({
								value: profile.id,
								label: profile.name,
							})),
						]}
						onChange={(value) => {
							if (owned.current || loading) return;
							navigation.choose(() => {
								if (!owned.current)
									router.push(sellerHref(locale, "settings/checkout", value));
							});
						}}
					/>
				</fieldset>
			}
		>
			<div
				className="space-y-6"
				data-testid="checkout-settings"
				aria-busy={busy || loading}
			>
				{navigation.feedback}
				{(loading || busy) && (
					<p role="status" className="text-sm text-muted">
						{common.loading}
					</p>
				)}
				{error && (
					<p
						role="alert"
						className="rounded-xl border border-danger bg-surface p-4 text-danger"
					>
						{error}
					</p>
				)}
				{saved && (
					<p
						role="status"
						className="rounded-xl border border-border bg-success-surface p-4 text-success"
					>
						{copy.checkoutSaved}
					</p>
				)}
				{!loading && !error && !profiles.length && (
					<p className="rounded-xl border border-border bg-surface p-4 text-muted">
						{copy.noCheckoutBusiness}
					</p>
				)}
				{!loading && !error && !seller && profiles.length > 0 && (
					<p className="rounded-xl border border-border bg-surface p-4 text-muted">
						{copy.selectedRequired}
					</p>
				)}
				{terms && (
					<form
						className="space-y-6"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<fieldset
							disabled={busy || loading}
							className="m-0 min-w-0 space-y-6 border-0 p-0"
						>
							<SettingsSection
								title={copy.checkoutState}
								description={copy.enabledHelp}
								icon="store"
							>
								<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
									<div className="min-w-0">
										<p className="text-sm text-muted">{common.businessScope}</p>
										<p className="mt-1 text-lg font-semibold">
											<bdi>
												{
													profiles.find((profile) => profile.id === seller)
														?.name
												}
											</bdi>
										</p>
									</div>
									<button
										type="button"
										role="switch"
										aria-checked={terms.enabled}
										aria-invalid={fieldInvalid("enabled")}
										aria-describedby={
											fieldInvalid("enabled")
												? "checkout-enabled-error"
												: undefined
										}
										onClick={() =>
											changeTerms({ ...terms, enabled: !terms.enabled })
										}
										className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent p-0 text-start text-base font-medium disabled:cursor-not-allowed disabled:opacity-50"
									>
										<span
											aria-hidden="true"
											className={`relative h-7 w-12 shrink-0 rounded-full ${terms.enabled ? "bg-action" : "bg-control"}`}
										>
											<span
												className={`absolute start-1 top-1 size-5 rounded-full bg-surface shadow-sm transition-transform motion-reduce:transition-none ${terms.enabled ? "translate-x-5 rtl:-translate-x-5" : ""}`}
											/>
										</span>
										{t.enabled}
									</button>
								</div>
								{fieldFeedback("enabled", "checkout-enabled-error")}
							</SettingsSection>
							<SettingsSection
								title={copy.coverage}
								description={copy.coverageHelp}
								icon="globe"
							>
								{fieldFeedback("destinations", "checkout-destinations-error")}
								{!terms.destinations.length && (
									<p className="rounded-xl bg-page p-4 text-sm text-muted">
										{copy.noDestinations}
									</p>
								)}
								<div className="grid items-start gap-5 md:grid-cols-2">
									{terms.destinations.map((destination, index) => {
										const prefix = `checkout-destination-${destination.uiKey}`;
										const countryField = `destinations.${index}.country`,
											citiesField = `destinations.${index}.cities`,
											allCitiesField = `destinations.${index}.all_cities`;
										return (
											<div
												key={destination.uiKey}
												className="min-w-0 space-y-4 rounded-xl border border-border bg-page p-4"
											>
												<div className="flex flex-wrap items-center justify-between gap-2">
													<h3 className="text-base font-semibold">
														{t.destination} <bdi>{index + 1}</bdi>
													</h3>
													<Button
														variant="secondary"
														compact
														className="min-h-11"
														aria-label={`${t.remove} · ${t.destination} ${index + 1}`}
														onClick={() =>
															changeTerms({
																...terms,
																destinations: terms.destinations.filter(
																	(_, at) => at !== index,
																),
															})
														}
													>
														{t.remove}
													</Button>
												</div>
												<div className="space-y-2">
													<label
														htmlFor={`${prefix}-country`}
														className="block text-sm font-medium"
													>
														{t.country}
													</label>
													<input
														id={`${prefix}-country`}
														className={settingsControl}
														dir="ltr"
														pattern="[A-Z]{2}"
														required
														maxLength={2}
														autoCapitalize="characters"
														value={destination.country}
														aria-invalid={fieldInvalid(countryField)}
														aria-describedby={`${prefix}-country-help${fieldInvalid(countryField) ? ` ${prefix}-country-error` : ""}`}
														onChange={(event) =>
															changeTerms({
																...terms,
																destinations: terms.destinations.map(
																	(value, at) =>
																		at === index
																			? {
																					...value,
																					country:
																						event.target.value.toUpperCase(),
																				}
																			: value,
																),
															})
														}
													/>
													<p
														id={`${prefix}-country-help`}
														className="text-sm text-muted"
													>
														{copy.countryHelp}
													</p>
													{fieldFeedback(
														countryField,
														`${prefix}-country-error`,
													)}
												</div>
												<label className="flex min-h-11 items-center gap-3 text-base">
													<input
														type="checkbox"
														className="size-5 accent-action"
														checked={destination.all_cities}
														aria-invalid={fieldInvalid(allCitiesField)}
														aria-describedby={
															fieldInvalid(allCitiesField)
																? `${prefix}-all-cities-error`
																: undefined
														}
														onChange={(event) =>
															changeTerms({
																...terms,
																destinations: terms.destinations.map(
																	(value, at) =>
																		at === index
																			? {
																					...value,
																					all_cities: event.target.checked,
																					cities: [],
																				}
																			: value,
																),
															})
														}
													/>
													{t.allCities}
												</label>
												{fieldFeedback(
													allCitiesField,
													`${prefix}-all-cities-error`,
												)}
												{!destination.all_cities && (
													<div className="space-y-2">
														<label
															htmlFor={`${prefix}-cities`}
															className="block text-sm font-medium"
														>
															{t.cities}
														</label>
														<textarea
															id={`${prefix}-cities`}
															className={`${settingsControl} min-h-36`}
															required
															maxLength={2020}
															rows={4}
															value={destination.cities.join("\n")}
															aria-invalid={fieldInvalid(citiesField)}
															aria-describedby={`${prefix}-cities-help${fieldInvalid(citiesField) ? ` ${prefix}-cities-error` : ""}`}
															onChange={(event) =>
																changeTerms({
																	...terms,
																	destinations: terms.destinations.map(
																		(value, at) =>
																			at === index
																				? {
																						...value,
																						cities:
																							event.target.value.split("\n"),
																					}
																				: value,
																	),
																})
															}
														/>
														{fieldFeedback(
															citiesField,
															`${prefix}-cities-error`,
														)}
													</div>
												)}
												<p
													id={`${prefix}-cities-help`}
													className="text-sm leading-relaxed text-muted"
												>
													{copy.citiesHelp}
												</p>
											</div>
										);
									})}
								</div>
								<Button
									variant="secondary"
									disabled={terms.destinations.length >= 20}
									onClick={() =>
										changeTerms({
											...terms,
											destinations: [
												...terms.destinations,
												{
													uiKey: crypto.randomUUID(),
													country: "",
													all_cities: false,
													cities: [],
												},
											],
										})
									}
								>
									{copy.addDestination}
								</Button>
							</SettingsSection>
							<SettingsSection
								title={t.method}
								description={copy.methodsHelp}
								icon="wallet"
							>
								<div className="grid gap-4 md:grid-cols-2">
									{(["advance", "cod"] as const).map((method) => (
										<label
											key={method}
											className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-border bg-page p-4 text-base font-medium"
										>
											<input
												type="checkbox"
												className="size-5 accent-action"
												checked={terms.methods.includes(method)}
												aria-invalid={fieldInvalid("methods")}
												aria-describedby={
													fieldInvalid("methods")
														? "checkout-methods-error"
														: undefined
												}
												onChange={(event) =>
													changeTerms({
														...terms,
														methods: event.target.checked
															? [...terms.methods, method]
															: terms.methods.filter(
																	(value) => value !== method,
																),
													})
												}
											/>
											{t[method]}
										</label>
									))}
								</div>
								{!terms.methods.length && (
									<p className="text-sm text-muted">{copy.noMethods}</p>
								)}
								{fieldFeedback("methods", "checkout-methods-error")}
							</SettingsSection>
							<SettingsSection
								title={copy.changeReason}
								description={copy.reasonHelp}
								icon="file"
							>
								<div className="space-y-2">
									<label
										htmlFor="checkout-reason"
										className="block text-sm font-medium"
									>
										{t.reason}
									</label>
									<textarea
										id="checkout-reason"
										className={`${settingsControl} min-h-28`}
										minLength={3}
										maxLength={1000}
										required
										value={reason}
										aria-invalid={fieldInvalid("reason")}
										aria-describedby={
											fieldInvalid("reason")
												? "checkout-reason-error"
												: undefined
										}
										onChange={(event) => {
											if (!owned.current) {
												setReason(event.target.value);
												setSaved(false);
											}
										}}
									/>
									{fieldFeedback("reason", "checkout-reason-error")}
								</div>
								<p className="text-sm text-muted">
									{copy.version}: <bdi>{terms.version}</bdi>
								</p>
								{fieldFeedback("version", "checkout-version-error")}
								<SettingsActions dirty={dirty} locale={locale}>
									<Button
										type="submit"
										disabled={!dirty || reason.trim().length < 3}
									>
										{t.save}
									</Button>
									<Button variant="secondary" onClick={reloadCurrent}>
										{common.reload}
									</Button>
								</SettingsActions>
							</SettingsSection>
						</fieldset>
					</form>
				)}
				{!terms && (
					<Button
						variant="secondary"
						disabled={busy || loading}
						onClick={reloadCurrent}
					>
						{common.reload}
					</Button>
				)}
			</div>
		</SettingsPage>
	);
}
