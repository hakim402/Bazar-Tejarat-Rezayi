"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { DashboardCard } from "../../components/ui/dashboard-card";
import { EmptyState } from "../../components/ui/empty-state";
import { Alert } from "../../components/ui/alert";
import { Field, Input, Select } from "../../components/ui/form-field";
import { PageHeader } from "../../components/ui/page-header";
import { StatCardSkeleton } from "../../components/ui/skeleton";
import { StatCard } from "../../components/ui/stat-card";
import type { IconName } from "../../components/ui/icon";
import type { Locale } from "../../lib/i18n/locales";
import { AccountError } from "../../lib/api/private-client.ts";
import { sellerHref } from "../../lib/routes/account-routes";
import {
	buyerSummary,
	downloadExport,
	reportProfiles,
	sellerSummary,
	type BuyerSummary,
	type ExportKind,
	type Period,
	type ReportProfile,
	type SellerSummary,
} from "./api";
import { reportCopy } from "./copy";

type Context = "seller" | "buyer";
type Summary = SellerSummary | BuyerSummary;
type QueueKey = keyof (typeof reportCopy)["en"]["queues"];

const queueRoutes: Record<Context, Partial<Record<QueueKey, string>>> = {
	seller: {
		awaiting_dispatch: "fulfilment",
		cancellations: "aftercare",
		amendments: "aftercare",
		disputes: "disputes",
		payment_reviews: "payments",
		delivery_reviews: "fulfilment",
		holds: "fulfilment",
	},
	buyer: { cancellations: "cancellations", disputes: "disputes", in_transit: "deliveries" },
};

const queueIcons: Record<QueueKey, IconName> = {
	awaiting_dispatch: "box",
	cancellations: "return",
	amendments: "file",
	disputes: "shield",
	reviews_pending: "star",
	payment_reviews: "wallet",
	delivery_reviews: "truck",
	holds: "alert-triangle",
	in_transit: "truck",
};

function Amount({ value, currency }: { value: string; currency: string }) {
	return (
		<bdi dir="ltr" className="tabular-nums">
			{value} {currency}
		</bdi>
	);
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border py-2 first:border-t-0">
			<dt className="text-sm text-muted">{label}</dt>
			<dd className="font-semibold text-foreground">{children}</dd>
		</div>
	);
}

export function ReportsWorkspace({ locale, context }: { locale: Locale; context: Context }) {
	const t = reportCopy[locale];
	const query = useSearchParams();
	const router = useRouter();
	const [profiles, setProfiles] = useState<ReportProfile[] | null>(context === "buyer" ? [] : null);
	const [seller, setSeller] = useState(query.get("seller") ?? "");
	const [draft, setDraft] = useState<Period>({});
	const [period, setPeriod] = useState<Period>({});
	const [data, setData] = useState<Summary | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "failed" | "invalid">("loading");
	const [kind, setKind] = useState<ExportKind>("orders");
	const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle");

	useEffect(() => {
		if (context !== "seller") return;
		let live = true;
		reportProfiles()
			.then((result) => {
				if (!live) return;
				setProfiles(result.results);
				setSeller((current) =>
					result.results.some((item) => item.id === current) ? current : (result.results[0]?.id ?? ""),
				);
			})
			.catch(() => live && setState("failed"));
		return () => {
			live = false;
		};
	}, [context]);

	const load = useCallback(() => {
		if (context === "seller" && !seller) return;
		setState("loading");
		const request = context === "seller" ? sellerSummary(seller, period) : buyerSummary(period);
		let live = true;
		request
			.then((result) => {
				if (!live) return;
				setData(result);
				setDraft({ start: result.period.start, end: result.period.end });
				setState("ready");
			})
			.catch((error) => {
				if (live) setState(error instanceof AccountError && error.status === 400 ? "invalid" : "failed");
			});
		return () => {
			live = false;
		};
	}, [context, seller, period]);

	useEffect(() => load(), [load]);

	useEffect(() => {
		if (context === "seller" && seller && query.get("seller") !== seller)
			router.replace(sellerHref(locale, "reports", seller));
	}, [context, seller, query, router, locale]);

	const apply = (event: React.FormEvent) => {
		event.preventDefault();
		if (draft.start && draft.end && draft.start > draft.end) {
			setState("invalid");
			return;
		}
		setPeriod({ ...draft });
	};

	const download = async () => {
		setExporting("busy");
		try {
			await downloadExport(seller, kind, data ? { start: data.period.start, end: data.period.end } : period);
			setExporting("idle");
		} catch {
			setExporting("failed");
		}
	};

	const href = (route: string) =>
		context === "seller" ? sellerHref(locale, route, seller) : `/${locale}/account/buyer/${route}`;

	if (context === "seller" && profiles?.length === 0)
		return (
			<div className="space-y-6">
				<PageHeader title={t.sellerTitle} description={t.sellerDescription} />
				<EmptyState icon="trending-up" title={t.noAccess} description={t.noAccessHint} />
			</div>
		);

	const number = new Intl.NumberFormat(locale);
	const canExport =
		context === "seller" &&
		!!data &&
		(kind === "orders" ? data.sections.orders : data.sections.finance);

	return (
		<div className="space-y-6">
			<PageHeader
				title={context === "seller" ? t.sellerTitle : t.buyerTitle}
				description={context === "seller" ? t.sellerDescription : t.buyerDescription}
				actions={
					context === "seller" && data ? (
						<div className="flex flex-wrap items-end gap-2">
							<Field name="report-kind" compact label={t.export}>
								<Select
									name="report-kind"
									value={kind}
									onChange={(event) => setKind(event.target.value as ExportKind)}
									className="min-h-10! py-1.5! text-sm"
								>
									{data.sections.orders && <option value="orders">{t.exportOrders}</option>}
									{data.sections.finance && <option value="payments">{t.exportPayments}</option>}
									{data.sections.finance && <option value="refunds">{t.exportRefunds}</option>}
								</Select>
							</Field>
							<Button variant="compact" compact className="mt-0!" disabled={!canExport || exporting === "busy"} onClick={download}>
								{exporting === "busy" ? t.exporting : t.export}
							</Button>
						</div>
					) : undefined
				}
			/>
			{exporting === "failed" && <Alert role="alert">{t.exportFailed}</Alert>}

			<form onSubmit={apply} className="flex flex-wrap items-end gap-3">
				{context === "seller" && profiles && profiles.length > 0 && (
					<Field name="report-seller" compact label={t.business}>
						<Select
							name="report-seller"
							value={seller}
							onChange={(event) => {
								setSeller(event.target.value);
								setData(null);
							}}
							className="min-h-10! py-1.5! text-sm"
						>
							{profiles.map((profile) => (
								<option key={profile.id} value={profile.id}>
									{profile.name}
								</option>
							))}
						</Select>
					</Field>
				)}
				<Field name="report-start" compact label={t.from}>
					<Input
						compact
						type="date"
						name="report-start"
						dir="ltr"
						value={draft.start ?? ""}
						onChange={(event) => setDraft((value) => ({ ...value, start: event.target.value || undefined }))}
					/>
				</Field>
				<Field name="report-end" compact label={t.to}>
					<Input
						compact
						type="date"
						name="report-end"
						dir="ltr"
						value={draft.end ?? ""}
						onChange={(event) => setDraft((value) => ({ ...value, end: event.target.value || undefined }))}
					/>
				</Field>
				<Button type="submit" variant="compact" compact className="mt-0!">
					{t.apply}
				</Button>
			</form>
			<p className="text-sm text-muted">{t.separate}</p>

			{state === "invalid" && <Alert role="alert">{t.invalidPeriod}</Alert>}
			{state === "failed" && (
				<div role="alert" className="flex flex-wrap items-center gap-3">
					<Alert className="m-0!">{t.failed}</Alert>
					<Button variant="secondary" compact className="mt-0!" onClick={load}>
						{t.retry}
					</Button>
				</div>
			)}
			{state === "loading" && !data && (
				<div className="grid gap-4 sm:grid-cols-3" role="status" aria-label={t.loading}>
					<StatCardSkeleton />
					<StatCardSkeleton />
					<StatCardSkeleton />
				</div>
			)}

			{data && (
				<div className={`space-y-6 ${state === "loading" ? "opacity-60" : ""}`} aria-busy={state === "loading"}>
					{data.logistics && (
						<div className="grid gap-4 sm:grid-cols-3">
							<StatCard icon="truck" label={t.dispatched} value={data.logistics.dispatched} locale={locale} />
							<StatCard icon="box" chip="accent" label={t.delivered} value={data.logistics.delivered} locale={locale} />
							<StatCard icon="check-circle" chip="success" label={t.completed} value={data.logistics.completed} locale={locale} />
						</div>
					)}

					<div className="grid gap-4 lg:grid-cols-2">
						{data.orders && (
							<DashboardCard title={t.ordersTitle}>
								{data.orders.length === 0 ? (
									<p className="text-sm text-muted">{t.noOrders}</p>
								) : (
									<div className="space-y-4">
										{data.orders.map((row) => (
											<dl key={row.currency}>
												<p className="mb-1 font-bold text-foreground">{row.currency}</p>
												<Figure label={t.accepted}>{number.format(row.accepted)}</Figure>
												<Figure label={t.cancelled}>{number.format(row.cancelled)}</Figure>
												<Figure label={t.goodsTotal}>
													<Amount value={row.goods_total} currency={row.currency} />
												</Figure>
												<Figure label={t.acceptedTotal}>
													<Amount value={row.accepted_total} currency={row.currency} />
												</Figure>
											</dl>
										))}
									</div>
								)}
							</DashboardCard>
						)}
						{data.finance && (
							<DashboardCard title={t.financeTitle}>
								{data.finance.length === 0 ? (
									<p className="text-sm text-muted">{t.noMoney}</p>
								) : (
									<div className="space-y-4">
										{data.finance.map((row) => (
											<dl key={row.currency}>
												<p className="mb-1 font-bold text-foreground">{row.currency}</p>
												<Figure label={context === "seller" ? t.goodsReceived : t.buyerPaid}>
													<Amount value={row.goods_received} currency={row.currency} />
												</Figure>
												<Figure label={t.receipts}>{number.format(row.goods_receipts)}</Figure>
												<Figure label={context === "seller" ? t.goodsRefunded : t.buyerRefunded}>
													<Amount value={row.goods_refunded} currency={row.currency} />
												</Figure>
												<Figure label={t.goodsNet}>
													<Amount value={row.goods_net} currency={row.currency} />
												</Figure>
												<Figure label={t.refundDue}>
													<Amount value={row.refund_due_created} currency={row.currency} />
												</Figure>
												<Figure label={context === "seller" ? t.deliveryReceived : t.buyerDelivery}>
													<Amount value={row.delivery_received} currency={row.currency} />
												</Figure>
												<Figure label={t.deliveryRefunded}>
													<Amount value={row.delivery_refunded} currency={row.currency} />
												</Figure>
											</dl>
										))}
									</div>
								)}
							</DashboardCard>
						)}
					</div>

					{Object.keys(data.queues).length > 0 && (
						<DashboardCard title={t.queuesTitle} description={t.queuesHint}>
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
								{(Object.entries(data.queues) as [QueueKey, number | undefined][]).map(([key, value]) =>
									value === undefined ? null : (
										<StatCard
											key={key}
											icon={queueIcons[key]}
											chip="warning"
											label={t.queues[key]}
											value={value}
											locale={locale}
											href={queueRoutes[context][key] ? href(queueRoutes[context][key]) : undefined}
										/>
									),
								)}
							</div>
						</DashboardCard>
					)}

					<p className="text-caption text-muted">
						{t.generated}{" "}
						<bdi>
							{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
								new Date(data.generated_at),
							)}
						</bdi>
						{context === "seller" ? ` · ${t.exportNote}` : ""}
					</p>
				</div>
			)}
		</div>
	);
}
