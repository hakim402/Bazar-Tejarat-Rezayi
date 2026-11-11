"use client";
import { ArrowLeft } from "lucide-react";
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
import { useUnsavedNavigation } from "../../../../../../../components/layout/navigation-guard";
import { AccountError } from "../../../../../../../lib/api/private-client";
import {
	inventoryRequest,
	type StockPosition,
} from "../../../../../../../features/inventory/api/inventory";
import { StockModal, panel } from "./stock-parts";
import { stockHref } from "./stock-ui";
import { stockFlowCopy } from "../../../../../../../lib/i18n/stock-flow";

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
	opening_quantity?: string;
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
					<span className="text-caption font-normal text-muted">
						{optional}
					</span>
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
		flow = stockFlowCopy[locale],
		returnParams = useSearchParams();
	const [snapshot, setSnapshot] = useState(position),
		[tracking, setTracking] = useState(position.tracking ?? "plain"),
		[required, setRequired] = useState(position.expiry_required),
		[threshold, setThreshold] = useState(position.threshold ?? ""),
		[quantity, setQuantity] = useState(""),
		[reason, setReason] = useState<string>(
			mode === "settings"
				? position.configured
					? flow.settingsReason
					: flow.openingReason
				: mode === "adjustment"
					? flow.correction
					: t.received,
		),
		[step, setStep] = useState(1),
		[notes, setNotes] = useState(""),
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
	const opening = mode === "settings" && !position.configured;
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
		let invalidMessage = "";
		const invalid = (name: string, message: string) => {
			invalidMessage = message;
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
			if (opening) {
				const initial = thousandths(quantity);
				if (
					initial === null ||
					initial < BigInt(0) ||
					initial > maximum ||
					increment === null ||
					increment <= BigInt(0) ||
					initial % increment !== BigInt(0)
				)
					invalid("quantity", t.quantityError);
				if (
					policyTracking === "batch" &&
					policyRequired &&
					(!expiry || expiry < kabulToday())
				)
					invalid("expires_on", t.batchError);
			}
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
			const entered = thousandths(quantity),
				base = thousandths(before),
				amount =
					mode === "adjustment" && entered !== null && base !== null
						? entered - base
						: entered,
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
					if (
						(snapshot.expiry_required && !expiry) ||
						(expiry && expiry < kabulToday())
					)
						invalid("expires_on", t.batchError);
				}
			}
		}
		if (invalidMessage) {
			setError(invalidMessage);
			return;
		}
		if (!element.reportValidity()) return;
		const entered = thousandths(quantity),
			base = thousandths(before);
		const amount =
			mode === "adjustment" && entered !== null && base !== null
				? entered - base
				: entered;
		const token = crypto.randomUUID();
		const deliveryCode = `DEL-${token.slice(0, 12)}`;
		const data: StockPayload = Object.freeze(
			mode === "settings"
				? {
						token,
						version: snapshot.version,
						reason: notes ? `${reason}: ${notes}` : reason,
						...(opening
							? {
									opening_quantity: quantity,
									expires_on:
										policyTracking === "batch" ? expiry || null : null,
								}
							: {}),
						tracking: policyTracking,
						expiry_required: policyTracking === "batch" && policyRequired,
						threshold: threshold || null,
					}
				: {
						token,
						version: snapshot.version,
						reason: notes ? `${reason}: ${notes}` : reason,
						reference,
						quantity:
							mode === "adjustment" && amount !== null
								? exactQuantity(amount)
								: quantity,
						...(snapshot.tracking === "batch"
							? batch
								? { batch }
								: { batch_code: deliveryCode, expires_on: expiry || null }
							: {}),
					},
		);
		setError("");
		setReview(
			Object.freeze({
				path: `seller/variants/${position.id}/${mode === "settings" ? "settings" : mode === "receipt" ? "receipts" : "adjustments"}/?seller=${encodeURIComponent(seller)}`,
				data,
				before,
				after: opening
					? quantity
					: amount !== null && base !== null
						? exactQuantity(base + amount)
						: t.unknown,
				batchCode: selected?.code ?? deliveryCode,
				batchExpiry: selected?.expires_on ?? (batch ? null : expiry || null),
				unit,
				increment: snapshot.increment,
				sku: snapshot.sku,
				title: snapshot.title,
			}),
		);
		setStep(3);
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
				setStep(2);
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
	if (
		mode === "adjustment" &&
		snapshot.tracking === "batch" &&
		!snapshot.batches?.length
	)
		return (
			<section className={`${panel} mx-auto max-w-3xl space-y-4`}>
				<h2 className="m-0 text-lg font-semibold">{snapshot.title}</h2>
				<p className="text-sm text-muted">{flow.noBatches}</p>
				<Button asChild>
					<Link
						href={stockHref(
							locale,
							`inventory/${position.id}/receipts/new`,
							seller,
							returnParams,
						)}
					>
						{t.receipt}
					</Link>
				</Button>
			</section>
		);
	const entered = thousandths(quantity),
		base = thousandths(before);
	const result =
		mode === "adjustment"
			? entered
			: entered !== null && base !== null
				? entered + base
				: null;
	const displayed = review ?? pending;
	const summary = displayed && (
		<dl className="m-0 divide-y divide-border">
			{[
				[
					mode === "adjustment"
						? flow.changed
						: mode === "receipt"
							? flow.received
							: flow.opening,
					mode === "settings"
						? displayed.data.opening_quantity
						: displayed.data.quantity,
				],
				...(mode !== "settings"
					? [
							[t.before, displayed.before],
							[t.after, displayed.after],
						]
					: [
							[flow.threshold, displayed.data.threshold ?? copy.notSet],
							[flow.expiryDate, displayed.data.expires_on ?? copy.notSet],
						]),
				...(displayed.data.batch || displayed.data.batch_code
					? [
							[flow.existingDelivery, displayed.batchCode],
							[flow.expiryDate, displayed.batchExpiry ?? copy.notSet],
						]
					: []),
				...(mode === "adjustment"
					? [[flow.reason, displayed.data.reason]]
					: []),
			]
				.filter(([, value]) => value !== undefined)
				.map(([label, value]) => (
					<div
						key={label}
						className="flex flex-wrap justify-between gap-3 py-3 text-sm"
					>
						<dt className="text-muted">{label}</dt>
						<dd className="m-0 font-medium">
							<bdi>
								{typeof value === "string"
									? value.replace(/\.000$/, "")
									: value}
							</bdi>
						</dd>
					</div>
				))}
		</dl>
	);
	const next = () => {
		if (!form.current?.reportValidity()) return;
		setError("");
		if (step === 1) setStep(2);
		else reviewChange();
	};
	return (
		<div className="mx-auto w-full max-w-3xl space-y-6">
			<Link
				className="inline-flex items-center gap-2 text-sm text-muted no-underline hover:text-action"
				href={backHref}
			>
				<ArrowLeft className="size-4 rtl:rotate-180" />
				{t.back}
			</Link>
			<div>
				<h2 className="m-0 text-xl font-semibold">{snapshot.title}</h2>
				<p className="m-0 mt-1 text-sm text-muted">
					<bdi>{snapshot.sku}</bdi> · {unit}
				</p>
			</div>
			{!saved && (
				<ol className="m-0 flex list-none gap-2 p-0" aria-label={flow.options}>
					{[
						mode === "settings" && !opening ? flow.settings : flow.quantity,
						flow.options,
						flow.confirm,
					].map((label, index) => (
						<li
							key={label}
							aria-current={step === index + 1 ? "step" : undefined}
							className="flex min-w-0 flex-1 flex-col gap-2 text-xs"
						>
							<span
								className={`flex size-9 items-center justify-center rounded-full border border-solid ${step >= index + 1 ? "border-action bg-action text-on-primary" : "border-border bg-surface text-muted"}`}
							>
								{new Intl.NumberFormat(locale).format(index + 1)}
							</span>
							<span
								className={
									step === index + 1
										? "font-semibold text-foreground"
										: "text-muted"
								}
							>
								{label}
							</span>
							<span
								className={`h-0.5 ${step > index + 1 ? "bg-action" : "bg-border"}`}
							/>
						</li>
					))}
				</ol>
			)}
			{(error || refreshFailed) && (
				<Alert ref={errorFocus} tabIndex={-1} role="alert">
					{refreshFailed ? copy.savedRefresh : error}
				</Alert>
			)}
			{(stale || refreshFailed) && (
				<Button
					variant="outline"
					disabled={busy || pending !== null}
					onClick={() => void reloadStock()}
				>
					{t.reload}
				</Button>
			)}
			{saved ? (
				<section className={`${panel} space-y-4`}>
					<h3 className="m-0 text-lg font-semibold">{flow.saved}</h3>
					<p className="text-sm">
						{flow.inStock}: <bdi>{snapshot.physical}</bdi> {unit}
					</p>
					<Button asChild>
						<Link href={stockHref(locale, "inventory", seller, returnParams)}>
							{flow.done}
						</Link>
					</Button>
				</section>
			) : (
				<>
					<form
						id={formId}
						ref={form}
						onSubmit={(event) => {
							event.preventDefault();
							next();
						}}
						onChange={() => {
							setDirty(true);
							setError("");
							for (const control of Array.from(form.current?.elements ?? [])) {
								if (
									control instanceof HTMLInputElement ||
									control instanceof HTMLTextAreaElement ||
									control instanceof HTMLSelectElement
								)
									control.setCustomValidity("");
							}
						}}
						className={`${panel} space-y-5`}
					>
						<h3 className="m-0 text-lg font-semibold">
							{step === 3
								? flow.review
								: step === 2
									? flow.options
									: opening
										? flow.opening
										: mode === "adjustment"
											? flow.count
											: mode === "receipt"
												? flow.received
												: flow.settings}
						</h3>
						<fieldset
							disabled={controlsLocked}
							className="m-0 min-w-0 space-y-5 border-0 p-0"
						>
							{step === 1 && (
								<>
									{mode !== "settings" && snapshot.tracking === "batch" && (
										<FormField
											id="field-batch"
											label={flow.existingDelivery}
											required={mode === "adjustment"}
										>
											<NativeSelect
												id="field-batch"
												name="batch"
												value={batch}
												required={mode === "adjustment"}
												onChange={(e) => setBatch(e.target.value)}
											>
												<NativeSelectOption value="">
													{mode === "receipt"
														? flow.newDelivery
														: flow.existingDelivery}
												</NativeSelectOption>
												{snapshot.batches?.map((item) => (
													<NativeSelectOption
														key={item.id}
														value={item.id}
														disabled={mode === "receipt" && !canReceive(item)}
													>
														{item.code} · {item.physical} {unit}
													</NativeSelectOption>
												))}
											</NativeSelect>
										</FormField>
									)}
									{opening || mode !== "settings" ? (
										<FormField
											id="field-quantity"
											label={`${opening ? flow.opening : mode === "adjustment" ? flow.count : flow.received} · ${unit}`}
											required
										>
											<Input
												id="field-quantity"
												name="quantity"
												dir="ltr"
												inputMode="decimal"
												required
												pattern="[0-9]{1,9}([.][0-9]{1,3})?"
												value={quantity}
												onChange={(e) => setQuantity(e.target.value)}
												aria-describedby="stock-step-help"
											/>
											<p
												id="stock-step-help"
												className="m-0 mt-2 text-xs text-muted"
											>
												{flow.increment}: <bdi>{snapshot.increment}</bdi> {unit}
											</p>
										</FormField>
									) : (
										<FormField
											id="field-threshold"
											label={`${flow.reminder} · ${unit}`}
											optional={flow.optional}
										>
											<Input
												id="field-threshold"
												name="threshold"
												dir="ltr"
												inputMode="decimal"
												value={threshold}
												onChange={(e) => setThreshold(e.target.value)}
												pattern="[0-9]{1,9}([.][0-9]{1,3})?"
											/>
										</FormField>
									)}
									{mode !== "settings" && result !== null && (
										<div className="rounded-xl bg-info p-3 text-sm">
											{flow.inStock}: <bdi>{before}</bdi> →{" "}
											<bdi>{exactQuantity(result)}</bdi> {unit}
										</div>
									)}
								</>
							)}
							{step === 2 && (
								<>
									{mode === "settings" && (
										<>
											{opening && (
												<FormField
													id="field-threshold"
													label={`${flow.reminder} · ${unit}`}
													optional={flow.optional}
												>
													<Input
														id="field-threshold"
														name="threshold"
														dir="ltr"
														inputMode="decimal"
														value={threshold}
														onChange={(e) => setThreshold(e.target.value)}
														pattern="[0-9]{1,9}([.][0-9]{1,3})?"
													/>
												</FormField>
											)}
											{locked && (
												<p className="m-0 text-sm text-muted">
													{policyTracking === "batch"
														? flow.separate
														: flow.simple}
												</p>
											)}
											{!locked && (
												<>
													<CheckField
														compact
														name="expiry_required"
														label={flow.expiry}
														checked={policyRequired}
														onChange={(e) => {
															setRequired(e.target.checked);
															if (e.target.checked) setTracking("batch");
														}}
													/>
													<details className="text-sm">
														<summary className="cursor-pointer text-muted">
															{flow.advanced}
														</summary>
														<div className="mt-3 space-y-2">
															<CheckField
																compact
																name="separate"
																label={flow.separate}
																checked={policyTracking === "batch"}
																disabled={policyRequired}
																onChange={(e) =>
																	setTracking(
																		e.target.checked ? "batch" : "plain",
																	)
																}
															/>
															<p className="text-xs text-muted">
																{flow.batchHelp}
															</p>
														</div>
													</details>
												</>
											)}
										</>
									)}
									{((opening && policyRequired) ||
										(mode === "receipt" &&
											snapshot.tracking === "batch" &&
											!batch)) && (
										<FormField
											id="field-expires_on"
											label={flow.expiryDate}
											required={
												opening ? policyRequired : snapshot.expiry_required
											}
										>
											<Input
												id="field-expires_on"
												name="expires_on"
												type="date"
												min={kabulToday()}
												required={
													opening ? policyRequired : snapshot.expiry_required
												}
												value={expiry}
												onChange={(e) => setExpiry(e.target.value)}
											/>
										</FormField>
									)}
									{mode === "adjustment" && (
										<>
											<FormField id="field-reason" label={flow.reason} required>
												<NativeSelect
													id="field-reason"
													name="reason"
													value={reason}
													onChange={(e) => setReason(e.target.value)}
												>
													{[
														flow.correction,
														flow.damaged,
														flow.lost,
														flow.other,
													].map((label) => (
														<NativeSelectOption key={label} value={label}>
															{label}
														</NativeSelectOption>
													))}
												</NativeSelect>
											</FormField>
											<FormField
												id="field-notes"
												label={flow.notes}
												optional={
													reason === flow.other ? undefined : flow.optional
												}
											>
												<Textarea
													id="field-notes"
													required={reason === flow.other}
													value={notes}
													rows={3}
													maxLength={800}
													onChange={(e) => setNotes(e.target.value)}
												/>
											</FormField>
										</>
									)}
									{mode === "receipt" && (
										<FormField
											id="field-reference"
											label={t.reference}
											optional={flow.optional}
										>
											<Input
												id="field-reference"
												value={reference}
												maxLength={120}
												onChange={(e) => setReference(e.target.value)}
											/>
										</FormField>
									)}
								</>
							)}
						</fieldset>
						{step === 3 && summary}
						{pending && <Alert role="status">{copy.uncertain}</Alert>}
					</form>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Button
							type="button"
							variant="outline"
							disabled={busy || pending !== null || step === 1}
							onClick={() => {
								setReview(null);
								setStep((value) => Math.max(1, value - 1));
								setError("");
							}}
						>
							{flow.previous}
						</Button>
						{pending ? (
							<Button
								disabled={busy || !uncertain}
								onClick={() => void submit(pending)}
							>
								{copy.replay}
							</Button>
						) : step === 3 && review ? (
							<Button disabled={busy} onClick={() => void submit(review)}>
								{t.confirm}
							</Button>
						) : (
							<Button
								type="submit"
								form={formId}
								disabled={busy || stale || !snapshot.capabilities.write}
							>
								{flow.next}
							</Button>
						)}
					</div>
				</>
			)}
			{leave && (
				<StockModal
					title={pending ? copy.pendingLeave : t.discard}
					onClose={() => setLeave(null)}
				>
					<div className="flex gap-3">
						<Button variant="outline" onClick={() => setLeave(null)}>
							{t.keep}
						</Button>
						{!pending && (
							<Button
								onClick={() => {
									setLeave(null);
									leave();
								}}
							>
								{t.discard}
							</Button>
						)}
					</div>
				</StockModal>
			)}
		</div>
	);
}
