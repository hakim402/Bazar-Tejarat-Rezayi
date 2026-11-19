"use client";
import { SessionEntry } from "./session-entry";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { useCommunicationSession } from "../../messaging/hooks";
import { commerce, type Terms, type Profile } from "../api";
import { commerceCopy } from "../copy";
import { AccountError } from "../../../lib/api/private-client";
import {
	SettingsPage,
	BusinessDialog,
	SettingsActions,
	useSettingsGuard,
} from "../../../components/accounts/seller-settings-ui";
import { Input } from "../../../components/shadcn/input";
import { Textarea } from "../../../components/shadcn/textarea";
import { Checkbox } from "../../../components/shadcn/checkbox";
import { Switch } from "../../../components/shadcn/switch";
import { Button } from "../../../components/shadcn/button";
import { DiscardDialog } from "../../../components/ui/discard-dialog";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { sellerBusinessSettingsCopy } from "../../../lib/i18n/seller-business-settings";
import { sellerHref } from "../../../lib/routes/account-routes";
import { SellerSelect } from "../../../components/seller-select";
import { Label } from "../../../components/shadcn/label";
import { DashboardCard } from "../../../components/ui/dashboard-card";
import { EmptyState } from "../../../components/ui/empty-state";
import { Icon } from "../../../components/ui/icon";
type Destination = Terms["destinations"][number];
type DestinationField = "country" | "all_cities" | "cities";
type DestinationDraft = {
	value: Destination;
	baseline: string;
	index: number | null;
	fields: DestinationField[];
};
function invalidDestinationFields(
	destination: Destination,
): DestinationField[] {
	const invalid: DestinationField[] = [];
	if (!/^[A-Z]{2}$/.test(destination.country)) invalid.push("country");
	if (
		!destination.all_cities &&
		(destination.cities.length > 20 ||
			!destination.cities.some((city) => city.trim()) ||
			destination.cities.some((city) => city.length > 100))
	)
		invalid.push("cities");
	return invalid;
}
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
		[destinationDraft, setDestinationDraft] = useState<DestinationDraft | null>(
			null,
		),
		[discardDestination, setDiscardDestination] = useState(false),
		destinationTrigger = useRef<HTMLElement | null>(null),
		destinationFocus = useRef<HTMLElement | null>(null),
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
				setDestinationDraft(null);
				setDiscardDestination(false);
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
					setDestinationDraft(null);
					setDiscardDestination(false);
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
	const destinationDirty =
		!!destinationDraft &&
		JSON.stringify(destinationDraft.value) !== destinationDraft.baseline;
	const dirty =
		!!terms &&
		(!!reason || JSON.stringify(terms) !== baseline || destinationDirty);
	const navigation = useSettingsGuard(locale, dirty);
	const destinationOpen = destinationDraft !== null;
	useEffect(() => {
		if (!destinationOpen && destinationTrigger.current) {
			const trigger = destinationTrigger.current;
			destinationTrigger.current = null;
			// The controlled dialog has no single trigger; restore the row/add button.
			const frame = requestAnimationFrame(() => {
				if (trigger.isConnected) trigger.focus();
			});
			return () => cancelAnimationFrame(frame);
		}
	}, [destinationOpen]);
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
	function openDestination(index: number | null, trigger: HTMLElement) {
		if (!terms || owned.current || loading || destinationDraft) return;
		if (index === null && terms.destinations.length >= 20) return;
		const value: Destination =
			index === null
				? {
						uiKey: crypto.randomUUID(),
						country: "",
						all_cities: false,
						cities: [],
					}
				: {
						...terms.destinations[index],
						cities: [...terms.destinations[index].cities],
					};
		destinationTrigger.current = trigger;
		setDestinationDraft({
			value,
			baseline: JSON.stringify(value),
			index,
			fields:
				index === null
					? []
					: (["country", "all_cities", "cities"] as const).filter((field) =>
							fieldInvalid(`destinations.${index}.${field}`),
						),
		});
	}
	function changeDestination(value: Destination) {
		if (owned.current || loading) return;
		setDestinationDraft((draft) => (draft ? { ...draft, value } : null));
		setSaved(false);
	}
	function closeDestination() {
		if (owned.current || loading) return;
		if (destinationDirty) {
			destinationFocus.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setDiscardDestination(true);
		} else setDestinationDraft(null);
	}
	function applyDestination() {
		if (
			!terms ||
			!destinationDraft ||
			!live.current ||
			owned.current ||
			loading ||
			terms.seller !== seller ||
			!profiles.some((profile) => profile.id === seller && profile.terms)
		)
			return;
		const { value, index } = destinationDraft;
		const invalid = invalidDestinationFields(value);
		if (terms.destinations.length + (index === null ? 1 : 0) > 20)
			invalid.push("country");
		if (invalid.length) {
			setDestinationDraft({ ...destinationDraft, fields: invalid });
			document
				.getElementById(`checkout-destination-${value.uiKey}-${invalid[0]}`)
				?.focus();
			return;
		}
		// Applying a country only edits the page draft. The versioned PUT stays in save().
		changeTerms({
			...terms,
			destinations:
				index === null
					? [...terms.destinations, value]
					: terms.destinations.map((destination, at) =>
							at === index ? value : destination,
						),
		});
		setDestinationDraft(null);
		setDiscardDestination(false);
	}
	function removeDestination(index: number) {
		if (!terms || owned.current || loading || destinationDraft) return;
		changeTerms({
			...terms,
			destinations: terms.destinations.filter((_, at) => at !== index),
		});
		// Keep server field errors attached to their country after a row is removed.
		setFields((current) =>
			current.flatMap((field) => {
				const match = /^destinations\.(\d+)\.(country|all_cities|cities)$/.exec(
					field,
				);
				if (!match) return [field];
				const at = Number(match[1]);
				return at === index
					? []
					: [`destinations.${at > index ? at - 1 : at}.${match[2]}`];
			}),
		);
	}
	async function save() {
		if (
			!terms ||
			destinationDraft ||
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
			invalid.push(
				...invalidDestinationFields(destination).map(
					(field) => `destinations.${index}.${field}`,
				),
			);
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
				toast.success(copy.checkoutSaved);
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
					setDestinationDraft(null);
					setDiscardDestination(false);
				}
				const message =
					cause instanceof AccountError
						? cause.status === 409
							? copy.checkoutStale
							: [401, 403, 404].includes(cause.status || 0)
								? copy.checkoutDenied
								: copy.checkoutFailed
						: copy.checkoutFailed;
				setError(message);
				toast.error(message);
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	const destinationPrefix = `checkout-destination-${destinationDraft?.value.uiKey}`;
	const destinationFieldInvalid = (field: DestinationField) =>
		destinationDraft?.fields.includes(field) ?? false;
	const destinationFeedback = (
		field: DestinationField,
		suffix: string = field,
	) =>
		destinationFieldInvalid(field) ? (
			<p
				id={`${destinationPrefix}-${suffix}-error`}
				className="m-0 text-sm text-danger"
			>
				{copy.fieldError}
			</p>
		) : null;
	return (
		<SettingsPage
			locale={locale}
			page="settings/checkout"
			actions={
				<fieldset
					disabled={busy || loading}
					className="m-0 min-w-0 space-y-2 border-0 p-0"
				>
					<p className="text-sm font-medium text-muted">
						{common.businessScope}
					</p>
					<SellerSelect
						dir={direction(locale)}
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
				className="space-y-4"
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
						className="m-0 rounded-lg border border-solid border-danger bg-surface p-3 text-sm text-danger"
					>
						{error}
					</p>
				)}
				{saved && (
					<p
						role="status"
						className="m-0 rounded-lg border border-solid border-border bg-surface p-3 text-sm text-success"
					>
						{copy.checkoutSaved}
					</p>
				)}
				{!loading && !error && !profiles.length && (
					<p className="m-0 rounded-lg border border-solid border-border bg-surface p-3 text-sm text-muted">
						{copy.noCheckoutBusiness}
					</p>
				)}
				{!loading && !error && !seller && profiles.length > 0 && (
					<p className="m-0 rounded-lg border border-solid border-border bg-surface p-3 text-sm text-muted">
						{copy.selectedRequired}
					</p>
				)}
				{terms && (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<fieldset
							disabled={busy || loading || destinationOpen}
							className="m-0 min-w-0 space-y-4 border-0 p-0"
						>
							<DashboardCard
								title={copy.checkoutState}
								icon="store"
								action={
									<div className="flex min-h-11 items-center gap-3 rounded-control bg-page px-3">
										<Label
											htmlFor="checkout-enabled"
											className="text-sm font-medium"
										>
											{t.enabled}
										</Label>
										<Switch
											id="checkout-enabled"
											checked={terms.enabled}
											disabled={busy || loading}
											onCheckedChange={(checked) =>
												changeTerms({ ...terms, enabled: checked })
											}
											aria-invalid={fieldInvalid("enabled")}
											aria-describedby={`checkout-enabled-help${fieldInvalid("enabled") ? " checkout-enabled-error" : ""}`}
										/>
									</div>
								}
							>
								<p
									id="checkout-enabled-help"
									className="m-0 max-w-2xl text-sm leading-relaxed text-muted"
								>
									{copy.enabledHelp}
								</p>
								{fieldFeedback("enabled", "checkout-enabled-error")}
							</DashboardCard>
							<DashboardCard
								title={copy.coverage}
								description={copy.coverageHelp}
								icon="globe"
								action={
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="min-h-11 shadow-none sm:min-h-8"
										disabled={
											busy || loading || terms.destinations.length >= 20
										}
										onClick={(event) =>
											openDestination(null, event.currentTarget)
										}
									>
										<Plus aria-hidden="true" />
										{copy.addDestination}
									</Button>
								}
							>
								{fieldFeedback("destinations", "checkout-destinations-error")}
								{!terms.destinations.length && (
									<EmptyState
										borderless
										icon="globe"
										title={copy.noDestinations}
									/>
								)}
								<div>
									{terms.destinations.map((destination, index) => {
										const prefix = `checkout-destination-${destination.uiKey}`;
										const invalid = ["country", "cities", "all_cities"].some(
											(field) => fieldInvalid(`destinations.${index}.${field}`),
										);
										return (
											<div
												key={destination.uiKey}
												className="flex min-w-0 flex-col gap-2 border-0 border-b border-solid border-border py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
											>
												<div className="flex min-w-0 items-start gap-3">
													<span
														className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info text-action"
														aria-hidden="true"
													>
														<Icon name="map-pin" className="size-5" />
													</span>
													<div className="min-w-0 space-y-1">
														<p className="m-0 text-sm font-semibold">
															<bdi>{destination.country}</bdi>
														</p>
														<p className="m-0 break-words text-sm leading-relaxed text-muted">
															{destination.all_cities ? (
																t.allCities
															) : (
																<bdi>
																	{destination.cities
																		.filter((city) => city.trim())
																		.join(" · ")}
																</bdi>
															)}
														</p>
														{invalid && (
															<p
																id={`${prefix}-row-error`}
																className="m-0 text-sm text-danger"
															>
																{copy.fieldError}
															</p>
														)}
													</div>
												</div>
												<div className="flex shrink-0 flex-wrap items-center gap-1 self-end sm:self-auto">
													<Button
														type="button"
														id={`${prefix}-edit`}
														variant="ghost"
														size="sm"
														className="min-h-11 sm:min-h-8"
														aria-label={`${common.edit} · ${destination.country}`}
														aria-describedby={
															invalid ? `${prefix}-row-error` : undefined
														}
														onClick={(event) =>
															openDestination(index, event.currentTarget)
														}
													>
														<Pencil aria-hidden="true" />
														{common.edit}
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														className="min-h-11 text-danger hover:bg-danger/10 hover:text-danger sm:min-h-8"
														aria-label={`${t.remove} · ${destination.country}`}
														onClick={() => removeDestination(index)}
													>
														<Trash2 aria-hidden="true" />
														{t.remove}
													</Button>
												</div>
											</div>
										);
									})}
								</div>
							</DashboardCard>
							<DashboardCard
								title={t.method}
								description={copy.methodsHelp}
								icon="wallet"
							>
								<div className="grid gap-3 sm:grid-cols-2">
									{(["advance", "cod"] as const).map((method) => (
										<Label
											key={method}
											htmlFor={`checkout-method-${method}`}
											className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-control border border-solid p-3 text-sm font-medium transition-colors motion-reduce:transition-none has-[:disabled]:cursor-not-allowed ${terms.methods.includes(method) ? "border-action/30 bg-info text-action" : "border-border bg-surface text-foreground hover:bg-page"}`}
										>
											<Checkbox
												id={`checkout-method-${method}`}
												checked={terms.methods.includes(method)}
												disabled={busy || loading}
												aria-invalid={fieldInvalid("methods")}
												aria-describedby={
													fieldInvalid("methods")
														? "checkout-methods-error"
														: undefined
												}
												onCheckedChange={(checked) =>
													changeTerms({
														...terms,
														methods:
															checked === true
																? [...terms.methods, method]
																: terms.methods.filter(
																		(value) => value !== method,
																	),
													})
												}
											/>
											{t[method]}
											<Icon
												name={method === "advance" ? "wallet" : "truck"}
												className="ms-auto size-5 shrink-0"
												aria-hidden="true"
											/>
										</Label>
									))}
								</div>
								{!terms.methods.length && (
									<p className="text-sm text-muted">{copy.noMethods}</p>
								)}
								{fieldFeedback("methods", "checkout-methods-error")}
							</DashboardCard>
							<DashboardCard
								title={copy.changeReason}
								description={copy.reasonHelp}
								icon="file"
							>
								<div className="space-y-4">
									<div className="space-y-2">
										<Label
											htmlFor="checkout-reason"
											className="block text-sm font-medium"
										>
											{t.reason}
										</Label>
										<Textarea
											id="checkout-reason"
											className="min-h-16 bg-surface text-foreground shadow-none"
											rows={2}
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
										{copy.version}:{" "}
										<bdi>
											{new Intl.NumberFormat(locale).format(terms.version)}
										</bdi>
									</p>
									{fieldFeedback("version", "checkout-version-error")}
									<SettingsActions dirty={dirty} locale={locale}>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="min-h-11 shadow-none sm:min-h-8"
											onClick={reloadCurrent}
										>
											{common.reload}
										</Button>
										<Button
											type="submit"
											size="sm"
											disabled={
												busy ||
												loading ||
												destinationOpen ||
												!dirty ||
												reason.trim().length < 3
											}
										>
											{t.save}
										</Button>
									</SettingsActions>
								</div>
							</DashboardCard>
						</fieldset>
					</form>
				)}
				{terms && destinationDraft && (
					<BusinessDialog
						locale={locale}
						title={
							destinationDraft.index === null
								? copy.addDestination
								: `${common.edit} · ${t.country}`
						}
						description={copy.coverageHelp}
						open
						busy={busy || loading || discardDestination}
						onOpenChange={(open) => {
							if (!open) closeDestination();
						}}
					>
						<form
							noValidate
							onSubmit={(event) => {
								event.preventDefault();
								applyDestination();
							}}
						>
							<fieldset
								disabled={busy || loading}
								className="m-0 min-w-0 space-y-4 border-0 p-0"
							>
								<div className="space-y-2">
									<Label
										htmlFor={`${destinationPrefix}-country`}
										className="block text-sm font-medium"
									>
										{t.country}
									</Label>
									<Input
										id={`${destinationPrefix}-country`}
										className="max-w-40 bg-surface font-identifier text-foreground shadow-none"
										dir="ltr"
										pattern="[A-Z]{2}"
										required
										maxLength={2}
										autoCapitalize="characters"
										value={destinationDraft.value.country}
										aria-invalid={destinationFieldInvalid("country")}
										aria-describedby={`${destinationPrefix}-country-help${destinationFieldInvalid("country") ? ` ${destinationPrefix}-country-error` : ""}`}
										onChange={(event) =>
											changeDestination({
												...destinationDraft.value,
												country: event.target.value.toUpperCase(),
											})
										}
									/>
									<p
										id={`${destinationPrefix}-country-help`}
										className="m-0 text-sm leading-relaxed text-muted"
									>
										{copy.countryHelp}
									</p>
									{destinationFeedback("country")}
								</div>
								<div className="space-y-2">
									<Label
										htmlFor={`${destinationPrefix}-all-cities`}
										className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control bg-page p-3 text-sm font-medium"
									>
										<Checkbox
											id={`${destinationPrefix}-all-cities`}
											checked={destinationDraft.value.all_cities}
											disabled={busy || loading}
											aria-invalid={destinationFieldInvalid("all_cities")}
											aria-describedby={`${destinationPrefix}-cities-help${destinationFieldInvalid("all_cities") ? ` ${destinationPrefix}-all-cities-error` : ""}`}
											onCheckedChange={(checked) =>
												changeDestination({
													...destinationDraft.value,
													all_cities: checked === true,
													cities: [],
												})
											}
										/>
										{t.allCities}
									</Label>
									{destinationFeedback("all_cities", "all-cities")}
								</div>
								{!destinationDraft.value.all_cities && (
									<div className="space-y-2">
										<Label
											htmlFor={`${destinationPrefix}-cities`}
											className="block text-sm font-medium"
										>
											{t.cities}
										</Label>
										<Textarea
											id={`${destinationPrefix}-cities`}
											className="min-h-24 bg-surface text-foreground shadow-none"
											required
											maxLength={2020}
											rows={4}
											value={destinationDraft.value.cities.join("\n")}
											aria-invalid={destinationFieldInvalid("cities")}
											aria-describedby={`${destinationPrefix}-cities-help${destinationFieldInvalid("cities") ? ` ${destinationPrefix}-cities-error` : ""}`}
											onChange={(event) =>
												changeDestination({
													...destinationDraft.value,
													cities: event.target.value.split("\n"),
												})
											}
										/>
									</div>
								)}
								{destinationFeedback("cities")}
								<p
									id={`${destinationPrefix}-cities-help`}
									className="m-0 text-sm leading-relaxed text-muted"
								>
									{copy.citiesHelp}
								</p>
								<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-border pt-4">
									<span role="status" className="text-sm text-muted">
										{destinationDirty ? common.unsaved : ""}
									</span>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="min-h-11 shadow-none sm:min-h-8"
											onClick={closeDestination}
										>
											{common.cancel}
										</Button>
										<Button
											type="submit"
											size="sm"
											className="min-h-11 sm:min-h-8"
										>
											{destinationDraft.index === null
												? copy.addDestination
												: t.update}
										</Button>
									</div>
								</div>
							</fieldset>
						</form>
						<DiscardDialog
							locale={locale}
							open={discardDestination}
							title={common.dirtyTitle}
							help={common.dirtyHelp}
							cancelLabel={common.stay}
							confirmLabel={common.discard}
							onCancel={() => {
								setDiscardDestination(false);
								requestAnimationFrame(() => {
									if (destinationFocus.current?.isConnected)
										destinationFocus.current.focus();
									else
										document
											.getElementById(`${destinationPrefix}-country`)
											?.focus();
								});
							}}
							onConfirm={() => {
								if (owned.current || loading) return;
								setDiscardDestination(false);
								setDestinationDraft(null);
							}}
						/>
					</BusinessDialog>
				)}
				{!terms && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="min-h-11 shadow-none sm:min-h-8"
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
