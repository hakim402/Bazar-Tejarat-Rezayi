"use client";
import { useState } from "react";
import { contentCopy } from "../../../lib/i18n/content";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import type { Content } from "../types";
import { publicCall, validContent, contentPath } from "../api/public";
import { Document } from "./document";
export function PublicBody({
	initial,
	failure,
	locale,
	contentKey,
}: {
	initial: Content | null;
	failure: boolean;
	locale: Locale;
	contentKey: string;
}) {
	const [data, setData] = useState(initial);
	const [error, setError] = useState(failure);
	const [busy, setBusy] = useState(false);
	const [updated, setUpdated] = useState(false);
	const t = contentCopy[locale];
	async function reload() {
		setBusy(true);
		setUpdated(false);
		try {
			setData(
				await publicCall(
					process.env.NEXT_PUBLIC_API_URL,
					contentPath(locale, contentKey),
					validContent,
				),
			);
			setError(false);
			setUpdated(true);
		} catch {
			setError(true);
			setData(null);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="space-y-6">
			{error ? (
				<div
					role="alert"
					data-testid="public-error"
					className="rounded-card border border-border bg-warning-surface p-5"
				>
					<h1>{t.outage}</h1>
				</div>
			) : data ? (
				<>
					{data.fallback && (
						<p
							className="rounded-control bg-info p-3"
							data-testid="source-fallback"
						>
							{t.fallback}
						</p>
					)}
					<Document
						data={data.payload}
						locale={locale}
						contentLocale={data.content_locale as Locale}
					/>
					{data.effective_date && (
						<p>
							{t.effective}: <bdi>{data.effective_date}</bdi> · {t.version}{" "}
							{data.number}
						</p>
					)}
				</>
			) : (
				<section className="rounded-card border border-border bg-surface p-6">
					<h1>{t.unavailable}</h1>
				</section>
			)}
			<Button variant="secondary" disabled={busy} onClick={reload}>
				{busy ? t.loading : error || !data ? t.retry : t.refresh}
			</Button>
			<p role="status">{updated ? t.updated : ""}</p>
		</div>
	);
}
