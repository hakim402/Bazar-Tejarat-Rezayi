"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { AccountError } from "../../../lib/api/private-client";
import { orgRequest } from "../api/organizations";
import { organizationCopy } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import { Alert } from "../../../components/ui/alert";

export function useWorkflow<T>(path: string, locale: Locale) {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [fields, setFields] = useState<string[]>([]);
	const [notice, setNotice] = useState("");
	const t = organizationCopy[locale];
	const failure = useCallback(
		(cause: unknown) => {
			setFields(cause instanceof AccountError ? cause.fields : []);
			setError(
				cause instanceof AccountError
					? cause.status === 403
						? t.denied
						: cause.status === 409
							? t.stale
							: `${t.invalid}${cause.fields.length ? ` (${cause.fields.map((f) => t[f as keyof typeof t] ?? t.fields).join(", ")})` : ""}`
					: t.failed,
			);
		},
		[t],
	);
	const refresh = useCallback(async () => {
		setLoading(true);
		setError("");
		setFields([]);
		try {
			setData(await orgRequest<T>(path));
		} catch (e) {
			setData(null);
			failure(e);
		} finally {
			setLoading(false);
		}
	}, [path, failure]);
	useEffect(() => {
		let active = true;
		setData(null);
		setLoading(true);
		setError("");
		setFields([]);
		orgRequest<T>(path)
			.then((result) => {
				if (active) setData(result);
			})
			.catch((e) => {
				if (active) failure(e);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [path, failure]);
	async function mutate<Result = unknown>(
		target: string,
		values: unknown,
		method = "POST",
	) {
		setBusy(true);
		setError("");
		setFields([]);
		setNotice("");
		try {
			// A mutation acknowledgment is never used as private detail or queue data.
			await orgRequest<Result>(target, values, method);
			await refresh();
			setNotice(t.saved);
			return true;
		} catch (e) {
			failure(e);
			return false;
		} finally {
			setBusy(false);
		}
	}
	return { data, loading, busy, error, fields, notice, refresh, mutate };
}
export function WorkflowState({
	state,
	locale,
}: {
	state: {
		loading: boolean;
		error: string;
		notice: string;
		refresh: () => void;
	};
	locale: Locale;
}) {
	const t = organizationCopy[locale];
	const alertRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (state.error) alertRef.current?.focus();
	}, [state.error]);
	return (
		<>
			{state.loading && <p role="status">{t.loading}</p>}
			{state.error && (
				<>
					<Alert role="alert" tabIndex={-1} ref={alertRef}>
						{state.error}
					</Alert>
					<Button variant="secondary" onClick={state.refresh}>
						{t.retry}
					</Button>
				</>
			)}
			{state.notice && (
				<p
					role="status"
					className="rounded-control bg-success-surface p-3 text-success"
				>
					{state.notice}
				</p>
			)}
		</>
	);
}
export function WorkspaceNav({
	locale,
	context,
}: {
	locale: Locale;
	context: string;
}) {
	const t = organizationCopy[locale];
	return (
		<nav className="my-5 flex flex-wrap gap-4 text-action" aria-label={t.title}>
			<Link href={`/${locale}/account/${context}`}>{t.back}</Link>
			{context === "staff" ? (
				<>
					<Link href={`/${locale}/account/staff/verification`}>{t.review}</Link>
					<Link href={`/${locale}/account/staff/transfers`}>{t.transfers}</Link>
				</>
			) : (
				<Link href={`/${locale}/account/${context}/organizations`}>
					{t.select}
				</Link>
			)}
		</nav>
	);
}
