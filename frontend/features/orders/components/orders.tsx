"use client";
import { SessionEntry } from "./session-entry";
import {
	SalesFrame,
	SalesHeader,
	SalesBusinessSelect,
	SalesEmpty,
	SalesPagination,
	SalesRelated,
	salesHref,
	salesAction,
	salesPanel,
} from "../../sales/components/seller-sales-ui";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { Icon } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { AftercareSection } from "../../aftercare/section";
import Link from "next/link";
import { fulfilmentHref } from "../../fulfilment/api";
import { fulfilmentCopy, fulfilmentState } from "../../fulfilment/copy";
import { paymentHref } from "../../payments/api";
import { paymentCopy, paymentState } from "../../payments/copy";
import { negotiationCopy } from "../../negotiations/copy";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import type { Context } from "../../messaging/api";
import { localTimestamp } from "../../messaging/api";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import { uuidPattern } from "../../../lib/routes/account-routes";
import {
	commerce,
	invoiceHref,
	downloadInvoice,
	type Order,
	type Submission,
	type Profile,
	type Page,
} from "../api";
import { commerceCopy } from "../copy";
import { action, control, Failure, panel, Disclosure } from "./controls";
export type CommerceMode = "orders" | "invoices" | "checkouts";
export function OrdersWorkspace({
	locale,
	context,
	mode,
	id,
}: {
	locale: Locale;
	context: Context;
	mode: CommerceMode;
	id?: string;
}) {
	const s = useCommunicationSession(context),
		t = commerceCopy[locale],
		search = useSearchParams();
	if (s.loading) return <p role="status">{t.loading}</p>;
	if (!s.session)
		return <SessionEntry locale={locale} context={context} error={s.error} />;
	const seller = context === "seller" ? (search.get("seller") ?? "") : "",
		page = Number(search.get("page") ?? 1);
	if (
		(id && !uuidPattern.test(id)) ||
		(seller && !uuidPattern.test(seller)) ||
		!Number.isInteger(page) ||
		page < 1 ||
		page > 10000
	)
		return <p role="alert">{t.unavailable}</p>;
	return (
		<Reader
			key={`${s.session.identity.id}:${s.session.accounts[0].id}:${context}:${mode}:${id ?? ""}:${locale}:${seller}:${page}`}
			locale={locale}
			context={context}
			mode={mode}
			id={id}
			seller={seller}
			page={page}
		/>
	);
}
function Reader({
	locale,
	context,
	mode,
	id,
	seller,
	page,
}: {
	locale: Locale;
	context: Context;
	mode: CommerceMode;
	id?: string;
	seller: string;
	page: number;
}) {
	const t = commerceCopy[locale],
		router = useRouter(),
		search = useSearchParams(),
		[data, setData] = useState<
			Page<Order> | Order | Page<Submission> | Submission | null
		>(null),
		[profiles, setProfiles] = useState<Profile[]>([]),
		[error, setError] = useState<unknown>(),
		[busy, setBusy] = useState(false),
		[reload, setReload] = useState(0),
		live = useRef<object | null>(null),
		owned = useRef<object | null>(null),
		download = useRef<AbortController | null>(null);
	useEffect(() => {
		void reload;
		const mine = {};
		live.current = mine;
		const controller = new AbortController();
		void (async () => {
			if (context === "seller") {
				const p = await commerce<{ results: Profile[] }>(
					"orders/seller/profiles/",
					undefined,
					"GET",
					controller.signal,
				);
				if (live.current !== mine) return;
				const allowed = p.results.filter((x) =>
					mode === "invoices" ? x.invoices : x.orders,
				);
				setProfiles(allowed);
				if (!allowed.length) {
					setData({ results: [], count: 0, page });
					setError(null);
					return;
				}
				if (!seller && !id) {
					router.replace(
						salesHref(
							locale,
							mode === "invoices" ? "invoices" : "orders",
							allowed[0].id,
							undefined,
							undefined,
							{ page: String(page) },
						),
					);
					return;
				}
				if (seller && !allowed.some((x) => x.id === seller))
					throw new Error("scope");
			}
			const q = id
				? `?locale=${locale}`
				: `?page=${page}${seller ? `&seller=${seller}` : ""}&locale=${locale}`;
			const value = await commerce<typeof data>(
				`orders/${context}/${mode}/${id ? `${id}/` : ""}${q}`,
				undefined,
				"GET",
				controller.signal,
			);
			if (live.current === mine) {
				if (context === "seller" && value && "seller" in value) {
					if (!seller) {
						router.replace(
							salesHref(
								locale,
								mode === "invoices" ? "invoices" : "orders",
								value.seller,
								id,
							),
						);
						return;
					}
					if (value.seller !== seller) throw new Error("scope");
				}
				setData(value);
				setError(null);
			}
		})().catch((e) => {
			if (live.current === mine) {
				setData(null);
				setError(e);
			}
		});
		return () => {
			live.current = null;
			owned.current = null;
			controller.abort();
			download.current?.abort();
		};
	}, [context, mode, id, seller, locale, page, reload, router]);
	async function resume(sub: Submission) {
		if (owned.current) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		setBusy(true);
		try {
			const value = await commerce<Submission>(
				`orders/buyer/checkouts/${sub.id}/resume/`,
				{},
			);
			if (live.current === mine && owned.current === write) {
				if (id) setData(value);
				else setReload((x) => x + 1);
				setError(null);
			}
		} catch (e) {
			if (live.current === mine && owned.current === write) {
				if (accessLost(e)) setData(null);
				setError(e);
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function pdf(order: Order) {
		if (owned.current) return;
		const mine = live.current,
			write = {};
		owned.current = write;
		const c = new AbortController();
		download.current = c;
		setBusy(true);
		try {
			await downloadInvoice(context, order.invoice, locale, c.signal);
		} catch (e) {
			if (live.current === mine && owned.current === write) {
				if (accessLost(e)) setData(null);
				setError(e);
			}
		} finally {
			if (live.current === mine && owned.current === write) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	const title = mode === "checkouts" ? t.history : t[mode];
	if (context === "seller" && mode !== "checkouts") {
		const section = mode,
			copy = sellerSalesCopy[locale];
		return (
			<SalesFrame seller>
				<section className="min-w-0 space-y-6" data-testid="orders-workspace">
					<SalesHeader
						locale={locale}
						section={section}
						seller={seller}
						title={
							id && data && "number" in data ? (
								<>
									{copy[section]} · <bdi>{data.number}</bdi>
								</>
							) : undefined
						}
						back={
							id
								? salesHref(locale, section, seller, undefined, search)
								: undefined
						}
						business={
							<SalesBusinessSelect
								locale={locale}
								value={seller}
								profiles={profiles}
								onChange={(next) =>
									router.push(salesHref(locale, section, next))
								}
							/>
						}
					/>
					<Failure locale={locale} error={error} />
					{!data && !error && (
						<div className={`${salesPanel} min-h-40`} role="status">
							<p className="text-sm text-muted">{t.loading}</p>
						</div>
					)}
					{data &&
						("results" in data ? (
							<>
								{data.results.length === 0 ? (
									<SalesEmpty
										locale={locale}
										noBusiness={profiles.length === 0}
									/>
								) : (
									<div className="space-y-3">
										{data.results.map((row) =>
											"outcomes" in row ? null : (
												<article key={row.id} className={salesPanel}>
													<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
														<div className="min-w-0 space-y-2">
															<h2 className="text-lg font-semibold">
																<Link
																	className="inline-flex min-h-11 items-center gap-2 text-action"
																	href={salesHref(
																		locale,
																		section,
																		row.seller,
																		section === "invoices"
																			? row.invoice
																			: row.id,
																		search,
																	)}
																>
																	<Icon
																		name={
																			section === "invoices"
																				? "receipt"
																				: "shopping-bag"
																		}
																		className="size-5"
																	/>
																	<bdi>{row.number}</bdi>
																</Link>
															</h2>
															<p dir="auto" className="text-sm text-muted">
																{row.snapshot.buyer}
															</p>
															<p className="text-sm text-muted">
																<bdi>
																	{localTimestamp(row.accepted_at, locale)}
																</bdi>
															</p>
														</div>
														<div className="min-w-0 space-y-3">
															<p className="text-xs font-medium text-muted">
																{t.goods}
															</p>
															<p className="text-xl font-semibold tabular-nums">
																<bdi>
																	{row.goods_total} {row.currency}
																</bdi>
															</p>
															<div className="flex flex-wrap gap-2">
																<StatusBadge dot={false}>
																	{paymentState(
																		locale,
																		row.dimensions.financial,
																	)}
																</StatusBadge>
																<StatusBadge dot={false}>
																	{fulfilmentState(
																		locale,
																		row.dimensions.fulfilment,
																	)}
																</StatusBadge>
															</div>
														</div>
														<Link
															className={salesAction}
															href={salesHref(
																locale,
																section,
																row.seller,
																section === "invoices" ? row.invoice : row.id,
																search,
															)}
														>
															{copy.view}
															<Icon name="arrow" className="size-4" />
														</Link>
													</div>
												</article>
											),
										)}
									</div>
								)}
								<SalesPagination
									locale={locale}
									page={page}
									count={data.count}
									onPage={(next) =>
										router.push(
											salesHref(locale, section, seller, undefined, search, {
												page: String(next),
											}),
										)
									}
								/>
							</>
						) : "outcomes" in data ? null : (
							<>
								<SalesRelated
									locale={locale}
									seller={data.seller}
									links={[
										...(section === "invoices"
											? [{ section: "orders" as const, id: data.id }]
											: [{ section: "invoices" as const, id: data.invoice }]),
										{ section: "payments", id: data.id },
										{ section: "fulfilment", id: data.id },
									]}
								/>
								<OrderDocument
									order={data}
									locale={locale}
									context={context}
									seller={data.seller}
									busy={busy}
									pdf={() => void pdf(data)}
								/>
								<AftercareSection
									locale={locale}
									context={context}
									orderId={data.id}
									seller={data.seller}
								/>
							</>
						))}
					<button
						type="button"
						className={salesAction}
						disabled={busy}
						onClick={() => setReload((value) => value + 1)}
					>
						<Icon name="history" className="size-4" />
						{t.reload}
					</button>
				</section>
			</SalesFrame>
		);
	}
	return (
		<section className="min-w-0 space-y-5" data-testid="orders-workspace">
			<h1 className="text-3xl font-bold">{title}</h1>
			{context === "seller" && profiles.length > 0 && (
				<label className="block space-y-2">
					{t.business}
					<select
						aria-label={t.business}
						className={control}
						value={seller}
						onChange={(e) =>
							router.push(
								`/${locale}/account/seller/${mode}?seller=${e.target.value}`,
							)
						}
					>
						<option value="">{t.choose}</option>
						{profiles.map((x) => (
							<option key={x.id} value={x.id}>
								{x.name}
							</option>
						))}
					</select>
				</label>
			)}
			<Failure locale={locale} error={error} />
			{!data && !error ? (
				<p role="status">{t.loading}</p>
			) : (
				data &&
				("results" in data ? (
					<>
						<div className="space-y-4">
							{data.results.map((row) =>
								"outcomes" in row ? (
									<SubmissionCard
										key={row.id}
										row={row}
										locale={locale}
										busy={busy}
										resume={() => void resume(row)}
									/>
								) : (
									<article className={panel} key={row.id}>
										<Link
											className="inline-flex min-h-11 items-center font-bold text-action"
											href={
												mode === "invoices"
													? invoiceHref(locale, context, row.invoice, seller)
													: `/${locale}/account/${context}/orders/${row.id}${seller ? `?seller=${seller}` : ""}`
											}
										>
											<bdi>{row.number}</bdi>
										</Link>
										<p dir="auto">{row.snapshot.seller}</p>
										<p>
											<bdi>
												{row.goods_total} {row.currency}
											</bdi>{" "}
											· {paymentState(locale, row.dimensions.financial)} ·{" "}
											{fulfilmentState(locale, row.dimensions.fulfilment)}
										</p>
										<p>
											<bdi>{localTimestamp(row.accepted_at, locale)}</bdi>
										</p>
									</article>
								),
							)}
						</div>
						{data.results.length === 0 && <p>{t.empty}</p>}
						<div className="flex gap-3">
							<button
								type="button"
								className={action}
								disabled={page <= 1}
								onClick={() =>
									router.push(
										`?page=${page - 1}${seller ? `&seller=${seller}` : ""}`,
									)
								}
							>
								{t.previous}
							</button>
							<button
								type="button"
								className={action}
								disabled={page * 20 >= data.count}
								onClick={() =>
									router.push(
										`?page=${page + 1}${seller ? `&seller=${seller}` : ""}`,
									)
								}
							>
								{t.next}
							</button>
						</div>
					</>
				) : "outcomes" in data ? (
					<SubmissionCard
						row={data}
						locale={locale}
						busy={busy}
						resume={() => void resume(data)}
					/>
				) : (
					<>
						<OrderDocument
							order={data}
							locale={locale}
							context={context}
							seller={seller}
							busy={busy}
							pdf={() => void pdf(data)}
						/>
						<AftercareSection
							locale={locale}
							context={context}
							orderId={data.id}
						/>
					</>
				))
			)}
			<button
				type="button"
				className={action}
				disabled={busy}
				onClick={() => setReload((v) => v + 1)}
			>
				{t.reload}
			</button>
		</section>
	);
}
function SubmissionCard({
	row,
	locale,
	busy,
	resume,
}: {
	row: Submission;
	locale: Locale;
	busy: boolean;
	resume: () => void;
}) {
	const t = commerceCopy[locale];
	return (
		<article className={panel} data-testid="submission-result">
			<Link
				className="inline-flex min-h-11 items-center break-all text-action"
				href={`/${locale}/account/buyer/checkouts/${row.id}`}
			>
				<bdi>{row.id}</bdi>
			</Link>
			<p>
				<bdi>
					{row.currency} · {localTimestamp(row.created_at, locale)}
				</bdi>
			</p>
			{row.outcomes.map((o) => (
				<section
					className="space-y-2 rounded-control border border-border p-3"
					key={o.seller}
				>
					<p>
						<bdi>{o.seller}</bdi>
					</p>
					<p role="status">
						{o.state === "accepted"
							? t.accepted
							: o.state === "pending"
								? t.pending
								: failureText(locale, o.code)}
					</p>
					{o.goods_total && (
						<p>
							{t.total}:{" "}
							<bdi>
								{o.goods_total} {row.currency}
							</bdi>
						</p>
					)}
					{o.accepted_at && (
						<p>
							<bdi>{localTimestamp(o.accepted_at, locale)}</bdi>
						</p>
					)}
					{o.price_changed && (
						<p role="status" className="text-action">
							{t.priceChanged}
						</p>
					)}
					{o.invoice && o.number && (
						<Link
							className={action}
							href={invoiceHref(locale, "buyer", o.invoice)}
						>
							<bdi>{o.number}</bdi> · {t.invoices}
						</Link>
					)}
				</section>
			))}
			{row.outcomes.some((o) => o.state === "failed") && (
				<Link className={action} href={`/${locale}/cart`}>
					{t.cart} · {t.choose} · {t.retail} / {t.wholesale}
				</Link>
			)}
			{row.pending && (
				<>
					<p>{t.retryHelp}</p>
					<button
						type="button"
						className={action}
						disabled={busy}
						onClick={resume}
					>
						{t.resume}
					</button>
				</>
			)}
		</article>
	);
}
function failureText(locale: Locale, code: string) {
	const t = commerceCopy[locale];
	if (code.startsWith("wholesale")) return t.wholesaleHelp;
	if (code === "dependency_unavailable") return t.pending;
	const codes = [
		"stock_unconfigured",
		"stock_shortage",
		"destination_unavailable",
		"method_unavailable",
		"cart_changed",
		"tier_unavailable",
		"seller_unavailable",
	] as const;
	const known = codes.find((c) => c === code);
	return known
		? t[known]
		: code === "terms_unconfigured"
			? `${t.unavailable} · ${t.terms}`
			: t.unavailable;
}

function OrderDocument({
	order,
	locale,
	context,
	seller,
	busy,
	pdf,
}: {
	order: Order;
	locale: Locale;
	context: Context;
	seller: string;
	busy: boolean;
	pdf: () => void;
}) {
	const t = commerceCopy[locale],
		documentAction = context === "seller" ? salesAction : action;
	return (
		<article
			className={context === "seller" ? salesPanel : panel}
			data-testid="invoice-document"
		>
			<h2 className="text-2xl font-bold">
				{context === "seller" ? (
					sellerSalesCopy[locale].original
				) : (
					<bdi>{order.number}</bdi>
				)}
			</h2>
			{context === "buyer" && (
				<>
					<Link
						className={action}
						href={paymentHref(locale, context, order.id, seller)}
					>
						{paymentCopy[locale].title}
					</Link>
					<Link
						className={action}
						href={fulfilmentHref(locale, context, order.id, seller)}
					>
						{
							fulfilmentCopy[locale][
								context === "buyer" ? "buyerTitle" : "sellerTitle"
							]
						}
					</Link>
				</>
			)}
			<p dir="auto">
				{order.snapshot.buyer} · {order.snapshot.seller}
			</p>
			{order.snapshot.origin === "negotiated" && (
				<p className="rounded-control bg-info p-3">
					{negotiationCopy[locale].acceptedNotice}
				</p>
			)}
			<p>
				{t.issued}: <bdi>{localTimestamp(order.issued_at, locale)}</bdi>
			</p>
			<div className="space-y-4">
				{order.lines.map((row) => {
					const source = row.snapshot.titles[locale]
						? locale
						: row.snapshot.source_locale;
					return (
						<section
							key={row.id}
							className={
								context === "seller"
									? "min-w-0 space-y-3 rounded-xl border border-border bg-page p-4"
									: "space-y-2 border-b border-border pb-4"
							}
						>
							<h3 className="break-words font-bold" dir="auto">
								{row.snapshot.titles[source]}
							</h3>
							{Object.entries(row.snapshot.definition.attributes ?? {}).map(
								([key, value]) => (
									<p key={key} className="break-words" dir="auto">
										{row.snapshot.attribute_labels?.[key]?.[locale] ??
											row.snapshot.attribute_labels?.[key]?.["fa-AF"] ??
											key}
										: <bdi>{String(value)}</bdi>
									</p>
								),
							)}
							{row.snapshot.definition.contents && (
								<p
									className="break-words"
									dir="auto"
									lang={row.snapshot.source_locale}
								>
									{t.source} · <bdi>{row.snapshot.source_locale}</bdi>:{" "}
									{row.snapshot.definition.contents}
								</p>
							)}
							<p className="text-sm text-muted">
								{t.increment}: <bdi>{row.snapshot.increment}</bdi> · {t.minimum}
								: <bdi>{row.snapshot.minimum}</bdi>
							</p>
							{source !== locale && (
								<p className="text-sm text-muted">
									{t.source}: <bdi>{source}</bdi>
								</p>
							)}
							<p>
								<bdi>{row.snapshot.sku}</bdi> · {t[row.tier]} ·{" "}
								{row.snapshot.unit_labels[locale] ?? row.snapshot.unit}
							</p>
							<p>
								<bdi>
									{row.quantity} × {row.unit_price} {order.currency} ={" "}
									{row.goods_amount} {order.currency}
								</bdi>
							</p>
							{order.snapshot.origin === "negotiated" &&
								row.snapshot.max_quantity && (
									<p>
										{negotiationCopy[locale].limits}:{" "}
										<bdi>
											{row.snapshot.max_quantity}{" "}
											{row.snapshot.unit_labels[locale] ?? row.snapshot.unit} ·{" "}
											{row.snapshot.max_unit_price} {order.currency}
										</bdi>
									</p>
								)}
							{row.snapshot.price_changed && (
								<div
									role="status"
									data-testid="accepted-price-change"
									className="space-y-1 font-bold text-action"
								>
									<p>{t.priceChanged}</p>
									{row.snapshot.shown_price != null && (
										<p>
											{t.shownEstimate}:{" "}
											<bdi>
												{row.snapshot.shown_price} {order.currency}
											</bdi>
										</p>
									)}
									<p>
										{t.acceptedUnitPrice}:{" "}
										<bdi>
											{row.unit_price} {order.currency}
										</bdi>
									</p>
								</div>
							)}
						</section>
					);
				})}
			</div>
			<p className="text-xl font-bold">
				{t.total}:{" "}
				<bdi>
					{order.goods_total} {order.currency}
				</bdi>
			</p>
			<Disclosure locale={locale} accepted />
			<p>
				{paymentState(locale, order.dimensions.financial)} ·{" "}
				{fulfilmentState(locale, order.dimensions.fulfilment)} ·{" "}
				{fulfilmentState(locale, order.dimensions.completion)}
			</p>
			<p>
				{t.method}: {t[order.payment_method]}
			</p>
			<p>
				{t.destination}: <bdi>{order.snapshot.terms.destination.country}</bdi> ·{" "}
				<span dir="auto">{order.snapshot.terms.destination.city}</span>
			</p>
			<p>
				{t.terms}: <bdi>{order.snapshot.terms.version}</bdi>
			</p>
			{order.due_at && (
				<p>
					{t.due}: <bdi>{localTimestamp(order.due_at, locale)}</bdi>
				</p>
			)}
			<div className="flex flex-wrap gap-3">
				<button
					type="button"
					className={documentAction}
					disabled={busy}
					onClick={pdf}
				>
					{t.pdf}
				</button>
				<Link
					className={documentAction}
					href={`${invoiceHref(locale, context, order.invoice, seller).split("?")[0]}/print${seller ? `?seller=${seller}` : ""}`}
				>
					{t.print}
				</Link>
			</div>
		</article>
	);
}
