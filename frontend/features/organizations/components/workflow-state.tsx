"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { AccountError } from "../../../lib/api/private-client";
import { ACCOUNT_SESSION_CHANGED } from "../../identity/api/accounts";
import { orgRequest } from "../api/organizations";
import { organizationCopy } from "../../../lib/i18n/organizations";
import { sellerBusinessCopy } from "../../../lib/i18n/seller-business";
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
// Seller opt-in: default workflows above retain their original contract.
export type SellerWorkflowOptions = {
	lock?: { current: boolean };
	refreshAuthority?: () => Promise<boolean>;
};
export function useSellerWorkflow<T>(
	path: string,
	locale: Locale,
	options: SellerWorkflowOptions = {},
) {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [fields, setFields] = useState<string[]>([]);
	const [notice, setNotice] = useState("");
	const [blocked, setBlocked] = useState(false);
	const [denied, setDenied] = useState(false);
	const scope = `${locale}:${path}`;
	const owner = useRef({ scope, active: true, read: 0, writing: false });
	if (owner.current.scope !== scope) {
		owner.current.active = false;
		owner.current = { scope, active: true, read: 0, writing: false };
	}
	const configuration = useRef(options);
	configuration.current = options;
	const latest = useRef<T | null>(null);
	const needsReload = useRef(false);
	const t = organizationCopy[locale];
	const copy = sellerBusinessCopy[locale];
	const failure = useCallback(
		(cause: unknown, reading = false) => {
			const denied =
				cause instanceof AccountError && [401, 403, 404].includes(cause.status);
			if (denied) {
				latest.current = null;
				setData(null);
				setDenied(true);
			}
			setFields(cause instanceof AccountError ? cause.fields : []);
			setError(
				denied
					? t.denied
					: reading
						? copy.refreshFailed
						: cause instanceof AccountError && cause.status === 409
							? t.stale
							: cause instanceof AccountError
								? t.invalid
								: t.failed,
			);
		},
		[t, copy],
	);
	const refresh = useCallback(async () => {
		const life = owner.current;
		if (!life.active) return false;
		const request = ++life.read;
		setLoading(true);
		setError("");
		setFields([]);
		try {
			const result = await orgRequest<T>(path);
			if (owner.current !== life || !life.active || request !== life.read)
				return false;
			latest.current = result;
			setData(result);
			setDenied(false);
			const authority = configuration.current.refreshAuthority;
			if (authority && !(await authority())) {
				if (owner.current === life && life.active && request === life.read) {
					needsReload.current = true;
					setBlocked(true);
					setError(copy.refreshFailed);
				}
				return false;
			}
			if (owner.current !== life || !life.active || request !== life.read)
				return false;
			needsReload.current = false;
			setBlocked(false);
			return true;
		} catch (cause) {
			if (owner.current === life && life.active && request === life.read) {
				needsReload.current = true;
				setBlocked(true);
				failure(cause, true);
			}
			return false;
		} finally {
			if (owner.current === life && life.active && request === life.read)
				setLoading(false);
		}
	}, [path, failure, copy]);
	useEffect(() => {
		const life = owner.current;
		life.active = true;
		latest.current = null;
		needsReload.current = true;
		setData(null);
		setNotice("");
		void refresh();
		const revoke = () => {
			life.active = false;
			++life.read;
			latest.current = null;
			setData(null);
		};
		window.addEventListener(ACCOUNT_SESSION_CHANGED, revoke);
		return () => {
			life.active = false;
			++life.read;
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, revoke);
		};
	}, [refresh]);
	async function mutate(target: string, values: unknown, method = "POST") {
		const life = owner.current;
		const lock = configuration.current.lock;
		if (
			!life.active ||
			life.writing ||
			lock?.current ||
			loading ||
			needsReload.current
		)
			return null;
		life.writing = true;
		if (lock) lock.current = true;
		++life.read;
		setBusy(true);
		setError("");
		setFields([]);
		setNotice("");
		try {
			await orgRequest(target, values, method);
			if (owner.current !== life || !life.active) return null;
			// Acknowledged commands are never treated as failed commands or replayed.
			needsReload.current = true;
			setBlocked(true);
			setNotice(t.saved);
			const fresh = await refresh();
			if (owner.current !== life || !life.active) return null;
			return {
				acknowledged: true as const,
				data: fresh ? latest.current : null,
			};
		} catch (cause) {
			if (owner.current === life && life.active) {
				needsReload.current = true;
				setBlocked(true);
				failure(cause);
			}
			return null;
		} finally {
			life.writing = false;
			if (lock) lock.current = false;
			if (owner.current === life && life.active) setBusy(false);
		}
	}
	return {
		data,
		loading,
		busy,
		error,
		fields,
		notice,
		blocked,
		denied,
		refresh,
		mutate,
	};
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

			<Link href={`/${locale}/account/${context}/organizations`}>
				{t.select}
			</Link>
		</nav>
	);
}
