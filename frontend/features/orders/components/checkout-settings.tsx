"use client";
import { SessionEntry } from "./session-entry";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { useCommunicationSession } from "../../messaging/hooks";
import { commerce, type Terms, type Profile } from "../api";
import { commerceCopy } from "../copy";
import { useCommerceGuard } from "./unsaved";
import { action, control, Failure, panel } from "./controls";
export function CheckoutSettings({ locale }: { locale: Locale }) {
	const s = useCommunicationSession("seller"),
		seller = useSearchParams().get("seller") ?? "",
		t = commerceCopy[locale];
	if (s.loading) return <p>{t.loading}</p>;
	if (!s.session)
		return <SessionEntry locale={locale} context={"seller"} error={s.error} />;
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
		router = useRouter(),
		[profiles, setProfiles] = useState<Profile[]>([]),
		[terms, setTerms] = useState<Terms | null>(null),
		[baseline, setBaseline] = useState(""),
		[reason, setReason] = useState(""),
		[error, setError] = useState<unknown>(),
		[busy, setBusy] = useState(false),
		[saved, setSaved] = useState(false),
		[reload, setReload] = useState(0),
		live = useRef<object | null>(null),
		owned = useRef<object | null>(null);
	useEffect(() => {
		void reload;
		const mine = {};
		live.current = mine;
		const c = new AbortController();
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
					router.replace(
						`/${locale}/account/seller/settings/checkout?seller=${rows[0].id}`,
					);
				return;
			}
			if (!rows.some((x) => x.id === seller)) throw new Error("scope");
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
				setError(null);
				setReason("");
			}
		})().catch((e) => {
			if (live.current === mine) setError(e);
		});
		return () => {
			live.current = null;
			owned.current = null;
			c.abort();
		};
	}, [locale, seller, reload, router]);
	const navigation = useCommerceGuard(
		locale,
		!!terms && (!!reason || JSON.stringify(terms) !== baseline),
	);
	async function save() {
		if (!terms || owned.current) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		setError(null);
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
		} catch (e) {
			if (live.current === mine && owned.current === write) setError(e);
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	return (
		<section className="space-y-5" data-testid="checkout-settings">
			<h1 className="text-3xl font-bold">{t.terms}</h1>
			<p>{t.termsHelp}</p>
			<Failure locale={locale} error={error} />
			{navigation.feedback}
			{saved && <p role="status">{t.saved}</p>}
			<label className="block space-y-2">
				{t.business}
				<select
					aria-label={t.business}
					className={control}
					value={seller}
					disabled={busy}
					onChange={(e) =>
						navigation.choose(() =>
							router.push(
								`/${locale}/account/seller/settings/checkout?seller=${e.target.value}`,
							),
						)
					}
				>
					<option value="">{t.choose}</option>
					{profiles.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			</label>
			{terms && (
				<form
					className="space-y-5"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<fieldset disabled={busy} className="space-y-5">
						<label className="flex min-h-11 items-center gap-3">
							<input
								type="checkbox"
								checked={terms.enabled}
								onChange={(e) =>
									setTerms({ ...terms, enabled: e.target.checked })
								}
							/>
							{t.enabled}
						</label>
						{terms.destinations.map((d, i) => (
							<section key={d.uiKey} className={panel}>
								<label className="block space-y-2">
									{t.country}
									<input
										className={control}
										dir="ltr"
										pattern="[A-Z]{2}"
										required
										maxLength={2}
										value={d.country}
										onChange={(e) =>
											setTerms({
												...terms,
												destinations: terms.destinations.map((x, j) =>
													j === i
														? { ...x, country: e.target.value.toUpperCase() }
														: x,
												),
											})
										}
									/>
								</label>
								<label className="flex min-h-11 items-center gap-3">
									<input
										type="checkbox"
										checked={d.all_cities}
										onChange={(e) =>
											setTerms({
												...terms,
												destinations: terms.destinations.map((x, j) =>
													j === i
														? { ...x, all_cities: e.target.checked, cities: [] }
														: x,
												),
											})
										}
									/>
									{t.allCities}
								</label>
								{!d.all_cities && (
									<label className="block space-y-2">
										{t.cities}
										<textarea
											className={control}
											required
											maxLength={2020}
											rows={4}
											value={d.cities.join("\n")}
											onChange={(e) =>
												setTerms({
													...terms,
													destinations: terms.destinations.map((x, j) =>
														j === i
															? { ...x, cities: e.target.value.split("\n") }
															: x,
													),
												})
											}
										/>
									</label>
								)}
								<button
									type="button"
									className={action}
									onClick={() =>
										setTerms({
											...terms,
											destinations: terms.destinations.filter(
												(_, j) => j !== i,
											),
										})
									}
								>
									{t.remove}
								</button>
							</section>
						))}
						<button
							type="button"
							className={action}
							disabled={terms.destinations.length >= 20}
							onClick={() =>
								setTerms({
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
							{t.choose} · {t.destination}
						</button>
						<fieldset className={panel}>
							<legend>{t.method}</legend>
							{(["advance", "cod"] as const).map((m) => (
								<label key={m} className="flex min-h-11 items-center gap-3">
									<input
										type="checkbox"
										checked={terms.methods.includes(m)}
										onChange={(e) =>
											setTerms({
												...terms,
												methods: e.target.checked
													? [...terms.methods, m]
													: terms.methods.filter((x) => x !== m),
											})
										}
									/>
									{t[m]}
								</label>
							))}
						</fieldset>
						<label className="block space-y-2">
							{t.reason}
							<textarea
								aria-label={t.reason}
								className={control}
								minLength={3}
								maxLength={1000}
								required
								value={reason}
								onChange={(e) => setReason(e.target.value)}
							/>
						</label>
						<button className={action} type="submit">
							{busy ? t.loading : t.save}
						</button>
					</fieldset>
				</form>
			)}
			<button
				type="button"
				className={action}
				disabled={busy}
				onClick={() => navigation.choose(() => setReload((v) => v + 1))}
			>
				{t.reload}
			</button>
		</section>
	);
}
