"use client";
import {
	AlertTriangle,
	ArrowLeft,
	FileText,
	Package,
	PackagePlus,
	RefreshCw,
	Settings2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
	useCallback,
	useState,
	useEffect,
	useLayoutEffect,
	useRef,
	type ReactNode,
} from "react";
import toast from "react-hot-toast";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import { Button } from "../../../../../../../components/shadcn/button";
import { Input } from "../../../../../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../../../../../components/shadcn/native-select";
import { Textarea } from "../../../../../../../components/shadcn/textarea";
import { CheckField } from "../../../../../../../components/ui/form-field";
import { Alert } from "../../../../../../../components/ui/alert";
import { StickyActionBar } from "../../../../../../../components/ui/sticky-action-bar";
import { useUnsavedNavigation } from "../../../../../../../components/layout/navigation-guard";
import { AccountError } from "../../../../../../../lib/api/private-client";
import {
	inventoryRequest,
	type StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { StockModal, panel } from "./stock-parts";
import { stockHref } from "./stock-ui";

type InventoryFormProps = {
	locale: Locale;
	seller: string;
	position: StockPosition;
	mode: "settings" | "receipt" | "adjustment";
	reload: () => Promise<StockPosition>;
	revoked: () => void;
};
type StockPayload = Readonly<{
	token: string;
	version: number;
	reason: string;
	tracking?: string;
	expiry_required?: boolean;
	threshold?: string | null;
	reference?: string;
	quantity?: string;
	batch?: string;
	batch_code?: string;
	expires_on?: string | null;
}>;
type StockAttempt = Readonly<{
	path: string;
	data: StockPayload;
	before: string;
	after: string;
	batchCode: string;
	batchExpiry: string | null;
	unit: string;
	increment: string;
	sku: string;
	title: string;
}>;
const maximum = BigInt("999999999999");

// Integer thousandths prevent preview rounding; the backend validates the final balance.
function thousandths(value: string): bigint | null {
	if (!/^-?\d{1,9}(?:\.\d{1,3})?$/.test(value)) return null;
	const [whole, fraction = ""] = value.replace("-", "").split(".");
	const amount = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
	return value.startsWith("-") ? -amount : amount;
}
function exactQuantity(value: bigint) {
	const absolute = value < BigInt(0) ? -value : value;
	return `${value < BigInt(0) ? "-" : ""}${absolute / BigInt(1000)}.${String(absolute % BigInt(1000)).padStart(3, "0")}`;
}
function kabulToday() {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Kabul",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	return ["year", "month", "day"]
		.map((type) => parts.find((part) => part.type === type)?.value)
		.join("-");
}
function canReceive(batch: NonNullable<StockPosition["batches"]>[number]) {
	return (
		!batch.expired && (!batch.expires_on || batch.expires_on >= kabulToday())
	);
}
function FormField({
	id,
	label,
	required = false,
	optional,
	children,
}: {
	id: string;
	label: ReactNode;
	required?: boolean;
	optional?: string;
	children: ReactNode;
}) {
	return (
		<div className="min-w-0 space-y-1.5">
			<label
				htmlFor={id}
				className="flex items-center justify-between gap-2 text-sm font-medium text-foreground"
			>
				<span>
					{label}
					{required && (
						<span aria-hidden="true" className="ms-1 text-danger">
							*
						</span>
					)}
				</span>
				{optional && (
					<span className="text-caption font-normal text-muted">{optional}</span>
				)}
			</label>
			{children}
		</div>
	);
}
export function InventoryForm(props: InventoryFormProps) {
	// A different scope/resource must never inherit a draft or a pending packet.
	return (
		<StockForm
			key={`${props.locale}:${props.seller}:${props.position.id}:${props.mode}`}
			{...props}
		/>
	);
}
function StockForm({
	locale,
	seller,
	position,
	mode,
	reload,
	revoked,
}: InventoryFormProps) {
	const t = inventoryCopy[locale],
		copy = sellerInventoryCopy[locale],
		returnParams = useSearchParams();
	const [snapshot, setSnapshot] = useState(position),
		[tracking, setTracking] = useState(position.tracking ?? "plain"),
		[required, setRequired] = useState(position.expiry_required),
		[threshold, setThreshold] = useState(position.threshold ?? ""),
		[quantity, setQuantity] = useState(""),
		[reason, setReason] = useState(""),
		[reference, setReference] = useState(""),
		[batch, setBatch] = useState(() => {
			const values = returnParams.getAll("selected_batch");
			const selected =
				values.length === 1
					? position.batches?.find((item) => item.id === values[0])
					: undefined;
			return position.tracking === "batch" &&
				selected &&
				(mode !== "receipt" || canReceive(selected))
				? selected.id
				: "";
		}),
		[code, setCode] = useState(""),
		[expiry, setExpiry] = useState(""),
		[dirty, setDirty] = useState(false),
		[busy, setBusy] = useState(false),
		[review, setReview] = useState<StockAttempt | null>(null),
		[pending, setPending] = useState<StockAttempt | null>(null),
		[uncertain, setUncertain] = useState(false),
		[error, setError] = useState(""),
		[stale, setStale] = useState(false),
		[leave, setLeave] = useState<(() => void) | null>(null),
		[saved, setSaved] = useState(false),
		[refreshFailed, setRefreshFailed] = useState(false),
		[scopeRevoked, setScopeRevoked] = useState(false);
	const form = useRef<HTMLFormElement>(null),
		errorFocus = useRef<HTMLParagraphElement>(null),
		busyRef = useRef(false),
		active = useRef(false),
		generation = useRef(0),
		pendingRef = useRef<StockAttempt | null>(null),
		uncertainRef = useRef(false),
		savedRef = useRef(false),
		revokedRef = useRef(false);
	useLayoutEffect(() => {
		active.current = true;
		generation.current += 1;
		return () => {
			active.current = false;
			generation.current += 1;
		};
	}, []);
	useEffect(() => {
		if (error || refreshFailed) errorFocus.current?.focus();
	}, [error, refreshFailed]);
	const guard = useCallback((action: () => void) => {
		if (savedRef.current) action();
		else setLeave(() => action);
	}, []);
	useUnsavedNavigation(dirty || pending !== null, guard);
	const locked = !!snapshot.movements?.length,
		policyTracking = locked ? (snapshot.tracking ?? "plain") : tracking,
		policyRequired = locked ? snapshot.expiry_required : required,
		unit = snapshot.unit_labels[locale] ?? snapshot.unit,
		selected = snapshot.batches?.find((item) => item.id === batch),
		before =
			snapshot.tracking === "batch"
				? (selected?.physical ??
					(mode === "receipt" && !batch ? "0.000" : t.unknown))
				: snapshot.physical,
		formId = `inventory-${position.id}-${mode}`,
		backHref = stockHref(
			locale,
			`inventory/${position.id}`,
			seller,
			returnParams,
		),
		controlsLocked =
			busy ||
			pending !== null ||
			review !== null ||
			stale ||
			!snapshot.capabilities.write;

	function current(ticket: number) {
		return (
			active.current && generation.current === ticket && !revokedRef.current
		);
	}
	function beginWork() {
		if (!active.current || busyRef.current || revokedRef.current) return null;
		busyRef.current = true;
		const ticket = ++generation.current;
		setBusy(true);
		setError("");
		return ticket;
	}
	function finishWork(ticket: number) {
		if (!current(ticket)) return;
		busyRef.current = false;
		setBusy(false);
	}
	function revokeScope(ticket: number) {
		if (!current(ticket)) return;
		revokedRef.current = true;
		generation.current += 1;
		pendingRef.current = null;
		setPending(null);
		setReview(null);
		setLeave(null);
		setDirty(false);
		setBusy(false);
		setScopeRevoked(true);
		revoked();
	}
	function denied(cause: unknown) {
		return (
			cause instanceof AccountError &&
			[401, 403, 404].includes(cause.status ?? 0)
		);
	}
	async function readStock(ticket: number, afterSave: boolean) {
		try {
			const latest = await reload();
			if (!current(ticket)) return;
			if (latest.id !== position.id || !latest.capabilities.write) {
				revokeScope(ticket);
				return;
			}
			setSnapshot(latest);
			if (!afterSave) {
				if (latest.movements?.length) {
					setTracking(latest.tracking ?? "plain");
					setRequired(latest.expiry_required);
				}
				setBatch((value) => {
					const choice = latest.batches?.find((item) => item.id === value);
					return latest.tracking === "batch" &&
						choice &&
						(mode !== "receipt" || canReceive(choice))
						? value
						: "";
				});
				setReview(null);
				setStale(false);
			}
			setRefreshFailed(false);
			setError("");
		} catch (cause) {
			if (!current(ticket)) return;
			if (denied(cause)) {
				revokeScope(ticket);
				return;
			}
			// A failed GET says nothing about an already acknowledged POST.
			if (afterSave) setRefreshFailed(true);
			else setError(t.unavailable);
		}
	}
	async function reloadStock() {
		if (pendingRef.current || review) return;
		const ticket = beginWork();
		if (ticket === null) return;
		try {
			await readStock(ticket, savedRef.current);
		} finally {
			finishWork(ticket);
		}
	}
	function reviewChange() {
		if (
			busyRef.current ||
			pendingRef.current ||
			savedRef.current ||
			stale ||
			review ||
			!snapshot.capabilities.write
		)
			return;
		const element = form.current;
		if (!element) return;
		const invalid = (name: string, message: string) => {
			const control = element.elements.namedItem(name);
			if (
				control instanceof HTMLInputElement ||
				control instanceof HTMLTextAreaElement ||
				control instanceof HTMLSelectElement
			)
				control.setCustomValidity(message);
		};
		if (!reason.trim()) invalid("reason", t.reason);
		const increment = thousandths(snapshot.increment);
		if (mode === "settings") {
			const amount = threshold === "" ? null : thousandths(threshold);
			if (
				threshold !== "" &&
				(amount === null ||
					amount < BigInt(0) ||
					amount > maximum ||
					increment === null ||
					increment <= BigInt(0) ||
					amount % increment !== BigInt(0))
			)
				invalid("threshold", `${t.threshold} — ${t.precision}`);
		} else {
			const amount = thousandths(quantity),
				base = thousandths(before),
				held = thousandths(
					snapshot.tracking === "batch"
						? (selected?.held ?? "0.000")
						: snapshot.held,
				);
			if (
				amount === null ||
				amount === BigInt(0) ||
				(mode === "receipt" && amount < BigInt(0)) ||
				increment === null ||
				increment <= BigInt(0) ||
				amount % increment !== BigInt(0) ||
				base === null ||
				held === null ||
				base + amount < held ||
				base + amount > maximum
			)
				invalid("quantity", t.quantityError);
			if (snapshot.tracking === "batch") {
				if (
					(batch &&
						(!selected || (mode === "receipt" && !canReceive(selected)))) ||
					(!batch && mode === "adjustment")
				)
					invalid("batch", t.batchError);
				if (!batch && mode === "receipt") {
					if (!code.trim()) invalid("batch_code", t.batchCode);
					if (
						(snapshot.expiry_required && !expiry) ||
						(expiry && expiry < kabulToday())
					)
						invalid("expires_on", t.batchError);
				}
			}
		}
		if (!element.reportValidity()) return;
		const amount = thousandths(quantity),
			base = thousandths(before);
		const data: StockPayload = Object.freeze(
			mode === "settings"
				? {
						token: crypto.randomUUID(),
						version: snapshot.version,
						reason,
						tracking: policyTracking,
						expiry_required: policyTracking === "batch" && policyRequired,
						threshold: threshold || null,
					}
				: {
						token: crypto.randomUUID(),
						version: snapshot.version,
						reason,
						reference,
						quantity,
						...(snapshot.tracking === "batch"
							? batch
								? { batch }
								: { batch_code: code, expires_on: expiry || null }
							: {}),
					},
		);
		setError("");
		setReview(
			Object.freeze({
				path: `seller/variants/${position.id}/${mode === "settings" ? "settings" : mode === "receipt" ? "receipts" : "adjustments"}/?seller=${encodeURIComponent(seller)}`,
				data,
				before,
				after:
					amount !== null && base !== null
						? exactQuantity(base + amount)
						: t.unknown,
				batchCode: selected?.code ?? code,
				batchExpiry: selected?.expires_on ?? (batch ? null : expiry || null),
				unit,
				increment: snapshot.increment,
				sku: snapshot.sku,
				title: snapshot.title,
			}),
		);
	}
	async function submit(packet: StockAttempt) {
		if (
			savedRef.current ||
			(pendingRef.current && pendingRef.current !== packet) ||
			(!pendingRef.current && review !== packet)
		)
			return;
		const ticket = beginWork();
		if (ticket === null) return;
		const wasUncertain = uncertainRef.current;
		// Identical replay resolves the original operation before the server checks its version.
		pendingRef.current = packet;
		setPending(packet);
		setReview(null);
		setDirty(true);
		try {
			const result = await inventoryRequest<unknown>(packet.path, packet.data);
			if (!current(ticket)) return;
			if (
				!result ||
				typeof result !== "object" ||
				!("operation" in result) ||
				result.operation !== packet.data.token ||
				!("status" in result) ||
				result.status !== "completed" ||
				!("version" in result) ||
				typeof result.version !== "number" ||
				!Number.isSafeInteger(result.version)
			)
				throw new Error("Unconfirmed inventory acknowledgement");
		} catch (cause) {
			if (!current(ticket)) return;
			if (denied(cause)) revokeScope(ticket);
			else if (
				!wasUncertain &&
				cause instanceof AccountError &&
				(cause.status === 409 ||
					([400, 422].includes(cause.status ?? 0) && cause.fields.length > 0))
			) {
				// Only a definite first refusal permits an editable new attempt.
				pendingRef.current = null;
				setPending(null);
				if (cause.status === 409) {
					setStale(true);
					setError(t.stale);
				} else {
					const labels: Record<string, string> = {
						quantity: t.quantityError,
						reason: t.reason,
						reference: t.reference,
						batch: t.batchError,
						batch_code: t.batchCode,
						expires_on: t.batchError,
						threshold: t.threshold,
						tracking: t.tracking,
						expiry_required: t.expiryRequired,
					};
					setError(
						cause.fields.map((field) => labels[field] ?? t.review).join(" · "),
					);
				}
				toast.error(copy.errorToast);
			} else {
				// A later refusal cannot prove that the original uncertain operation was absent.
				uncertainRef.current = true;
				setUncertain(true);
				setError(copy.uncertain);
			}
			finishWork(ticket);
			return;
		}
		if (!current(ticket)) return;
		savedRef.current = true;
		pendingRef.current = null;
		uncertainRef.current = false;
		setPending(null);
		setUncertain(false);
		setDirty(false);
		setSaved(true);
		setLeave(null);
		setStale(false);
		toast.success(t.saved);
		try {
			await readStock(ticket, true);
		} finally {
			finishWork(ticket);
		}
	}
	if (scopeRevoked)
		return (
			<section className={panel}>
				<Alert role="alert">{t.denied}</Alert>
			</section>
		);
	const previewAmount = thousandths(quantity),
		previewBase = thousandths(before),
		previewResult =
			previewAmount !== null && previewBase !== null
				? exactQuantity(previewBase + previewAmount)
				: null;
	const displayed = review ?? pending;
	const reviewRows: [string, ReactNode][] = displayed
		? [
				[t.sku, <bdi key="sku">{displayed.sku}</bdi>],
				[t.unit, displayed.unit],
				[
					t.precision,
					<span key="increment">
						<bdi dir="ltr">{displayed.increment}</bdi> {displayed.unit}
					</span>,
				],
				...(mode === "settings"
					? ([
							[
								t.tracking,
								displayed.data.tracking === "batch" ? t.batchMode : t.plain,
							],
							[
								t.expiryRequired,
								displayed.data.expiry_required ? copy.yes : copy.no,
							],
							[
								t.threshold,
								displayed.data.threshold === null ? (
									copy.notSet
								) : (
									<span key="threshold">
										<bdi dir="ltr">{displayed.data.threshold}</bdi>{" "}
										{displayed.unit}
									</span>
								),
							],
						] as [string, ReactNode][])
					: ([
							[
								t.quantity,
								<span key="quantity">
									<bdi dir="ltr">{displayed.data.quantity}</bdi>{" "}
									{displayed.unit}
								</span>,
							],
							[
								t.before,
								<span key="before">
									<bdi dir="ltr">{displayed.before}</bdi> {displayed.unit}
								</span>,
							],
							[
								t.after,
								<span key="after">
									<bdi dir="ltr">{displayed.after}</bdi> {displayed.unit}
								</span>,
							],
							...(displayed.data.batch || displayed.data.batch_code
								? ([
										[
											displayed.data.batch ? t.chooseBatch : t.newBatch,
											<bdi key="batch">{displayed.batchCode}</bdi>,
										],
										[
											t.expires,
											displayed.batchExpiry ? (
												<bdi key="expiry" dir="ltr">
													{displayed.batchExpiry}
												</bdi>
											) : (
												copy.notSet
											),
										],
									] as [string, ReactNode][])
								: []),
							[
								t.reference,
								displayed.data.reference ? (
									<bdi key="reference" dir="auto">
										{displayed.data.reference}
									</bdi>
								) : (
									copy.notSet
								),
							],
						] as [string, ReactNode][])),
				[t.reason, displayed.data.reason],
			]
		: [];
	const packetSummary = displayed && (
		<>
			<p className="font-semibold wrap-anywhere">{displayed.title}</p>
			<dl className="mt-4 divide-y divide-border">
				{reviewRows.map(([label, value]) => (
					<div
						key={label}
						className="grid min-w-0 gap-1 py-3 sm:grid-cols-2 sm:gap-4"
					>
						<dt className="text-sm text-muted">{label}</dt>
						<dd className="min-w-0 whitespace-pre-wrap text-sm font-medium wrap-anywhere">
							{value}
						</dd>
					</div>
				))}
			</dl>
		</>
	);
	return (
		<section className={`${panel} space-y-6`}>
			<header className="min-w-0 space-y-4">
				<Button
					asChild
					variant="ghost"
					size="sm"
					className="h-9 rounded-lg text-xs font-semibold text-muted"
				>
					<Link href={backHref}>
						<ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
						{t.back}
					</Link>
				</Button>
				<div className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-page/50 p-4">
					<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-info text-action">
						<Package className="size-5" aria-hidden="true" />
					</span>
					<div className="min-w-0">
						<h2 className="m-0 text-lg font-bold text-foreground wrap-anywhere">
							{snapshot.title}
						</h2>
						<p className="m-0 mt-1 text-sm text-muted wrap-anywhere">
							{t.sku}: <bdi className="text-foreground">{snapshot.sku}</bdi>
						</p>
						<p className="m-0 mt-1 text-xs text-muted wrap-anywhere">
							{t.unit}: {unit} · <bdi dir="ltr">{snapshot.increment}</bdi> {unit}
						</p>
					</div>
				</div>
			</header>
			{saved && (
				<Alert variant="success" role="status">
					{t.saved}
				</Alert>
			)}
			{refreshFailed && (
				<Alert ref={errorFocus} tabIndex={-1} role="alert">
					{copy.savedRefresh}
				</Alert>
			)}
			{error && (
				<Alert ref={errorFocus} tabIndex={-1} role="alert">
					{error}
				</Alert>
			)}
			{(stale || refreshFailed) && (
				<Button
					variant="outline"
					size="sm"
					className="h-9 rounded-lg text-xs font-semibold"
					disabled={busy || pending !== null}
					onClick={() => void reloadStock()}
				>
					<RefreshCw className="size-4" aria-hidden="true" />
					{t.reload}
				</Button>
			)}
			<section aria-labelledby={`${formId}-stock`} className="space-y-3">
				<h3 id={`${formId}-stock`} className="text-base font-semibold">
					{copy.currentStock}
				</h3>
				<dl className="grid gap-3 sm:grid-cols-3">
					{[
						[t.physical, snapshot.physical],
						[t.held, snapshot.held],
						[t.available, snapshot.available ?? t.unknown],
					].map(([label, value]) => (
						<div
							key={label}
							className="min-w-0 rounded-xl border border-border bg-page p-4"
						>
							<dt className="text-sm text-muted">{label}</dt>
							<dd className="mt-2 text-xl font-semibold text-foreground wrap-anywhere">
								<bdi dir="ltr">{value}</bdi>{" "}
								<span className="text-sm font-normal text-muted">{unit}</span>
							</dd>
						</div>
					))}
				</dl>
				<p className="text-sm leading-relaxed text-muted">{t.stockMeaning}</p>
			</section>
			{!saved && (
				<>
					<form
						id={formId}
						ref={form}
						aria-busy={busy}
						onChange={() => {
							if (busyRef.current || pendingRef.current || savedRef.current)
								return;
							setDirty(true);
							for (const control of Array.from(form.current?.elements ?? [])) {
								if (
									control instanceof HTMLInputElement ||
									control instanceof HTMLTextAreaElement ||
									control instanceof HTMLSelectElement
								)
									control.setCustomValidity("");
							}
						}}
						onSubmit={(event) => {
							event.preventDefault();
							reviewChange();
						}}
					>
						<fieldset
							disabled={controlsLocked}
							className="m-0 min-w-0 space-y-6 border-0 p-0"
						>
							<legend className="sr-only">{t[mode]}</legend>
							{mode === "settings" ? (
								<section
									aria-labelledby={`${formId}-policy`}
									className="space-y-4"
								>
									<div>
										<h3
											id={`${formId}-policy`}
											className="flex items-center gap-2 text-base font-semibold"
										>
											<Settings2
												className="size-4 text-action"
												aria-hidden="true"
											/>
											{copy.policy}
										</h3>
										<p
											id={`${formId}-policy-help`}
											className="mt-1 text-sm leading-relaxed text-muted"
										>
											{locked ? copy.lockedHelp : copy.setupHelp}
										</p>
									</div>
									<Alert variant="info">{locked ? t.locked : t.policy}</Alert>
									<FormField id="field-tracking" label={t.tracking}>
										<NativeSelect
											id="field-tracking"
											name="tracking"
											value={policyTracking}
											disabled={locked}
											aria-describedby={`${formId}-policy-help`}
											onChange={(event) => setTracking(event.target.value)}
										>
											<NativeSelectOption value="plain">
												{t.plain}
											</NativeSelectOption>
											<NativeSelectOption value="batch">
												{t.batchMode}
											</NativeSelectOption>
										</NativeSelect>
									</FormField>
									{policyTracking === "batch" && (
										<CheckField
											name="expiry_required"
											label={t.expiryRequired}
											checked={policyRequired}
											disabled={locked}
											aria-describedby={`${formId}-policy-help`}
											onChange={(event) => setRequired(event.target.checked)}
										/>
									)}
									<FormField
										id="field-threshold"
										label={`${t.threshold} · ${unit}`}
										optional={copy.optional}
									>
										<Input
											id="field-threshold"
											name="threshold"
											dir="ltr"
											inputMode="decimal"
											pattern="[0-9]{1,9}([.][0-9]{1,3})?"
											value={threshold}
											maxLength={20}
											className="font-identifier"
											aria-describedby={`${formId}-threshold-help`}
											onChange={(event) => setThreshold(event.target.value)}
										/>
									</FormField>
									<p
										id={`${formId}-threshold-help`}
										className="text-sm leading-relaxed text-muted"
									>
										{copy.thresholdHelp} {t.precision}{" "}
										<bdi dir="ltr">{snapshot.increment}</bdi> {unit}
									</p>
								</section>
							) : (
								<section
									aria-labelledby={`${formId}-change`}
									className="space-y-4"
								>
									<div>
										<h3
											id={`${formId}-change`}
											className="flex items-center gap-2 text-base font-semibold"
										>
											<PackagePlus
												className="size-4 text-action"
												aria-hidden="true"
											/>
											{copy.change}
										</h3>
										<p
											id={`${formId}-change-help`}
											className="mt-1 text-sm leading-relaxed text-muted"
										>
											{mode === "receipt" ? copy.receiveHelp : copy.adjustHelp}
										</p>
									</div>
									{snapshot.tracking === "batch" && (
										<>
											<FormField
												id="field-batch"
												label={t.chooseBatch}
												required={mode === "adjustment"}
											>
												<NativeSelect
													id="field-batch"
													name="batch"
													value={batch}
													required={mode === "adjustment"}
													aria-describedby={`${formId}-change-help`}
													onChange={(event) => setBatch(event.target.value)}
												>
													<NativeSelectOption value="">
														{mode === "receipt" ? t.newBatch : t.chooseBatch}
													</NativeSelectOption>
													{snapshot.batches?.map((item) => (
														<NativeSelectOption
															key={item.id}
															value={item.id}
															disabled={mode === "receipt" && !canReceive(item)}
														>
															{item.code} · {item.physical} {unit}
															{item.expired ? ` · ${t.expired}` : ""}
														</NativeSelectOption>
													))}
												</NativeSelect>
											</FormField>
											{!batch && mode === "receipt" && (
												<div className="grid gap-4 sm:grid-cols-2">
													<FormField id="field-batch_code" label={t.batchCode} required>
														<Input
															id="field-batch_code"
															name="batch_code"
															required
															maxLength={80}
															value={code}
															onChange={(event) => setCode(event.target.value)}
														/>
													</FormField>
													<FormField
														id="field-expires_on"
														label={t.expires}
														required={snapshot.expiry_required}
													>
														<Input
															id="field-expires_on"
															name="expires_on"
															type="date"
															dir="ltr"
															required={snapshot.expiry_required}
															min={kabulToday()}
															value={expiry}
															className="font-identifier"
															onChange={(event) =>
																setExpiry(event.target.value)
															}
														/>
													</FormField>
												</div>
											)}
										</>
									)}
									<FormField
										id="field-quantity"
										label={`${t.quantity} · ${unit}`}
										required
									>
										<Input
											id="field-quantity"
											name="quantity"
											dir="ltr"
											inputMode="decimal"
											required
											pattern={
												mode === "adjustment"
													? "-?[0-9]{1,9}([.][0-9]{1,3})?"
													: "[0-9]{1,9}([.][0-9]{1,3})?"
											}
											maxLength={20}
											value={quantity}
											className="font-identifier"
											aria-describedby={`${formId}-quantity-help ${formId}-change-help`}
											onChange={(event) => setQuantity(event.target.value)}
										/>
									</FormField>
									<p
										id={`${formId}-quantity-help`}
										className="text-sm leading-relaxed text-muted"
									>
										{copy.quantityHelp} {t.precision}{" "}
										<bdi dir="ltr">{snapshot.increment}</bdi> {unit}
									</p>
									{previewResult !== null && (
										<div
											aria-live="polite"
											className={`rounded-xl border p-4 ${
												mode === "receipt"
													? "border-success/30 bg-success-surface"
													: "border-border bg-page"
											}`}
										>
											{mode === "receipt" ? (
												<div className="flex flex-wrap items-baseline justify-between gap-2">
													<span className="text-sm font-medium text-foreground">
														{t.receivePreview}
													</span>
													<span className="text-lg font-bold text-success">
														<bdi dir="ltr">{previewResult}</bdi>{" "}
														<span className="text-sm font-normal">{unit}</span>
													</span>
												</div>
											) : (
												<>
													<dl className="grid grid-cols-3 gap-3 text-center">
														{[
															[t.current, before, "text-foreground"],
															[
																t.changeAmount,
																quantity,
																previewAmount !== null && previewAmount < BigInt(0)
																	? "text-danger"
																	: "text-success",
															],
															[t.resulting, previewResult, "text-foreground"],
														].map(([label, value, tone]) => (
															<div key={label} className="min-w-0">
																<dt className="text-caption text-muted">
																	{label}
																</dt>
																<dd
																	className={`mt-1 text-base font-bold tabular-nums ${tone} wrap-anywhere`}
																>
																	<bdi dir="ltr">{value}</bdi>
																</dd>
															</div>
														))}
													</dl>
													<p className="mt-3 border-t border-border pt-3 text-caption leading-relaxed text-muted">
														{t.adjustNotice}
													</p>
												</>
											)}
										</div>
									)}
								</section>
							)}
							<section
								aria-labelledby={`${formId}-details`}
								className="space-y-4"
							>
								<h3
									id={`${formId}-details`}
									className="flex items-center gap-2 text-base font-semibold"
								>
									<FileText className="size-4 text-action" aria-hidden="true" />
									{copy.details}
								</h3>
								{mode !== "settings" && (
									<FormField
										id="field-reference"
										label={t.reference}
										optional={copy.optional}
									>
										<Input
											id="field-reference"
											name="reference"
											maxLength={120}
											value={reference}
											onChange={(event) => setReference(event.target.value)}
										/>
									</FormField>
								)}
								<FormField id="field-reason" label={t.reason} required>
									<Textarea
										id="field-reason"
										name="reason"
										required
										maxLength={1000}
										rows={4}
										className="min-h-32 resize-y"
										value={reason}
										onChange={(event) => setReason(event.target.value)}
									/>
								</FormField>
							</section>
						</fieldset>
					</form>
					{pending && (
						<section
							aria-labelledby={`${formId}-pending`}
							className={`rounded-xl border p-4 ${
								uncertain
									? "border-warning/40 bg-warning-surface"
									: "border-border bg-page"
							}`}
						>
							<h3
								id={`${formId}-pending`}
								className="flex items-center gap-2 text-base font-semibold"
							>
								{uncertain && (
									<AlertTriangle
										className="size-4 text-warning"
										aria-hidden="true"
									/>
								)}
								{t.review}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted">
								{uncertain ? copy.uncertain : copy.reviewHelp}
							</p>
							{packetSummary}
						</section>
					)}
					<StickyActionBar className="-mx-4! -mb-4! desktop:-mx-6! desktop:-mb-6!">
						{pending ? (
							<Button
								size="lg"
								className="w-full rounded-lg whitespace-normal sm:w-auto"
								disabled={busy || !uncertain}
								onClick={() => void submit(pending)}
							>
								<RefreshCw className="size-4" aria-hidden="true" />
								{copy.replay}
							</Button>
						) : (
							<>
								<Button
									asChild
									variant="outline"
									size="lg"
									className="w-full rounded-lg sm:w-auto"
								>
									<Link href={backHref}>{t.cancel}</Link>
								</Button>
								<Button
									type="submit"
									form={formId}
									size="lg"
									className="w-full rounded-lg sm:w-auto"
									disabled={controlsLocked}
								>
									{t.save}
								</Button>
							</>
						)}
					</StickyActionBar>
				</>
			)}
			{review && (
				<StockModal
					title={t.review}
					onClose={() => !busyRef.current && setReview(null)}
				>
					<p className="mb-4 text-sm leading-relaxed text-muted">
						{copy.reviewHelp}
					</p>
					{packetSummary}
					<div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
						<Button
							variant="outline"
							size="lg"
							className="w-full rounded-lg sm:w-auto"
							disabled={busy}
							onClick={() => setReview(null)}
						>
							{t.keep}
						</Button>
						<Button
							size="lg"
							className="w-full rounded-lg sm:w-auto"
							disabled={busy}
							onClick={() => void submit(review)}
						>
							{t.confirm}
						</Button>
					</div>
				</StockModal>
			)}
			{leave && (
				<StockModal
					title={pending ? copy.pendingLeave : t.discard}
					onClose={() => setLeave(null)}
				>
					{pending && (
						<p className="mb-4 text-sm leading-relaxed text-muted">
							{copy.pendingLeave}
						</p>
					)}
					<div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
						<Button
							variant="outline"
							size="lg"
							className="w-full rounded-lg sm:w-auto"
							onClick={() => setLeave(null)}
						>
							{t.keep}
						</Button>
						{!pending && (
							<Button
								variant="destructive"
								size="lg"
								className="w-full rounded-lg sm:w-auto"
								disabled={busy}
								onClick={() => {
									if (busyRef.current || pendingRef.current) return;
									setDirty(false);
									const action = leave;
									setLeave(null);
									action();
								}}
							>
								{t.discardConfirm}
							</Button>
						)}
					</div>
				</StockModal>
			)}
		</section>
	);
}
