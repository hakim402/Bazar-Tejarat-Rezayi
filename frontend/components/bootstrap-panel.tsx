"use client";
import { useEffect, useRef, useState } from "react";
import {
	ApiError,
	getBootstrap,
	type Bootstrap,
	type ApiFailure,
} from "../lib/api/client";
import { languageNames, type Locale, isLocale } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
import { Button, Card, Ltr, Notice } from "./ui";
export function BootstrapPanel({
	locale,
	initial,
	initialFailure,
}: {
	locale: Locale;
	initial: Bootstrap | null;
	initialFailure: ApiFailure | null;
}) {
	const t = messages[locale];
	const [data, setData] = useState(initial);
	const [failure, setFailure] = useState(initialFailure);
	const [busy, setBusy] = useState(false);
	const [updated, setUpdated] = useState(false);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	async function refresh() {
		controller.current?.abort();
		const request = new AbortController();
		controller.current = request;
		setBusy(true);
		setUpdated(false);
		setFailure(null);
		try {
			const response = await getBootstrap(process.env.NEXT_PUBLIC_API_URL, {
				signal: request.signal,
			});
			if (!request.signal.aborted) {
				setData(response);
				setUpdated(true);
			}
		} catch (error) {
			if (!request.signal.aborted) {
				setData(null);
				setFailure(error instanceof ApiError ? error.kind : "unavailable");
			}
		} finally {
			if (!request.signal.aborted) setBusy(false);
		}
	}
	return (
		<section aria-label={t.info} className="bootstrap-section" aria-busy={busy}>
			{failure && (
				<Notice error>
					{failure === "timeout"
						? t.timeout
						: failure === "invalid"
							? t.invalid
							: t.unavailable}
				</Notice>
			)}
			{data && (
				<>
					<div className="section-heading">
						<div>
							<p className="eyebrow">{data.brand_names[locale]}</p>
							<h2>{t.preferences}</h2>
						</div>
						<p className="muted narrow">{t.preferencesBody}</p>
					</div>
					<div className="foundation-grid">
						<Card>
							<span className="card-index" aria-hidden="true">
								01
							</span>
							<h3>{t.foundation}</h3>
							<p>{t.foundationBody}</p>
							<ul className="language-list">
								{data.supported_locales.map((value) => (
									<li
										key={value}
										lang={value}
										dir={value === "en" ? "ltr" : "rtl"}
									>
										{isLocale(value) ? languageNames[value] : value}
									</li>
								))}
							</ul>
						</Card>
						<Card>
							<span className="card-index" aria-hidden="true">
								02
							</span>
							<h3>{t.currencies}</h3>
							<p>{t.currenciesBody}</p>
							<div className="currency-list">
								{data.currencies.map((currency) => (
									<Ltr key={currency}>{currency}</Ltr>
								))}
							</div>
							<small>{t.currencyNote}</small>
						</Card>
					</div>
				</>
			)}
			<div className="refresh-row">
				<Button onClick={refresh} disabled={busy}>
					{busy ? t.loading : t.refresh}
				</Button>
				<span role="status" className="muted">
					{updated ? t.updated : ""}
				</span>
			</div>
		</section>
	);
}
