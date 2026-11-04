"use client";
import Link from "next/link";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { uuidPattern } from "../../../lib/routes/account-routes";
import type { Context } from "../../messaging/api";
import { localTimestamp } from "../../messaging/api";
import {
	accessLost,
	useCommunicationSession,
	useOnlineState,
} from "../../messaging/hooks";
import { SessionEntry } from "../../orders/components/session-entry";
import { action, control, panel } from "../../orders/components/controls";
import { useCommerceGuard } from "../../orders/components/unsaved";
import { ActionReview, type ReviewedAction } from "./action-review";
import { invoiceHref } from "../../orders/api";
import { paymentCopy, paymentState, paymentRole } from "../copy";
import {
	payment,
	paymentHref,
	paymentReference,
	pendingPayment,
	retainPayment,
	settlePayment,
	type Payment,
	type Detail,
	type Profile,
	type Selection,
	type Intent,
	type Outcome,
	type Receipt,
	type Claim,
	type SelectionPreview,
} from "../api";
import { FactsForm } from "./facts-form";
import { SelectionForm } from "./selection-form";
import { PaymentEvidence } from "./evidence";

export function PaymentWorkspace({
	locale,
	context,
	id,
}: {
	locale: Locale;
	context: Context;
	id?: string;
}) {
	const session = useCommunicationSession(context),
		q = useSearchParams(),
		t = paymentCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session)
		return (
			<SessionEntry locale={locale} context={context} error={session.error} />
		);
	const seller = context === "seller" ? (q.get("seller") ?? "") : "",
		page = Number(q.get("page") ?? 1),
		state = q.get("state") ?? "",
		attempt = q.get("payment_attempt");
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		(attempt && !uuidPattern.test(attempt)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000 ||
		!["", "unpaid", "partial", "paid", "overpaid", "overdue"].includes(state)
	)
		return <p role="alert">{t.error}</p>;
	const scope = `${session.session.identity.id}:${session.session.accounts[0].id}:${context}:${seller}:${id ?? "list"}`;
	return (
		<Workspace
			key={`${scope}:${locale}:${page}:${state}`}
			{...{ locale, context, id, seller, page, state, attempt, scope }}
		/>
	);
}
function Summary({ locale, row }: { locale: Locale; row: Payment }) {
	const t = paymentCopy[locale];
	return (
		<div className={panel}>
			<h2 className="text-xl font-bold">
				<bdi>{row.number}</bdi>
			</h2>
			<p>
				<bdi>{row.seller_name}</bdi>
			</p>
			<dl className="grid gap-4 sm:grid-cols-2 desktop:grid-cols-3">
				{(
					[
						[t.total, row.goods_total],
						[t.confirmed, row.confirmed_total],
						[t.remaining, row.remaining],
						[t.overpayment, row.overpayment],
					] as const
				).map(([label, value]) => (
					<div key={label}>
						<dt className="text-sm text-muted">{label}</dt>
						<dd className="font-bold break-all">
							<bdi>
								{value} {row.currency}
							</bdi>
						</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-wrap gap-3">
				<span className="rounded-control bg-info px-3 py-1">
					{paymentState(locale, row.financial)}
				</span>
				<span>
					{t.allocation}: {paymentState(locale, row.allocation)}
				</span>
				<span>
					{t.method}: {paymentState(locale, row.payment_method)}
				</span>
				{row.overdue && <strong className="text-warning">{t.overdue}</strong>}
			</div>
			<p>
				{t.originalDue}:{" "}
				<bdi>
					{row.original_due_at
						? localTimestamp(row.original_due_at, locale)
						: "—"}
				</bdi>
			</p>
			<p>
				{t.effectiveDue}:{" "}
				<bdi>
					{row.effective_due_at
						? localTimestamp(row.effective_due_at, locale)
						: "—"}
				</bdi>{" "}
				· v{row.deadline_generation}
			</p>
			<p className="text-sm text-muted">{t.noAutomatic}</p>
			<p className="text-sm text-muted">{t.inputTimezone}</p>
		</div>
	);
}
function Workspace({
	locale,
	context,
	id,
	seller,
	page,
	state,
	attempt,
	scope,
}: {
	locale: Locale;
	context: Context;
	id?: string;
	seller: string;
	page: number;
	state: string;
	attempt: string | null;
	scope: string;
}) {
	const t = paymentCopy[locale],
		router = useRouter();
	const online = useOnlineState();
	const [row, setRow] = useState<Detail | null>(null),
		[list, setList] = useState<{ count: number; results: Payment[] } | null>(
			null,
		),
		[profiles, setProfiles] = useState<Profile[]>([]),
		[selection, setSelection] = useState<Selection | null>(null),
		[selectionPage, setSelectionPage] = useState(1),
		[error, setError] = useState(false),
		[denied, setDenied] = useState(false),
		[busy, setBusy] = useState(false),
		[dirty, setDirty] = useState(false),
		[intent, setIntent] = useState<Intent | undefined>(() =>
			pendingPayment(scope),
		),
		[reference, setReference] = useState(attempt),
		[modal, setModal] = useState<ReviewedAction | null>(null),
		[evidence, setEvidence] = useState<string[]>([]),
		[correction, setCorrection] = useState<Receipt | undefined>(),
		[replacement, setReplacement] = useState<Claim | undefined>(),
		[reason, setReason] = useState(""),
		[due, setDue] = useState(""),
		[formKey, setFormKey] = useState(0),
		[notice, setNotice] = useState("");
	const live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		opener = useRef<HTMLElement | null>(null),
		initial = useRef(false),
		pendingFocus = useRef(false),
		workspace = useRef<HTMLElement>(null),
		title = useRef<HTMLHeadingElement>(null);
	useLayoutEffect(() => {
		live.current = {};
		return () => {
			live.current = null;
			owned.current = null;
		};
	}, []);
	useLayoutEffect(() => {
		if (busy || !pendingFocus.current) return;
		const previous = opener.current;
		const next =
			previous?.isConnected && !previous.matches(":disabled")
				? previous
				: (workspace.current?.querySelector<HTMLElement>(
						"[data-payment-reconcile]:not(:disabled),[data-payment-facts-review]:not(:disabled)",
					) ?? title.current);
		next?.focus();
		pendingFocus.current = false;
	}, [busy]);
	const guard = useCommerceGuard(locale, dirty || !!intent || !!reference),
		blocked = busy || !!intent || !!reference || denied;
	const fail = useCallback(
		(e: unknown, mine: object) => {
			if (live.current !== mine) return;
			if (accessLost(e)) {
				live.current = null;
				owned.current = null;
				setBusy(false);
				setDenied(true);
				setRow(null);
				setList(null);
				setSelection(null);
				setEvidence([]);
				settlePayment(scope);
				setIntent(undefined);
				setModal(null);
			}
			setError(true);
		},
		[scope],
	);
	async function load(signal?: AbortSignal) {
		const mine = live.current;
		if (!mine) return;
		try {
			if (context === "seller" && !initial.current) {
				const p = await payment<{ results: Profile[] }>(
					context,
					"profiles/",
					undefined,
					signal,
				);
				if (live.current !== mine || signal?.aborted) return;
				setProfiles(p.results);
				if (!seller) {
					if (p.results[0])
						router.replace(paymentHref(locale, context, id, p.results[0].id));
					else setList({ count: 0, results: [] });
					return;
				}
				if (!p.results.some((p) => p.id === seller)) throw Error("scope");
				initial.current = true;
			}
			const query = `?page=${page}${seller ? `&seller=${seller}` : ""}${state ? `&state=${state}` : ""}`;
			if (id) {
				const value = await payment<Detail>(
					context,
					`orders/${id}/${query}`,
					undefined,
					signal,
				);
				if (live.current === mine && !signal?.aborted) setRow(value);
			} else {
				const value = await payment<{ count: number; results: Payment[] }>(
					context,
					`orders/${query}`,
					undefined,
					signal,
				);
				if (live.current === mine && !signal?.aborted) setList(value);
			}
			if (live.current === mine && !signal?.aborted) setError(false);
		} catch (e) {
			if (!signal?.aborted) fail(e, mine);
			throw e;
		}
	}
	const loader = useRef(load);
	useLayoutEffect(() => {
		loader.current = load;
	});
	useEffect(() => {
		const c = new AbortController();
		void loader.current(c.signal).catch(() => {});
		return () => c.abort();
	}, []);
	const unsettled = !!(
		intent ||
		reference ||
		(row &&
			(row.allocation === "pending" ||
				row.allocation === "review_required" ||
				row.allocation === "shortage" ||
				row.cases.some((c) => c.state === "open") ||
				row.claims.some((c) => c.state === "pending") ||
				row.corrections.some((c) => c.state === "open")))
	);
	useEffect(() => {
		if (!unsettled || denied) return;
		let active = true,
			timer: ReturnType<typeof setTimeout> | undefined,
			controller: AbortController | null = null,
			running = false;
		const tick = async () => {
			if (!active || running) return;
			if (document.hidden || !navigator.onLine) {
				timer = setTimeout(() => void tick(), 15000);
				return;
			}
			running = true;
			controller = new AbortController();
			let delay = 15000;
			try {
				await loader.current(controller.signal);
			} catch {
				delay = 60000;
			} finally {
				running = false;
				if (active) timer = setTimeout(() => void tick(), delay);
			}
		};
		const visible = () => {
			if (!document.hidden && navigator.onLine && !running) {
				clearTimeout(timer);
				void tick();
			}
		};
		timer = setTimeout(() => void tick(), 15000);
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("online", visible);
		return () => {
			active = false;
			clearTimeout(timer);
			controller?.abort();
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("online", visible);
		};
	}, [unsettled, denied]);
	useEffect(() => {
		if (!id || !row?.capabilities.selection || row.selection?.allocation)
			return;
		const mine = live.current,
			c = new AbortController();
		void payment<Selection>(
			context,
			`orders/${id}/stock-selection/?page=${selectionPage}`,
			undefined,
			c.signal,
		)
			.then((v) => {
				if (live.current === mine && !c.signal.aborted) setSelection(v);
			})
			.catch((e) => {
				if (mine && !c.signal.aborted) fail(e, mine);
			});
		return () => c.abort();
	}, [
		id,
		row?.capabilities.selection,
		row?.selection?.allocation,
		selectionPage,
		context,
		fail,
	]);
	function review(
		path: string,
		body: Record<string, unknown>,
		label: string,
		preview?: SelectionPreview[],
	) {
		if (blocked || !row) return;
		opener.current = document.activeElement as HTMLElement;
		setModal({
			row: structuredClone(row),
			preview: preview ? structuredClone(preview) : undefined,
			label,
			packet: {
				key: crypto.randomUUID(),
				path,
				body: { ...body, version: row.version },
				upload: false,
			},
		});
	}
	function finished(
		outcome: Record<string, unknown>,
		current?: Detail,
		absent = false,
	) {
		settlePayment(scope);
		setIntent(undefined);
		setReference(null);
		paymentReference(null);
		if (current) setRow(current);
		if (absent) {
			setNotice(t.continue);
			return;
		}
		if (typeof outcome.evidence === "string" || typeof outcome.id === "string")
			setEvidence((e) =>
				[...new Set([...e, (outcome.evidence ?? outcome.id) as string])].slice(
					0,
					3,
				),
			);
		else {
			setEvidence([]);
			setCorrection(undefined);
			setReplacement(undefined);
			setDirty(false);
			setFormKey((v) => v + 1);
		}
		setNotice(outcome.duplicate_warning ? t.duplicate : "");
	}
	async function send(packet: Intent) {
		if (owned.current) return;
		const mine = live.current;
		if (!mine) return;
		const token = {};
		owned.current = token;
		pendingFocus.current = !!modal;
		const retained = retainPayment(scope, packet);
		setIntent(retained);
		setReference(retained.key);
		paymentReference(retained.key);
		setBusy(true);
		setError(false);
		setModal(null);
		try {
			const body =
				retained.body instanceof FormData
					? retained.body
					: { ...retained.body, command_id: retained.key };
			if (retained.upload) {
				const result = await payment<{ id: string }>(
					context,
					retained.path,
					body,
				);
				if (live.current === mine && owned.current === token)
					finished({ evidence: result.id });
			} else {
				const result = await payment<Outcome>(context, retained.path, body);
				if (live.current === mine && owned.current === token)
					finished(result.outcome, result.current);
			}
		} catch (e) {
			fail(e, mine);
		} finally {
			if (live.current === mine && owned.current === token) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function reconcile() {
		if (!id || owned.current) return;
		pendingFocus.current = true;
		opener.current = document.activeElement as HTMLElement;
		const key = intent?.key ?? reference,
			mine = live.current;
		if (!key || !mine) return;
		const token = {};
		owned.current = token;
		setBusy(true);
		try {
			const result = await payment<Outcome>(
				context,
				`orders/${id}/commands/${key}/reconcile/`,
				{},
			);
			if (live.current === mine && owned.current === token)
				finished(
					result.outcome,
					result.current,
					result.state === "absent_fenced",
				);
		} catch (e) {
			fail(e, mine);
		} finally {
			if (live.current === mine && owned.current === token) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	function upload(file: File) {
		if (!id || blocked) return;
		const key = crypto.randomUUID(),
			body = new FormData();
		body.append("command_id", key);
		body.append("file", file);
		void send({ key, path: `orders/${id}/uploads/`, body, upload: true });
	}
	if (denied) return <p role="alert">{t.noAccess}</p>;
	return (
		<section ref={workspace} className="space-y-5 min-w-0" aria-label={t.title}>
			<h1 ref={title} tabIndex={-1} className="text-2xl font-bold">
				{t.title}
			</h1>
			{!online && <p role="status">{t.offline}</p>}
			{context === "seller" && profiles.length > 0 && (
				<label className="block">
					{t.business}
					<select
						className={control}
						value={seller}
						disabled={busy}
						onChange={(e) => {
							const nextSeller = e.target.value;
							guard.choose(() =>
								router.push(
									paymentHref(locale, context, undefined, nextSeller),
								),
							);
						}}
					>
						{profiles.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</label>
			)}
			{error && (
				<p role="alert" className="text-warning">
					{t.error}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{(intent || reference) && (
				<div className={panel}>
					<p role="status">{t.unresolved}</p>
					<div className="flex flex-wrap gap-3">
						{intent && (
							<button
								type="button"
								className={action}
								disabled={busy}
								onClick={() => void send(intent)}
							>
								{t.retry}
							</button>
						)}
						<button
							type="button"
							className={action}
							disabled={busy}
							data-payment-reconcile
							onClick={() => void reconcile()}
						>
							{t.reconcile}
						</button>
					</div>
				</div>
			)}
			<button
				type="button"
				className={action}
				disabled={busy}
				onClick={() => void load().catch(() => {})}
			>
				{t.refresh}
			</button>
			{!id && (
				<>
					<label className="block">
						{t.all}
						<select
							className={control}
							value={state}
							onChange={(e) =>
								guard.choose(() =>
									router.push(
										paymentHref(
											locale,
											context,
											undefined,
											seller,
											1,
											e.target.value,
										),
									),
								)
							}
						>
							{["", "unpaid", "partial", "paid", "overpaid", "overdue"].map(
								(s) => (
									<option key={s} value={s}>
										{s ? paymentState(locale, s) : t.all}
									</option>
								),
							)}
						</select>
					</label>
					{!list ? (
						<p role="status">{t.loading}</p>
					) : !list.results.length ? (
						<p>{t.empty}</p>
					) : (
						list.results.map((r) => (
							<article key={r.id} className="space-y-3">
								<Summary locale={locale} row={r} />
								<Link
									className={action}
									href={paymentHref(locale, context, r.id, seller)}
								>
									{t.continue}
								</Link>
							</article>
						))
					)}
					<div className="flex flex-wrap gap-3">
						<button
							type="button"
							className={action}
							disabled={page <= 1}
							onClick={() =>
								guard.choose(() =>
									router.push(
										paymentHref(
											locale,
											context,
											undefined,
											seller,
											page - 1,
											state,
										),
									),
								)
							}
						>
							{t.previous}
						</button>
						<button
							type="button"
							className={action}
							disabled={!list || page * 20 >= list.count}
							onClick={() =>
								guard.choose(() =>
									router.push(
										paymentHref(
											locale,
											context,
											undefined,
											seller,
											page + 1,
											state,
										),
									),
								)
							}
						>
							{t.next}
						</button>
					</div>
				</>
			)}
			{id && !row && !error && <p role="status">{t.loading}</p>}
			{row && (
				<>
					<Summary locale={locale} row={row} />
					<Link
						className={action}
						href={invoiceHref(locale, context, row.invoice, seller)}
					>
						{t.invoice}
					</Link>
					<p className="text-sm text-muted">{t.claimNote}</p>
					{(row.capabilities.claim || row.capabilities.receipt) && (
						<FactsForm
							key={`${formKey}:${correction?.id ?? replacement?.id ?? "new"}`}
							{...{
								locale,
								row,
								disabled: blocked,
								evidence,
								onEvidence: upload,
								onReview: review,
								onDirty: () => setDirty(true),
							}}
							receipt={correction}
							prior={replacement}
							context={context}
							onRemove={(id) => {
								setEvidence((e) => e.filter((x) => x !== id));
								setDirty(true);
							}}
						/>
					)}
					{(correction || replacement) && (
						<button
							type="button"
							className={action}
							disabled={blocked}
							onClick={() =>
								guard.choose(() => {
									setCorrection(undefined);
									setReplacement(undefined);
									setEvidence([]);
									setDirty(false);
								})
							}
						>
							{t.cancel}
						</button>
					)}
					{row.capabilities.details && (
						<>
							<div className={panel}>
								<h3 className="font-bold">{t.claims}</h3>
								{row.claims.map((c) => (
									<article
										key={c.id}
										className="space-y-3 border-t border-border py-3"
									>
										<p>
											<bdi>
												{c.amount} {c.currency}
											</bdi>{" "}
											· {paymentState(locale, c.state)} · v{c.version} ·{" "}
											{paymentRole(locale, "buyer")}
										</p>
										<p>
											<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
										</p>
										<p className="whitespace-pre-wrap break-words">
											{c.description}
										</p>
										{c.reason && <p>{c.reason}</p>}
										<div className="flex flex-wrap gap-3">
											{row.capabilities.evidence &&
												c.evidence.map((e) => (
													<PaymentEvidence
														key={e}
														id={e}
														{...{ locale, context }}
													/>
												))}
										</div>
										{row.capabilities.claim &&
											["withdrawn", "rejected"].includes(c.state) &&
											!c.replacement && (
												<button
													type="button"
													className={action}
													disabled={blocked}
													onClick={() =>
														guard.choose(() => {
															setReplacement(c);
															setCorrection(undefined);
															setEvidence([]);
															setFormKey((v) => v + 1);
														})
													}
												>
													{t.replaceClaim}
												</button>
											)}
										{c.state === "pending" && (
											<div className="space-y-3">
												<label className="block">
													{t.reason}
													<textarea
														className={control}
														maxLength={1000}
														disabled={blocked}
														value={reason}
														onChange={(e) => {
															setReason(e.target.value);
															setDirty(true);
														}}
													/>
												</label>
												<div className="flex flex-wrap gap-3">
													{(row.capabilities.claim
														? ["withdraw"]
														: row.capabilities.receipt
															? ["confirm", "reject"]
															: []
													).map((a) => (
														<button
															type="button"
															key={a}
															className={action}
															disabled={blocked || reason.trim().length < 3}
															onClick={() =>
																review(
																	`claims/${c.id}/${a}/`,
																	{
																		claim_version: c.version,
																		reason: reason.trim(),
																	},
																	a === "confirm"
																		? t.confirmClaim
																		: a === "reject"
																			? t.rejectClaim
																			: t.withdrawClaim,
																)
															}
														>
															{a === "confirm"
																? t.confirmClaim
																: a === "reject"
																	? t.rejectClaim
																	: t.withdrawClaim}
														</button>
													))}
												</div>
											</div>
										)}
									</article>
								))}
							</div>
							<div className={panel}>
								<h3 className="font-bold">{t.receipts}</h3>
								{row.receipts.map((r) => (
									<article
										key={r.id}
										className="space-y-3 border-t border-border py-3"
									>
										<p>
											{t.originalAmount}:{" "}
											<bdi>
												{r.original_amount} {r.currency}
											</bdi>{" "}
											· {t.effectiveAmount}:{" "}
											<bdi>
												{r.amount} {r.currency}
											</bdi>{" "}
											· v{r.version}
										</p>
										<p>
											{t.review}: {paymentState(locale, r.review)} ·{" "}
											{paymentRole(locale, "seller")}
										</p>
										<p>
											<bdi>{localTimestamp(r.paid_at, locale)}</bdi>
										</p>
										<p className="whitespace-pre-wrap break-words">
											{r.description}
										</p>
										<div className="flex flex-wrap gap-3">
											{row.capabilities.evidence &&
												r.evidence.map((e) => (
													<PaymentEvidence
														key={e}
														id={e}
														{...{ locale, context }}
													/>
												))}
										</div>
										{row.capabilities.correction && (
											<button
												type="button"
												className={action}
												disabled={
													blocked ||
													row.corrections.some(
														(c) => c.receipt === r.id && c.state === "open",
													)
												}
												onClick={() =>
													guard.choose(() => {
														setCorrection(r);
														setReplacement(undefined);
														setEvidence([]);
													})
												}
											>
												{t.correction}
											</button>
										)}
									</article>
								))}
							</div>
							<div className={panel}>
								<h3 className="font-bold">{t.corrections}</h3>
								<p>{t.correctionNote}</p>
								{row.corrections.map((c) => (
									<article key={c.id}>
										<p>
											<bdi>
												{c.amount} {row.currency}
											</bdi>{" "}
											· {paymentState(locale, c.state)} · v{c.target_version}
										</p>
										<p>{c.reason}</p>
										<p>{c.description}</p>
										<p>
											<bdi>{localTimestamp(c.paid_at, locale)}</bdi>
										</p>
										{row.capabilities.evidence &&
											c.evidence.map((e) => (
												<PaymentEvidence
													key={e}
													id={e}
													{...{ locale, context }}
												/>
											))}
									</article>
								))}
							</div>
							{row.capabilities.selection &&
								selection &&
								!row.selection?.allocation && (
									<SelectionForm
										{...{
											locale,
											row,
											selection,
											disabled: blocked,
											onReview: review,
											onPage: setSelectionPage,
											onDirty: () => setDirty(true),
										}}
									/>
								)}
							<div className={panel}>
								<h3 className="font-bold">{t.plans}</h3>
								{row.plans.map((p) => (
									<article key={p.id}>
										<p>
											{paymentState(locale, p.state)} · {p.reason}
										</p>
										{p.lines.map((l, i) => (
											<p key={`${l.variant}:${l.batch ?? i}`}>
												<bdi>{l.sku}</bdi> · {t.batch}:{" "}
												<bdi>{l.batch_code || "—"}</bdi> · {t.quantity}:{" "}
												<bdi>
													{l.quantity} {l.unit_labels[locale] ?? l.unit}
												</bdi>
											</p>
										))}
									</article>
								))}
							</div>
							{row.capabilities.extension && (
								<form
									className={panel}
									onSubmit={(e) => {
										e.preventDefault();
										const parsed = Date.parse(due);
										if (
											!Number.isFinite(parsed) ||
											parsed <= Date.parse(row.effective_due_at ?? "") ||
											reason.trim().length < 3
										) {
											setError(true);
											return;
										}
										review(
											`orders/${id}/extensions/`,
											{
												deadline_generation: row.deadline_generation,
												due_at: new Date(parsed).toISOString(),
												reason: reason.trim(),
											},
											t.extend,
										);
									}}
								>
									<h3 className="font-bold">{t.extend}</h3>
									<fieldset disabled={blocked} className="space-y-3">
										<label className="block">
											{t.laterDue}
											<input
												type="datetime-local"
												required
												className={control}
												value={due}
												onChange={(e) => {
													setDue(e.target.value);
													setDirty(true);
												}}
											/>
										</label>
										<label className="block">
											{t.reason}
											<textarea
												required
												minLength={3}
												maxLength={1000}
												className={control}
												value={reason}
												onChange={(e) => {
													setReason(e.target.value);
													setDirty(true);
												}}
											/>
										</label>
										<button type="submit" className={action}>
											{t.exact}
										</button>
									</fieldset>
								</form>
							)}
							<div className={panel}>
								<h3 className="font-bold">{t.deadlines}</h3>
								{row.extensions.map((e) => (
									<p key={e.id}>
										<bdi>
											{localTimestamp(e.before_at, locale)} →{" "}
											{localTimestamp(e.due_at, locale)}
										</bdi>{" "}
										· {e.reason}
									</p>
								))}
							</div>
							<div className={panel}>
								<h3 className="font-bold">{t.cases}</h3>
								{row.cases.map((c) => (
									<p key={c.id}>
										{paymentState(locale, c.kind)} ·{" "}
										{paymentState(locale, c.state)}
									</p>
								))}
							</div>
							<div className={panel}>
								<h3 className="font-bold">{t.history}</h3>
								{row.history.map((e) => (
									<p key={e.id}>
										v{e.version} ·{" "}
										{paymentState(locale, e.action.replace(/^case_/, ""))} ·{" "}
										<bdi>
											{localTimestamp(e.created_at, locale)} ·{" "}
											{paymentRole(locale, e.context)}
										</bdi>
									</p>
								))}
								<div className="flex flex-wrap gap-3">
									<button
										type="button"
										className={action}
										disabled={page <= 1 || blocked}
										onClick={() =>
											guard.choose(() =>
												router.push(
													paymentHref(locale, context, id, seller, page - 1),
												),
											)
										}
									>
										{t.previous}
									</button>
									<button
										type="button"
										className={action}
										disabled={
											blocked ||
											(page * 50 >= row.history_count &&
												row.claims.length < 20 &&
												row.receipts.length < 20 &&
												row.corrections.length < 20 &&
												row.plans.length < 20 &&
												row.cases.length < 20 &&
												row.extensions.length < 20)
										}
										onClick={() =>
											guard.choose(() =>
												router.push(
													paymentHref(locale, context, id, seller, page + 1),
												),
											)
										}
									>
										{t.next}
									</button>
								</div>
							</div>
						</>
					)}
				</>
			)}
			{modal && (
				<ActionReview
					{...{ locale, context, selection, busy }}
					review={modal}
					opener={opener.current}
					cancel={() => setModal(null)}
					confirm={() => void send(modal.packet)}
				/>
			)}
			{guard.feedback}
		</section>
	);
}
