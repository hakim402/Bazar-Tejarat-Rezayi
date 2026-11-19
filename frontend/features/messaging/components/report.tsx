"use client";
import Link from "next/link";
import toast from "react-hot-toast";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { Icon, type IconName } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Button } from "../../../components/shadcn/button";
import { Textarea } from "../../../components/shadcn/textarea";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
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
import { actionBtn, Failure, failureMessage } from "./ui";
import { PAGE_SIZE, Pager } from "../../../components/pager";

// All target types use the existing deliberate report seal and identical replay.
export function ReportForm({
	context,
	id,
	locale,
	target = "message",
	onDirty,
	onDenied,
	embedded = false,
	compact = false,
}: {
	context: Context;
	id: string;
	locale: Locale;
	target?: ReportTarget;
	onDirty?: (dirty: boolean) => void;
	onDenied?: (error: unknown) => void;
	embedded?: boolean;
	compact?: boolean;
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
				toast.success(t.reportSaved);
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
					toast.error(failureMessage(locale, error));
				} else {
					setUncertain(true);
					toast.error(failureMessage(locale, error));
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
		<div className={compact ? "flex flex-col gap-3 pt-1" : "space-y-3 pt-3"}>
			<p className={compact ? "m-0 text-sm text-muted" : undefined}>
				{t.reportNeutral}
			</p>
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
					className={compact ? "flex flex-col gap-4" : "space-y-3"}
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor={`${id}-report-category`}
							className="text-sm font-medium"
						>
							{t.category}
						</label>
						<NativeSelect
							id={`${id}-report-category`}
							value={category}
							disabled={busy || uncertain}
							onChange={(event) => {
								setCategory(event.target.value);
								setDirty(true);
							}}
						>
							{(["abuse", "fraud", "spam", "privacy", "other"] as const).map(
								(value) => (
									<NativeSelectOption key={value} value={value}>
										{value === "privacy" ? t.privacyCategory : t[value]}
									</NativeSelectOption>
								),
							)}
						</NativeSelect>
					</div>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor={`${id}-report-reason`}
							className="text-sm font-medium"
						>
							{t.reason}
						</label>
						<Textarea
							id={`${id}-report-reason`}
							dir="auto"
							required
							minLength={3}
							maxLength={1000}
							value={reason}
							disabled={busy || uncertain}
							onChange={(event) => {
								setReason(event.target.value);
								setDirty(true);
							}}
						/>
					</div>
					<Button
						type="submit"
						className="self-start rounded-lg"
						disabled={busy || !online}
					>
						{busy ? t.sending : uncertain ? t.retry : t.submitReport}
					</Button>
				</form>
			)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="self-start rounded-lg"
				disabled={busy || !online || uncertain}
				onClick={() => void load()}
			>
				{t.retry}
			</Button>
			{!!error && <Failure locale={locale} error={error} />}
		</div>
	);
	if (embedded)
		return (
			<>
				{guard.feedback}
				<div
					className={
						compact ? "flex flex-col gap-3 text-sm" : "space-y-3 text-sm"
					}
				>
					{body}
				</div>
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
				<summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-muted transition-colors hover:text-action">
					<Icon name="shield" className="size-4" />
					{label}
				</summary>
				{body}
			</details>
		</>
	);
}

function reportTargetIcon(kind: string): IconName {
	switch (kind) {
		case "product":
			return "box";
		case "store":
			return "store";
		case "order":
			return "receipt";
		default:
			return "mail";
	}
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
			className="rounded-card border border-solid border-border bg-surface p-4"
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
				<Icon name="shield" className="size-4 shrink-0 text-muted" />
				<span className="min-w-0 flex-1">{t.ownReports}</span>
				<Icon
					name="chevron-down"
					className={`size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
				/>
			</summary>
			{open && (
				<div className="flex flex-col gap-3 pt-3">
					<p className="m-0 text-xs leading-relaxed text-muted">
						{t.reportNeutral}
					</p>
					{!online && (
						<p role="status" className="m-0 text-sm text-muted">
							{t.offline}
						</p>
					)}
					{!!error && <Failure locale={locale} error={error} />}
					{busy && (
						<p role="status" className="m-0 text-sm text-muted">
							{t.loading}
						</p>
					)}
					{data && !denied && (
						<>
							{!data.results.length ? (
								<p className="m-0 text-sm text-muted">{t.emptyReports}</p>
							) : (
								<ul className="m-0 flex list-none flex-col p-0">
									{data.results.map((row) => (
										<li
											key={row.id}
											className="flex items-center gap-3 border-0 border-b border-solid border-border py-3 last:border-b-0"
										>
											<span
												className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted"
												aria-hidden="true"
											>
												<Icon
													name={reportTargetIcon(row.target_kind)}
													className="size-4"
												/>
											</span>
											<div className="min-w-0 flex-1">
												<Link
													prefetch={false}
													href={reportTargetHref(
														locale,
														context,
														row.target_kind,
														row.target,
													)}
													className="text-sm font-medium text-foreground no-underline hover:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
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
												{row.created_at && (
													<p className="m-0 mt-0.5 text-xs text-muted">
														<bdi>{localTimestamp(row.created_at, locale)}</bdi>{" "}
														· {t.timezone}
													</p>
												)}
											</div>
											<StatusBadge
												variant={row.status === "open" ? "warning" : "success"}
												dot={false}
												size="sm"
											>
												{row.status === "open" ? t.open : t.resolved}
											</StatusBadge>
										</li>
									))}
								</ul>
							)}
							{context === "seller" ? (
								<Pager
									locale={locale}
									page={page}
									count={data.count}
									pageSize={PAGE_SIZE}
									busy={busy || !online}
									onPage={(next) => {
										if (next === page) return;
										setData(null);
										setPage(next);
									}}
									labels={{ prev: t.previous, next: t.next, page: t.page }}
									className="flex flex-wrap items-center gap-3"
								/>
							) : (
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="rounded-lg"
										disabled={busy || !online || page <= 1}
										onClick={() => {
											setData(null);
											setPage((value) => value - 1);
										}}
									>
										{t.previous}
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="rounded-lg"
										disabled={busy || !online || page * 20 >= data.count}
										onClick={() => {
											setData(null);
											setPage((value) => value + 1);
										}}
									>
										{t.next}
									</Button>
								</div>
							)}
						</>
					)}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="self-start rounded-lg"
						disabled={busy || !online || denied}
						onClick={() => setReload((value) => value + 1)}
					>
						{t.retry}
					</Button>
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
