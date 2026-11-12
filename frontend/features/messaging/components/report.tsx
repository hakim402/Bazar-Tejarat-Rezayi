"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { Icon } from "../../../components/ui/icon";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { uuidPattern } from "../../../lib/routes/account-routes";
import {
	messaging,
	localTimestamp,
	reportPacket,
	reportPath,
	reportTargetHref,
	type OwnReportPage,
	type Context,
	type ReportResult,
	type ReportTarget,
} from "../api";
import { communicationCopy } from "../copy";
import { accessLost, useCommunicationSession, useOnlineState } from "../hooks";
import { control, action, Failure } from "./controls";
import { messageAction, messageControl } from "./seller-messages-ui";

// All target types use the existing deliberate report seal and identical replay.
export function ReportForm({
	context,
	id,
	locale,
	target = "message",
	onDirty,
	onDenied,
	embedded = false,
}: {
	context: Context;
	id: string;
	locale: Locale;
	target?: ReportTarget;
	onDirty?: (dirty: boolean) => void;
	onDenied?: (error: unknown) => void;
	embedded?: boolean;
}) {
	const t = communicationCopy[locale],
		online = useOnlineState();
	const [reason, setReason] = useState(""),
		[category, setCategory] = useState("other"),
		[error, setError] = useState<unknown>(null),
		[results, setResults] = useState<ReportResult[] | null>(null),
		[busy, setBusy] = useState(false),
		[denied, setDenied] = useState(false),
		[uncertain, setUncertain] = useState(false);
	const pending = useRef<ReturnType<typeof reportPacket>>(null),
		owner = useRef<object | null>(null),
		live = useRef(true),
		controller = useRef<AbortController | null>(null);
	const [dirty, setDirty] = useState(false);
	const dirtyCallback = useRef(onDirty);
	dirtyCallback.current = onDirty;
	const guard = useCommerceGuard(
		locale,
		!onDirty && (dirty || busy || uncertain),
	);
	useEffect(() => {
		onDirty?.(dirty || busy || uncertain);
	}, [onDirty, dirty, busy, uncertain]);
	const path = reportPath(target, id);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
			owner.current = null;
			controller.current?.abort();
			pending.current = null;
			dirtyCallback.current?.(false);
		};
	}, []);
	async function load() {
		if (!online || controller.current || denied || !uuidPattern.test(id))
			return;
		const request = new AbortController(),
			mine = {};
		controller.current = request;
		owner.current = mine;
		setBusy(true);
		setError(null);
		try {
			const value = await messaging<{ results: ReportResult[] }>(
				context,
				path,
				undefined,
				{ signal: request.signal },
			);
			if (live.current && owner.current === mine && !request.signal.aborted)
				setResults(value.results);
		} catch (error) {
			if (live.current && owner.current === mine && !request.signal.aborted) {
				setError(error);
				if (accessLost(error)) {
					setDenied(true);
					setResults(null);
					pending.current = null;
					setReason("");
					setDirty(false);
					onDenied?.(error);
				}
			}
		} finally {
			if (live.current && owner.current === mine) {
				controller.current = null;
				owner.current = null;
				setBusy(false);
			}
		}
	}
	async function submit() {
		if (!online || controller.current || denied || !uuidPattern.test(id))
			return;
		const packet =
			pending.current ?? reportPacket(category, reason, crypto.randomUUID());
		if (!packet) {
			setError(new AccountError(400));
			return;
		}
		const replay = pending.current !== null,
			request = new AbortController(),
			mine = {};
		pending.current = packet;
		controller.current = request;
		owner.current = mine;
		setBusy(true);
		setError(null);
		try {
			const value = await messaging<ReportResult>(context, path, packet, {
				signal: request.signal,
			});
			if (live.current && owner.current === mine && !request.signal.aborted) {
				setResults([value]);
				pending.current = null;
				setUncertain(false);
				setReason("");
				setDirty(false);
			}
		} catch (error) {
			if (live.current && owner.current === mine && !request.signal.aborted) {
				setError(error);
				if (accessLost(error)) {
					setDenied(true);
					setResults(null);
					pending.current = null;
					setReason("");
					setUncertain(false);
					setDirty(false);
					onDenied?.(error);
				} else if (
					!replay &&
					error instanceof AccountError &&
					[400, 409, 429].includes(error.status ?? 0)
				) {
					pending.current = null;
					setUncertain(false);
				} else setUncertain(true);
			}
		} finally {
			if (live.current && owner.current === mine) {
				controller.current = null;
				owner.current = null;
				setBusy(false);
			}
		}
	}
	const label = {
		message: t.report,
		product: t.reportProduct,
		store: t.reportStore,
		order: t.reportOrder,
	}[target];
	// biome-ignore lint/correctness/useExhaustiveDependencies: an embedded report loads once when its tab mounts; later reloads use the retry button.
	useEffect(() => {
		if (embedded) void load();
	}, []);
	const body = denied ? (
		<Failure locale={locale} error={error} />
	) : (
		<div className="space-y-3 pt-3">
			<p>{t.reportNeutral}</p>
			{!online && <p role="status">{t.offline}</p>}
			{results?.map((result) => (
				<p key={result.id} role="status">
					{t.reportSaved} · {result.status === "open" ? t.open : t.resolved} ·{" "}
					<bdi>{result.id}</bdi> ·{" "}
					<bdi>
						v{result.version}
						{result.created_at
							? ` · ${new Intl.DateTimeFormat(locale, { timeZone: "Asia/Kabul", dateStyle: "medium", timeStyle: "short" }).format(new Date(result.created_at))}`
							: ""}
					</bdi>
				</p>
			))}
			{uncertain && <p role="status">{t.reportUncertain}</p>}
			{(!results?.length || dirty || uncertain) && (
				<form
					aria-label={label}
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<label className="block space-y-2">
						{t.category}
						<select
							className={context === "seller" ? messageControl : control}
							value={category}
							disabled={busy || uncertain}
							onChange={(event) => {
								setCategory(event.target.value);
								setDirty(true);
							}}
						>
							{(["abuse", "fraud", "spam", "privacy", "other"] as const).map(
								(value) => (
									<option key={value} value={value}>
										{value === "privacy" ? t.privacyCategory : t[value]}
									</option>
								),
							)}
						</select>
					</label>
					<label className="block space-y-2">
						{t.reason}
						<textarea
							dir="auto"
							required
							minLength={3}
							maxLength={1000}
							className={context === "seller" ? messageControl : control}
							value={reason}
							disabled={busy || uncertain}
							onChange={(event) => {
								setReason(event.target.value);
								setDirty(true);
							}}
						/>
					</label>
					<button
						className={context === "seller" ? messageAction : action}
						disabled={busy || !online}
						type="submit"
					>
						{busy ? t.sending : uncertain ? t.retry : t.submitReport}
					</button>
				</form>
			)}
			<button
				className={context === "seller" ? messageAction : action}
				type="button"
				disabled={busy || !online || uncertain}
				onClick={() => void load()}
			>
				{t.retry}
			</button>
			{!!error && <Failure locale={locale} error={error} />}
		</div>
	);
	if (embedded)
		return (
			<>
				{guard.feedback}
				<div className="space-y-3 text-sm">{body}</div>
			</>
		);
	return (
		<>
			{guard.feedback}
			<details
				className="border-t border-border py-3 text-sm"
				onToggle={(event) => {
					if (event.currentTarget.open && !uncertain) void load();
				}}
			>
				<summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-action">
					<Icon name="shield" className="size-4" />
					{label}
				</summary>
				{body}
			</details>
		</>
	);
}

export function OwnReports({
	locale,
	context,
}: {
	locale: Locale;
	context: Context;
}) {
	const t = communicationCopy[locale],
		online = useOnlineState();
	const [open, setOpen] = useState(false),
		[page, setPage] = useState(1),
		[reload, setReload] = useState(0),
		[data, setData] = useState<OwnReportPage | null>(null),
		[error, setError] = useState<unknown>(null),
		[busy, setBusy] = useState(false),
		[denied, setDenied] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload deliberately retries an unchanged page.
	useEffect(() => {
		if (!open || !online || denied) return;
		const request = new AbortController();
		setBusy(true);
		void messaging<OwnReportPage>(context, `reports/?page=${page}`, undefined, {
			signal: request.signal,
		})
			.then((value) => {
				if (!request.signal.aborted) {
					setData(value);
					setError(null);
				}
			})
			.catch((error) => {
				if (!request.signal.aborted) {
					setError(error);
					if (accessLost(error)) {
						setData(null);
						setDenied(true);
					}
				}
			})
			.finally(() => {
				if (!request.signal.aborted) setBusy(false);
			});
		return () => request.abort();
	}, [open, online, denied, context, page, reload]);
	return (
		<details
			className="space-y-3 rounded-card border border-border bg-surface p-4"
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="min-h-11 cursor-pointer font-bold">
				{t.ownReports}
			</summary>
			{open && (
				<div className="space-y-3">
					<p>{t.reportNeutral}</p>
					{!online && <p role="status">{t.offline}</p>}
					{!!error && <Failure locale={locale} error={error} />}
					{busy && <p role="status">{t.loading}</p>}
					{data && !denied && (
						<>
							{!data.results.length && <p>{t.emptyReports}</p>}
							{data.results.map((row) => (
								<article
									key={row.id}
									className="space-y-2 border-b border-border py-3"
								>
									<Link
										prefetch={false}
										className={action}
										href={reportTargetHref(
											locale,
											context,
											row.target_kind,
											row.target,
										)}
									>
										{
											{
												message: t.report,
												product: t.reportProduct,
												store: t.reportStore,
												order: t.reportOrder,
											}[row.target_kind]
										}
									</Link>
									<p>
										{row.status === "open" ? t.open : t.resolved} ·{" "}
										<bdi>
											{row.id} · v{row.version}
										</bdi>
									</p>
									{row.created_at && (
										<p>
											<bdi>{localTimestamp(row.created_at, locale)}</bdi> ·{" "}
											{t.timezone}
										</p>
									)}
								</article>
							))}
							<div className="flex flex-wrap gap-3">
								<button
									type="button"
									className={action}
									disabled={busy || !online || page <= 1}
									onClick={() => {
										setData(null);
										setPage((value) => value - 1);
									}}
								>
									{t.previous}
								</button>
								<button
									type="button"
									className={action}
									disabled={busy || !online || page * 20 >= data.count}
									onClick={() => {
										setData(null);
										setPage((value) => value + 1);
									}}
								>
									{t.next}
								</button>
							</div>
						</>
					)}
					<button
						type="button"
						className={action}
						disabled={busy || !online || denied}
						onClick={() => setReload((value) => value + 1)}
					>
						{t.retry}
					</button>
				</div>
			)}
		</details>
	);
}

export function TargetReport({
	locale,
	id,
	target,
}: {
	locale: Locale;
	id: string;
	target: "product" | "store";
}) {
	const session = useCommunicationSession("buyer");
	if (!session.session?.accounts.some((account) => account.context === "buyer"))
		return null;
	return (
		<ReportForm
			key={`${session.session.identity.id}:${id}:${target}:${locale}`}
			locale={locale}
			context="buyer"
			id={id}
			target={target}
		/>
	);
}
