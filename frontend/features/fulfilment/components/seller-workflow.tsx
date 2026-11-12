"use client";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	MoreHorizontal,
	Package,
	RotateCcw,
	Shield,
	Truck,
	Wallet,
} from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { useSellerNavigation } from "../../../app/[locale]/(seller)/account/seller/components/seller-navigation";
import { Icon } from "../../../components/ui/icon";
import { sellerHref } from "../../../lib/routes/account-routes";
import type { QueryReader } from "../../../lib/routes/account-routes";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { localTimestamp } from "../../messaging/api";
import {
	salesAction,
	salesHref,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { fulfilmentCopy, fulfilmentState } from "../copy";
import { workflowCopy } from "../workflow-copy";
import { availableModes } from "../modes";
import type { Mode, Draft } from "../draft";
import type { Detail, Reviewed } from "../types";
import type { useFulfilmentCommand } from "../use-command";
import { DeliveryActionForm } from "./action-form";
import { DeliveryReview } from "./review";
import { DeliveryHistory } from "./history";
import { Money, ProductThumbnail } from "../../orders/components/order-ui";

type Command = ReturnType<typeof useFulfilmentCommand>;
type Drafts = Partial<Record<Mode, { draft: Draft; generation: number }>>;

function stageNumber(row: Detail): 1 | 2 | 3 {
	if (row.stage === "dispatched" || row.stage === "delivered") return 3;
	return row.stage === "prepared" ? 2 : 1;
}

const EXCEPTION_MODES: Mode[] = [
	"claim",
	"correction",
	"withdraw",
	"refund",
	"partial",
];
const MODE_ICONS: Record<string, typeof Truck> = {
	arrange: Truck,
	prepare: Package,
	charge: Wallet,
	partial: Shield,
	dispatch: Truck,
	tracking: Truck,
	deliver: Check,
	claim: Wallet,
	correction: Wallet,
	withdraw: RotateCcw,
	refund: Wallet,
};
type PrimaryAction =
	| { kind: "form"; mode: Mode }
	| { kind: "link"; href: string; label: string; icon: typeof Truck }
	| { kind: "note"; note: string }
	| null;

export function SellerFulfilment({
	locale,
	row,
	seller,
	page,
	params,
	command,
	review,
	setReview,
	uploaded,
	formGeneration,
	deny,
	handover,
	downloading,
	online,
	error,
	opener,
}: {
	locale: Locale;
	row: Detail;
	seller: string;
	page: number;
	params: QueryReader | undefined;
	command: Command;
	review: Reviewed | null;
	setReview: (value: Reviewed | null) => void;
	uploaded: { id: string; purpose: string } | null;
	formGeneration: number;
	deny: () => void;
	handover: (kind: "html" | "pdf") => void;
	downloading: boolean;
	online: boolean;
	error: boolean;
	opener: { current: HTMLElement | null };
}) {
	const t = fulfilmentCopy[locale],
		w = workflowCopy[locale],
		destinations = useSellerNavigation(),
		can = (route: string) => !!destinations?.some((x) => x.route === route),
		modes = availableModes(row, "seller", locale),
		stage = stageNumber(row),
		advance = row.payment_method === "advance",
		goodsPaid =
			!advance || row.goods_remaining === "0.00" || !!row.partial_permission,
		chargeReady = !!row.charge_id,
		holdsOk = !row.cancellation_hold && !row.dispute_open,
		sellerArranged = row.arrangement?.arranger === "seller",
		pendingCharge = row.proposals.some(
			(proposal) =>
				proposal.state === "pending" &&
				proposal.provider_id === row.arrangement?.provider_id,
		),
		exceptionModes = modes.filter(([mode]) => EXCEPTION_MODES.includes(mode)),
		[exception, setException] = useState<Mode | null>(null),
		drafts = useRef<Drafts>({});

	const inModes = (mode: Mode) => modes.some(([value]) => value === mode);

	function upload(file: File, purpose: "claim" | "correction" | "refund") {
		if (purpose === "refund" && !row.capabilities.refund) return;
		const key = crypto.randomUUID(),
			body = new FormData();
		body.set("command_id", key);
		body.set("purpose", purpose);
		body.set("file", file);
		void command.send({ key, path: "uploads/", body, upload: true });
	}
	function renderForm(mode: Mode) {
		const entry = drafts.current[mode],
			initialDraft =
				entry && entry.generation === formGeneration ? entry.draft : undefined;
		return (
			<DeliveryActionForm
				key={`${formGeneration}:${mode}`}
				guided
				fixedMode={mode}
				locale={locale}
				context="seller"
				row={row}
				locked={command.locked || !online}
				uploaded={uploaded}
				onDenied={deny}
				initialDraft={initialDraft}
				onDraftChange={(draft) => {
					drafts.current[mode] = { draft, generation: formGeneration };
				}}
				review={(next, focus) => {
					opener.current = focus;
					setReview(next);
				}}
				upload={upload}
			/>
		);
	}
	const ordersHref = salesHref(locale, "orders", seller, row.id),
		paymentsHref = salesHref(locale, "payments", seller, row.id),
		aftercareHref = salesHref(locale, "aftercare", seller, row.id),
		disputesHref = sellerHref(locale, "disputes", seller);

	const title = (g: Detail["goods"][number]) =>
		g.titles?.[locale] ?? g.titles?.[g.source_locale] ?? g.sku;
	const unit = (g: Detail["goods"][number]) =>
		g.unit_labels?.[locale] ?? g.unit;

	function primary(): PrimaryAction {
		if (stage === 1)
			return !row.arrangement
				? inModes("arrange")
					? { kind: "form", mode: "arrange" }
					: null
				: inModes("prepare")
					? { kind: "form", mode: "prepare" }
					: null;
		if (stage === 2) {
			if (row.cancellation_hold)
				return can("aftercare")
					? {
							kind: "link",
							href: aftercareHref,
							label: t.cancellation,
							icon: RotateCcw,
						}
					: { kind: "note", note: t.cancellation };
			if (row.dispute_open)
				return can("disputes")
					? { kind: "link", href: disputesHref, label: t.dispute, icon: Shield }
					: { kind: "note", note: t.dispute };
			if (!chargeReady)
				return sellerArranged && !pendingCharge && inModes("charge")
					? { kind: "form", mode: "charge" }
					: { kind: "note", note: w.chargePending };
			if (advance && !goodsPaid)
				return can("payments")
					? {
							kind: "link",
							href: paymentsHref,
							label: w.recordPayment,
							icon: Wallet,
						}
					: { kind: "note", note: t.positive_funds_and_partial_permission };
			return inModes("dispatch") ? { kind: "form", mode: "dispatch" } : null;
		}
		return row.stage === "dispatched" && inModes("deliver")
			? { kind: "form", mode: "deliver" }
			: null;
	}
	const next = primary();

	return (
		<div className="min-w-0 space-y-5">
			<header className="min-w-0 space-y-3">
				<Link
					href={ordersHref}
					className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-action"
				>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{w.backToOrder}
				</Link>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1.5">
						<h1
							className="text-2xl font-bold tracking-tight"
							tabIndex={-1}
							data-fulfilment-summary
						>
							{t.sellerTitle} · <bdi>{row.number}</bdi>
						</h1>
						<p className="m-0 text-sm text-muted">
							{w.customer}:{" "}
							{row.buyer ? <span dir="auto">{row.buyer}</span> : "—"}
						</p>
						<p className="m-0 text-sm text-muted">
							{w.products}: <bdi>{row.goods.length}</bdi>
							<span className="mx-1.5" aria-hidden="true">
								·
							</span>
							<Money amount={row.goods_total} currency={row.currency} />
						</p>
						<div className="flex flex-wrap items-center gap-2 pt-1">
							<Badge
								variant="secondary"
								className="border-0 bg-info text-action"
							>
								{fulfilmentState(locale, row.stage)}
							</Badge>
							{row.cancellation_hold && (
								<Badge
									variant="secondary"
									className="border-0 bg-warning-surface text-warning"
								>
									{t.cancellation}
								</Badge>
							)}
							{row.dispute_open && (
								<Badge
									variant="secondary"
									className="border-0 bg-danger-surface text-danger"
								>
									{t.dispute}
								</Badge>
							)}
						</div>
					</div>
					<div className="flex items-start gap-2">
						{exceptionModes.length > 0 && (
							<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										aria-label={w.moreActions}
										title={w.moreActions}
										className="size-9 rounded-lg border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
									>
										<MoreHorizontal className="size-5" aria-hidden="true" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									sideOffset={6}
									className="w-64 rounded-xl p-1.5"
								>
									{exceptionModes.map(([mode, label]) => {
										const ItemIcon = MODE_ICONS[mode] ?? Package;
										return (
											<DropdownMenuItem
												key={mode}
												className="gap-2.5"
												onSelect={() => setException(mode)}
											>
												<ItemIcon aria-hidden="true" />
												{label}
											</DropdownMenuItem>
										);
									})}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</div>
			</header>

			<section className={salesPanel}>
				<ProgressSteps locale={locale} stage={stage} />
			</section>

			{!online && <p role="status">{t.offline}</p>}
			{(error || Boolean(command.error)) && <p role="alert">{t.error}</p>}
			{command.absent && <p role="status">{t.absent}</p>}
			{command.locked && (
				<section
					className={salesPanel}
					role="status"
					tabIndex={-1}
					data-fulfilment-pending
				>
					<p>{t.uncertain}</p>
					<button
						type="button"
						className={salesAction}
						disabled={command.busy || !online}
						onClick={() => void command.reconcile()}
					>
						{t.reconcile}
					</button>
				</section>
			)}

			{exception && inModes(exception) && (
				<section className={salesPanel}>
					<header className="flex items-center justify-between gap-3">
						<h2 className="text-base font-semibold">
							{modes.find(([value]) => value === exception)?.[1]}
						</h2>
						<button
							type="button"
							className={salesAction}
							onClick={() => setException(null)}
						>
							{t.cancel}
						</button>
					</header>
					{renderForm(exception)}
				</section>
			)}

			<StageOne
				locale={locale}
				row={row}
				stage={stage}
				title={title}
				unit={unit}
				renderForm={renderForm}
				next={next}
			/>
			<StageTwo
				locale={locale}
				row={row}
				stage={stage}
				checks={[
					{ label: w.checkProducts, ok: true },
					{ label: w.checkRecipient, ok: true },
					{ label: w.checkArrangement, ok: true },
					{
						label: t.finalCharge,
						ok: chargeReady,
						note: chargeReady
							? undefined
							: pendingCharge
								? w.chargePending
								: sellerArranged
									? undefined
									: w.chargePending,
					},
					{
						label: w.checkPayment,
						ok: goodsPaid,
						note: goodsPaid
							? undefined
							: t.positive_funds_and_partial_permission,
					},
					{ label: w.checkHolds, ok: holdsOk },
				]}
				renderForm={renderForm}
				next={next}
			/>
			<StageThree
				locale={locale}
				row={row}
				stage={stage}
				handover={handover}
				downloading={downloading}
				renderForm={renderForm}
				next={next}
			/>

			<details className="group/activity rounded-xl border border-solid border-border bg-surface shadow-none">
				<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-action [&::-webkit-details-marker]:hidden">
					<span>{w.activity}</span>
					<ChevronRight
						className="size-4 text-muted transition-transform group-open/activity:rotate-90 motion-reduce:transition-none rtl:rotate-180"
						aria-hidden="true"
					/>
				</summary>
				<div className="px-4 pb-4 sm:px-5">
					<DeliveryHistory
						{...{ locale, context: "seller" as const, row, seller, page }}
						embedded
						returnParams={params}
					/>
				</div>
			</details>

			{review && row.capabilities[review.capability] && (
				<DeliveryReview
					{...{ locale, context: "seller" as const, review, row }}
					busy={command.locked}
					opener={opener.current}
					cancel={() => setReview(null)}
					confirm={() => {
						if (command.locked || !row.capabilities[review.capability]) return;
						void command.send(review.intent).then(() => setReview(null));
					}}
				/>
			)}
		</div>
	);
}

function ProgressSteps({ locale, stage }: { locale: Locale; stage: number }) {
	const w = workflowCopy[locale],
		stages = [w.stagePreparation, w.stageDispatch, w.stageDelivery];
	return (
		<ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
			{stages.map((label, i) => {
				const n = i + 1,
					done = n < stage,
					current = n === stage;
				return (
					<li key={label} className="flex items-center gap-2">
						{i > 0 && (
							<ChevronRight
								className="size-4 text-muted rtl:rotate-180"
								aria-hidden="true"
							/>
						)}
						<span
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
								done
									? "bg-success-surface text-success"
									: current
										? "bg-info text-action"
										: "bg-page text-muted",
							)}
						>
							{done ? (
								<Check className="size-3.5" aria-hidden="true" />
							) : (
								<span
									className={cn(
										"flex size-4 items-center justify-center rounded-full text-[10px]",
										current ? "bg-action text-white" : "bg-muted text-white",
									)}
									aria-hidden="true"
								>
									{n}
								</span>
							)}
							{label}
							<span className="sr-only">
								{done
									? w.stageComplete
									: current
										? w.stageCurrent
										: w.stageUpcoming}
							</span>
						</span>
					</li>
				);
			})}
		</ol>
	);
}

function StageCard({
	locale,
	index,
	title,
	state,
	children,
}: {
	locale: Locale;
	index: number;
	title: string;
	state: "done" | "current" | "upcoming";
	children?: ReactNode;
}) {
	const w = workflowCopy[locale];
	const header = (
		<header className="flex items-center gap-3">
			<StepBadge index={index} done={state === "done"} />
			<h2 className="text-base font-semibold">{title}</h2>
			<span
				className={cn(
					"text-xs font-medium",
					state === "done"
						? "text-success"
						: state === "current"
							? "text-action"
							: "text-muted",
				)}
			>
				{state === "done"
					? w.stageComplete
					: state === "current"
						? w.stageCurrent
						: w.stageUpcoming}
			</span>
		</header>
	);
	if (state === "upcoming")
		return (
			<section className={cn(salesPanel, "opacity-60")} aria-disabled="true">
				{header}
			</section>
		);
	if (state === "done")
		return (
			<details className={cn(salesPanel, "group")}>
				<summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
					{header}
				</summary>
				<div className="pt-4">{children}</div>
			</details>
		);
	return (
		<section className={cn(salesPanel, "space-y-4")}>
			{header}
			{children}
		</section>
	);
}

function StepBadge({ index, done }: { index: number; done: boolean }) {
	return (
		<span
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
				done ? "bg-success-surface text-success" : "bg-info text-action",
			)}
			aria-hidden="true"
		>
			{done ? <Check className="size-3.5" /> : index}
		</span>
	);
}

function StageOne({
	locale,
	row,
	stage,
	title,
	unit,
	renderForm,
	next,
}: {
	locale: Locale;
	row: Detail;
	stage: number;
	title: (g: Detail["goods"][number]) => string;
	unit: (g: Detail["goods"][number]) => string;
	renderForm: (mode: Mode) => ReactNode;
	next: PrimaryAction;
}) {
	const t = fulfilmentCopy[locale],
		w = workflowCopy[locale],
		done = stage > 1,
		current = stage === 1;
	const content = (
		<div className="mt-4 space-y-5">
			<ul className="m-0 space-y-3 p-0">
				{row.goods.map((g) => (
					<li key={`${g.variant}:${g.tier}`} className="flex items-start gap-3">
						<ProductThumbnail src={g.image} className="size-12" />
						<div className="min-w-0 flex-1">
							<p className="m-0 break-words text-sm font-semibold" dir="auto">
								{title(g)}
							</p>
							<p className="m-0 text-xs text-muted">
								{g.sku}
								<span className="mx-1.5" aria-hidden="true">
									·
								</span>
								{t.required}{" "}
								<bdi>
									{g.quantity.replace(/\.000$/, "")} {unit(g)}
								</bdi>
							</p>
						</div>
					</li>
				))}
			</ul>
			{row.payment_method === "advance" && row.held_lines.length > 0 && (
				<p className="m-0 text-xs text-muted">
					{t.reserved}: {row.held_lines.length}
				</p>
			)}
			{row.recipient && (
				<div className="rounded-control border border-border p-3 text-sm">
					<p className="m-0 font-semibold">{t.recipient}</p>
					<p className="m-0" dir="auto">
						{row.recipient.name}
					</p>
					<p className="m-0">
						<bdi dir="ltr">{row.recipient.phone}</bdi>
					</p>
					<p className="m-0 break-words whitespace-pre-wrap">
						{row.recipient.address}
					</p>
					{row.recipient.instructions && (
						<p className="m-0 break-words whitespace-pre-wrap text-muted">
							{row.recipient.instructions}
						</p>
					)}
				</div>
			)}
			{row.arrangement ? (
				<div className="rounded-control border border-border p-3 text-sm">
					<p className="m-0 font-semibold">{t.arrangement}</p>
					<p className="m-0">
						{t.provider}: <bdi>{row.arrangement.provider}</bdi> ·{" "}
						{fulfilmentState(locale, row.arrangement.arranger)}
					</p>
					{row.arrangement.instructions && (
						<p className="m-0 break-words whitespace-pre-wrap text-muted">
							{row.arrangement.instructions}
						</p>
					)}
				</div>
			) : null}
			{row.stage === "needs_preparation" && (
				<p role="status" className="m-0 text-sm font-medium text-warning">
					{t.needPreparation}
				</p>
			)}
			{current &&
				next &&
				(next.kind === "form" ? (
					<div className="space-y-2">
						<p className="m-0 text-sm font-semibold">{w.nextAction}</p>
						{renderForm(next.mode)}
					</div>
				) : next.kind === "link" ? (
					<Button asChild className="rounded-xl">
						<Link href={next.href}>{next.label}</Link>
					</Button>
				) : null)}
		</div>
	);
	return (
		<StageCard
			locale={locale}
			index={1}
			title={w.stagePreparation}
			state={done ? "done" : "current"}
		>
			{content}
		</StageCard>
	);
}

function StageTwo({
	locale,
	row,
	stage,
	checks,
	renderForm,
	next,
}: {
	locale: Locale;
	row: Detail;
	stage: number;
	checks: { label: string; ok: boolean; note?: string }[];
	renderForm: (mode: Mode) => ReactNode;
	next: PrimaryAction;
}) {
	const t = fulfilmentCopy[locale],
		w = workflowCopy[locale],
		done = stage > 2,
		current = stage === 2;
	const content = (
		<div className="mt-4 space-y-5">
			<p className="m-0 text-sm font-semibold">{w.checklist}</p>
			<ul className="m-0 space-y-1 p-0">
				{checks.map((check) => (
					<li
						key={check.label}
						className="flex flex-wrap items-center justify-between gap-2 py-1"
					>
						<span className="flex items-center gap-2 text-sm">
							{check.ok ? (
								<Check className="size-4 text-success" aria-hidden="true" />
							) : (
								<AlertTriangle
									className="size-4 text-warning"
									aria-hidden="true"
								/>
							)}
							{check.label}
						</span>
						{!check.ok && check.note && (
							<span className="text-xs text-muted">{check.note}</span>
						)}
					</li>
				))}
			</ul>
			{current &&
				next &&
				(next.kind === "form" ? (
					<div className="space-y-2">
						<p className="m-0 text-sm font-semibold">{w.nextAction}</p>
						{renderForm(next.mode)}
					</div>
				) : next.kind === "link" ? (
					<div className="space-y-2">
						<p className="m-0 text-sm font-semibold">{w.nextAction}</p>
						<Button asChild className="rounded-xl">
							<Link href={next.href}>
								<next.icon className="size-4" aria-hidden="true" />
								{next.label}
							</Link>
						</Button>
					</div>
				) : next.kind === "note" ? (
					<p role="status" className="m-0 text-sm text-muted">
						{next.note}
					</p>
				) : null)}
			{row.dispatch_problem && !done && (
				<p className="m-0 text-xs text-muted">
					{t.lastAttempt}: {fulfilmentState(locale, row.dispatch_problem)}
				</p>
			)}
		</div>
	);
	return (
		<StageCard
			locale={locale}
			index={2}
			title={w.stageDispatch}
			state={done ? "done" : current ? "current" : "upcoming"}
		>
			{content}
		</StageCard>
	);
}

function StageThree({
	locale,
	row,
	stage,
	handover,
	downloading,
	renderForm,
	next,
}: {
	locale: Locale;
	row: Detail;
	stage: number;
	handover: (kind: "html" | "pdf") => void;
	downloading: boolean;
	renderForm: (mode: Mode) => ReactNode;
	next: PrimaryAction;
}) {
	const t = fulfilmentCopy[locale],
		w = workflowCopy[locale],
		done = row.stage === "delivered",
		current = stage === 3;
	const content = (
		<div className="mt-4 space-y-5">
			{row.stage === "dispatched" && (
				<>
					<p className="m-0 text-sm">
						{w.dispatchedTo}
						{row.tracking.length > 0 && (
							<>
								<span className="mx-1.5" aria-hidden="true">
									·
								</span>
								<bdi>{row.tracking.length}</bdi>
							</>
						)}
					</p>
					{row.tracking.length === 0 ? (
						<p className="m-0 text-xs text-muted">{w.noTracking}</p>
					) : (
						<ul className="m-0 space-y-1 p-0">
							{row.tracking.map((tracking) => (
								<li key={tracking.id} className="text-sm">
									<bdi>{tracking.reference}</bdi> ·{" "}
									<bdi>{localTimestamp(tracking.occurred_at, locale)}</bdi>
								</li>
							))}
						</ul>
					)}
					{row.capabilities.handover && (
						<div className="flex flex-wrap gap-3">
							<button
								type="button"
								className={salesAction}
								disabled={downloading}
								onClick={() => handover("html")}
							>
								{t.handover}
							</button>
							<button
								type="button"
								className={salesAction}
								disabled={downloading}
								onClick={() => handover("pdf")}
							>
								{t.handoverPdf}
							</button>
						</div>
					)}
				</>
			)}
			{row.stage === "delivered" && row.delivery && (
				<p className="m-0 text-sm">
					{w.deliveredAt}:{" "}
					<bdi>{localTimestamp(row.delivery.occurred_at, locale)}</bdi> ·{" "}
					{fulfilmentState(locale, row.delivery.source)}
				</p>
			)}
			{row.stage === "delivered" && (
				<p className="m-0 text-sm">
					{t.completion}: {fulfilmentState(locale, row.completion)}
				</p>
			)}
			{row.completion === "incomplete" && (
				<p className="m-0 text-xs text-muted">{t.noAuto}</p>
			)}
			{current &&
				next &&
				(next.kind === "form" ? (
					<div className="space-y-4">
						<div className="space-y-2">
							<p className="m-0 text-sm font-semibold">{w.nextAction}</p>
							{renderForm(next.mode)}
						</div>
						{row.capabilities.tracking && (
							<div className="space-y-2">
								<p className="m-0 text-sm font-semibold">{t.recordTracking}</p>
								{renderForm("tracking")}
							</div>
						)}
					</div>
				) : null)}
		</div>
	);
	return (
		<StageCard
			locale={locale}
			index={3}
			title={w.stageDelivery}
			state={done ? "done" : current ? "current" : "upcoming"}
		>
			{content}
		</StageCard>
	);
}
