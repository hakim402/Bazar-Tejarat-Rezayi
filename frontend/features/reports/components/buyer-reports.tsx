"use client";
import Link from "next/link";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { Button } from "../../../components/shadcn/button";
import { Input } from "../../../components/shadcn/input";
import { Badge } from "../../../components/shadcn/badge";
import { Icon, type IconName } from "../../../components/ui/icon";
import { StatCard } from "../../../components/ui/stat-card";
import { Figure } from "./figure";
import { DetailCard, Money } from "../../orders/components/order-ui";
import type { Locale } from "../../../lib/i18n/locales";
import { reportCopy } from "../copy";
import type { BuyerSummary, Period } from "../api";

const buyerQueues: {
	key: keyof BuyerSummary["queues"];
	icon: IconName;
	route: string;
}[] = [
	{ key: "in_transit", icon: "truck", route: "deliveries" },
	{ key: "cancellations", icon: "return", route: "cancellations" },
	{ key: "disputes", icon: "shield", route: "disputes" },
];

const presets = ["last30", "last90", "thisYear"] as const;
type Preset = (typeof presets)[number];

function isoDate(date: Date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function presetRange(key: Preset): Period {
	const end = new Date();
	if (key === "thisYear")
		return { start: `${end.getFullYear()}-01-01`, end: isoDate(end) };
	const start = new Date(end);
	start.setDate(start.getDate() - (key === "last30" ? 29 : 89));
	return { start: isoDate(start), end: isoDate(end) };
}

type FigureValue = string | { amount: string; currency: string };
type FigureRow = [label: string, value: FigureValue, strong?: boolean];

function Figures({ rows }: { rows: FigureRow[] }) {
	return (
		<dl className="m-0 flex flex-col">
			{rows.map(([label, value, strong]) => (
				<Figure key={label} label={label} strong={strong}>
					{typeof value === "string" ? (
						value
					) : (
						<Money amount={value.amount} currency={value.currency} />
					)}
				</Figure>
			))}
		</dl>
	);
}

function CurrencyBlock({
	currency,
	children,
}: {
	currency: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Badge
				variant="secondary"
				className="self-start rounded-full border-0 bg-page text-muted"
			>
				<bdi>{currency}</bdi>
			</Badge>
			{children}
		</div>
	);
}

function GroupLabel({ children }: { children: ReactNode }) {
	return (
		<p className="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
			{children}
		</p>
	);
}

export function BuyerReports({
	locale,
	draft,
	setDraft,
	setPeriod,
	apply,
	state,
	data,
	onRetry,
}: {
	locale: Locale;
	draft: Period;
	setDraft: Dispatch<SetStateAction<Period>>;
	setPeriod: Dispatch<SetStateAction<Period>>;
	apply: (event: FormEvent) => void;
	state: "loading" | "ready" | "failed" | "invalid";
	data: BuyerSummary | null;
	onRetry: () => void;
}) {
	const t = reportCopy[locale],
		number = new Intl.NumberFormat(locale);
	const activePreset = presets.find((key) => {
		const range = presetRange(key);
		return range.start === draft.start && range.end === draft.end;
	});
	const openQueues = data
		? buyerQueues.filter((queue) => (data.queues[queue.key] ?? 0) > 0)
		: [];
	const choose = (key: Preset) => {
		const range = presetRange(key);
		setDraft(range);
		setPeriod(range);
	};
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<header className="min-w-0">
				<h1 className="m-0 text-2xl font-bold">{t.buyerTitle}</h1>
				<p className="m-0 mt-1 text-sm text-muted">{t.buyerDescription}</p>
			</header>

			<form
				onSubmit={apply}
				className="flex flex-col gap-3 rounded-card border border-solid border-border bg-surface p-4"
			>
				<fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
					<legend className="sr-only">{t.quickRanges}</legend>
					{presets.map((key) => (
						<Button
							key={key}
							type="button"
							size="sm"
							variant={activePreset === key ? "default" : "outline"}
							className="rounded-full"
							aria-pressed={activePreset === key}
							onClick={() => choose(key)}
						>
							{t[key]}
						</Button>
					))}
				</fieldset>
				<div className="flex flex-wrap items-end gap-3">
					<div className="grid min-w-0 flex-1 gap-1.5 sm:flex-none">
						<label
							htmlFor="report-start"
							className="text-xs font-medium text-muted"
						>
							{t.from}
						</label>
						<Input
							id="report-start"
							type="date"
							dir="ltr"
							className="h-10 w-full rounded-lg sm:w-44"
							value={draft.start ?? ""}
							onChange={(event) =>
								setDraft((value) => ({
									...value,
									start: event.target.value || undefined,
								}))
							}
						/>
					</div>
					<div className="grid min-w-0 flex-1 gap-1.5 sm:flex-none">
						<label
							htmlFor="report-end"
							className="text-xs font-medium text-muted"
						>
							{t.to}
						</label>
						<Input
							id="report-end"
							type="date"
							dir="ltr"
							className="h-10 w-full rounded-lg sm:w-44"
							value={draft.end ?? ""}
							onChange={(event) =>
								setDraft((value) => ({
									...value,
									end: event.target.value || undefined,
								}))
							}
						/>
					</div>
					<Button type="submit" className="rounded-lg">
						{t.apply}
					</Button>
				</div>
				<p className="m-0 text-xs text-muted">{t.separate}</p>
			</form>

			{state === "invalid" && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-surface p-4 text-sm text-warning"
				>
					<Icon name="alert-triangle" className="size-4 shrink-0" />
					<p className="m-0">{t.invalidPeriod}</p>
				</div>
			)}
			{state === "failed" && (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger/40 bg-danger-surface p-4"
				>
					<p className="m-0 flex items-center gap-2 text-sm font-medium text-danger">
						<Icon name="alert-triangle" className="size-4 shrink-0" />
						{t.failed}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="rounded-lg"
						onClick={onRetry}
					>
						{t.retry}
					</Button>
				</div>
			)}
			{state === "loading" && !data && (
				<div
					role="status"
					className="rounded-card border border-solid border-border bg-surface p-6 text-sm text-muted"
				>
					{t.loading}…
				</div>
			)}

			{data && (
				<div
					className={`flex flex-col gap-5 ${state === "loading" ? "opacity-60" : ""}`}
					aria-busy={state === "loading"}
				>
					{data.logistics && (
						<div className="grid gap-4 sm:grid-cols-3">
							<StatCard
								flat
								icon="truck"
								label={t.dispatched}
								value={data.logistics.dispatched}
								locale={locale}
							/>
							<StatCard
								flat
								icon="box"
								label={t.delivered}
								value={data.logistics.delivered}
								locale={locale}
							/>
							<StatCard
								flat
								icon="check-circle"
								label={t.completed}
								value={data.logistics.completed}
								locale={locale}
							/>
						</div>
					)}

					<div className="grid items-start gap-4 lg:grid-cols-2">
						{data.orders && (
							<DetailCard title={t.ordersTitle} icon="shopping-bag">
								{data.orders.length === 0 ? (
									<p className="m-0 text-sm text-muted">{t.noOrders}</p>
								) : (
									<div className="flex flex-col gap-5">
										{data.orders.map((row) => (
											<CurrencyBlock key={row.currency} currency={row.currency}>
												<Figures
													rows={[
														[t.accepted, number.format(row.accepted)],
														[t.cancelled, number.format(row.cancelled)],
														[
															t.goodsTotal,
															{
																amount: row.goods_total,
																currency: row.currency,
															},
														],
														[
															t.acceptedTotal,
															{
																amount: row.accepted_total,
																currency: row.currency,
															},
															true,
														],
													]}
												/>
											</CurrencyBlock>
										))}
									</div>
								)}
							</DetailCard>
						)}
						{data.finance && (
							<DetailCard title={t.financeTitle} icon="wallet">
								{data.finance.length === 0 ? (
									<p className="m-0 text-sm text-muted">{t.noMoney}</p>
								) : (
									<div className="flex flex-col gap-5">
										{data.finance.map((row) => (
											<CurrencyBlock key={row.currency} currency={row.currency}>
												<div className="flex flex-col gap-4">
													<div>
														<GroupLabel>{t.goodsGroup}</GroupLabel>
														<Figures
															rows={[
																[
																	t.buyerPaid,
																	{
																		amount: row.goods_received,
																		currency: row.currency,
																	},
																],
																[t.receipts, number.format(row.goods_receipts)],
																[
																	t.buyerRefunded,
																	{
																		amount: row.goods_refunded,
																		currency: row.currency,
																	},
																],
																[
																	t.goodsNet,
																	{
																		amount: row.goods_net,
																		currency: row.currency,
																	},
																	true,
																],
																[
																	t.refundDue,
																	{
																		amount: row.refund_due_created,
																		currency: row.currency,
																	},
																],
															]}
														/>
													</div>
													<div>
														<GroupLabel>{t.deliveryGroup}</GroupLabel>
														<Figures
															rows={[
																[
																	t.buyerDelivery,
																	{
																		amount: row.delivery_received,
																		currency: row.currency,
																	},
																],
																[
																	t.deliveryRefunded,
																	{
																		amount: row.delivery_refunded,
																		currency: row.currency,
																	},
																],
															]}
														/>
													</div>
												</div>
											</CurrencyBlock>
										))}
									</div>
								)}
							</DetailCard>
						)}
					</div>

					<DetailCard title={t.queuesTitle} icon="inbox">
						{openQueues.length === 0 ? (
							<p className="m-0 flex items-center gap-2 rounded-xl border border-solid border-success/30 bg-success-surface px-3 py-2.5 text-sm font-medium text-success">
								<Icon name="check-circle" className="size-4 shrink-0" />
								{t.queuesClear}
							</p>
						) : (
							<div className="flex flex-col gap-3">
								<p className="m-0 text-xs text-muted">{t.queuesHint}</p>
								<ul className="m-0 flex list-none flex-col gap-2 p-0">
									{openQueues.map(({ key, icon, route }) => (
										<li key={key}>
											<Link
												href={`/${locale}/account/buyer/${route}`}
												className="flex items-center gap-3 rounded-xl border border-solid border-border px-3 py-2.5 no-underline transition-colors hover:border-action hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
											>
												<Icon
													name={icon}
													className="size-4 shrink-0 text-muted"
												/>
												<span className="min-w-0 flex-1 text-sm font-medium text-foreground">
													{t.queues[key]}
												</span>
												<Badge
													variant="secondary"
													className="rounded-full border-0 bg-info tabular-nums text-action"
												>
													{number.format(data.queues[key])}
												</Badge>
												<Icon
													name="chevron"
													className="size-4 shrink-0 text-muted"
												/>
											</Link>
										</li>
									))}
								</ul>
							</div>
						)}
					</DetailCard>

					<p className="m-0 text-caption text-muted">
						{t.generated}{" "}
						<bdi>
							{new Intl.DateTimeFormat(locale, {
								dateStyle: "medium",
								timeStyle: "short",
							}).format(new Date(data.generated_at))}
						</bdi>
					</p>
				</div>
			)}
		</div>
	);
}
