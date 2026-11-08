"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { SectionCard } from "../../../components/ui/section-card";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { sellerProductsCopy } from "../../../lib/i18n/seller-products";
import { languageNames, locales } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import {
	accountSession,
	ACCOUNT_SESSION_CHANGED,
} from "../../identity/api/accounts";
import {
	inventoryRequest,
	type StockProfiles,
} from "../../inventory/api/inventory";
import {
	ProductsPage,
	productHref,
	productLink,
	useProductGuard,
} from "./seller-products-ui";
import { catalogueCopy, catalogueStatuses } from "../../../lib/i18n/catalogue";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueRequest as api } from "../api/catalogue";
import type {
	ProductDetail,
	ProductBody,
	ProductList,
	Taxonomy,
	Revision,
	Operation,
} from "../types";
import {
	CatalogueValidation,
	Control,
	Feedback,
	failure,
} from "./catalogue-fields";
import { CatalogueOverview } from "./catalogue-overview";
import { ProductEditor } from "./product-editor";
import { ProductRevisionPreview } from "./product-revision-preview";
import { LivePrices } from "./live-prices";
const filterStates = ["draft", "submitted", "rejected", "withdrawn", "live"];
function blank(locale: Locale): ProductBody {
	return {
		title: "",
		description: "",
		brand: "",
		locale,
		category: "",
		attributes: {},
		variants: [
			{
				clientKey: crypto.randomUUID(),
				sku: "",
				unit: "piece",
				increment: "1",
				minimum: "1",
				contents: "",
				attributes: {},
				active: true,
				retail: "",
				wholesale: "",
			},
		],
		images: [],
	};
}
export function CatalogueWorkspace({
	locale,
	context,
	id,
	identity,
}: {
	locale: Locale;
	context: "seller";
	id?: string;
	identity: string;
}) {
	const t = catalogueCopy[locale],
		copy = sellerProductsCopy[locale];
	const router = useRouter(),
		query = useSearchParams(),
		seller = query.get("seller");
	const state = filterStates.includes(query.get("state") ?? "")
		? (query.get("state") ?? "")
		: "";
	const rawPage = query.get("page") ?? "1";
	const page =
		/^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= 10000
			? Number(rawPage)
			: 1;
	const [filter, setFilter] = useState(state);
	const [list, setList] = useState<ProductList | null>(null),
		[item, setItem] = useState<ProductDetail | null>(null),
		[taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
	const [body, setBody] = useState<ProductBody | null>(null),
		[baseline, setBaseline] = useState(""),
		[selected, setSelected] = useState<Revision | null>(null);
	const [feedback, setFeedback] = useState<ReturnType<typeof failure> | null>(
			null,
		),
		[busy, setBusy] = useState(false),
		[success, setSuccess] = useState(false),
		[blocked, setBlocked] = useState(false);
	const [epoch, setEpoch] = useState(0),
		[priceDirty, setPriceDirty] = useState(false),
		[stockAccess, setStockAccess] = useState(false),
		[reason, setReason] = useState("");
	const generation = useRef(0),
		write = useRef<symbol | null>(null),
		removeDialog = useRef<HTMLDialogElement>(null),
		removeFocus = useRef<HTMLElement | null>(null);
	const sourceDirty = !!body && JSON.stringify(body) !== baseline;
	const guard = useProductGuard(locale, sourceDirty || priceDirty || !!reason);
	const resetGuard = guard.reset;
	const setPrice = useCallback((value: boolean) => setPriceDirty(value), []);
	const clear = useCallback(() => {
		setList(null);
		setItem(null);
		setBody(null);
		setTaxonomy(null);
		setSelected(null);
		setBaseline("");
		setPriceDirty(false);
		setReason("");
		setStockAccess(false);
		setSuccess(false);
		resetGuard();
		removeDialog.current?.close();
	}, [resetGuard]);
	const install = useCallback(
		(value: ProductDetail, revisionId?: string | null) => {
			const revision =
				value.revisions.find((row) => row.id === revisionId) ??
				value.revisions[0] ??
				null;
			const next = revision?.body ?? blank(locale);
			setItem(value);
			setSelected(revision);
			setBody(next);
			setBaseline(JSON.stringify(next));
			setPriceDirty(false);
			setReason("");
			setEpoch((value) => value + 1);
		},
		[locale],
	);
	const deny = useCallback(
		(error: unknown) => {
			++generation.current;
			clear();
			setBlocked(true);
			setBusy(false);
			setFeedback(failure(error, locale));
		},
		[clear, locale],
	);
	useEffect(() => {
		setFilter(state);
	}, [state]);
	useEffect(() => {
		let current = true;
		const load = () => {
			const mine = ++generation.current;
			clear();
			setFeedback(null);
			setBusy(false);
			const task = id
				? Promise.all([
						api<Taxonomy>(context, "taxonomy/"),
						api<ProductDetail>(context, `products/${id}/`),
					])
				: api<ProductList>(context, `products/?state=${state}&page=${page}`);
			void task
				.then((value) => {
					if (!current || mine !== generation.current) return;
					if (Array.isArray(value)) {
						setTaxonomy(value[0]);
						install(value[1]);
						void inventoryRequest<StockProfiles>("seller/profiles/")
							.then((profiles) => {
								if (current && mine === generation.current)
									setStockAccess(
										!!profiles.profiles.find(
											(profile) => profile.id === value[1].seller,
										)?.capabilities.read,
									);
							})
							.catch(() => {
								if (current && mine === generation.current)
									setStockAccess(false);
							});
					} else setList(value);
				})
				.catch((error) => {
					if (current && mine === generation.current)
						setFeedback(failure(error, locale));
				});
		};
		load();
		window.addEventListener(ACCOUNT_SESSION_CHANGED, load);
		return () => {
			current = false;
			++generation.current;
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, load);
		};
	}, [context, id, state, page, locale, clear, install]);
	useEffect(() => {
		const verify = async () => {
			const mine = generation.current;
			try {
				const session = await accountSession("seller");
				if (mine !== generation.current) return;
				if (`${session.identity.id}:${session.accounts[0].id}` !== identity) {
					deny(new AccountError(403));
					return;
				}
				if (id) await api<ProductDetail>(context, `products/${id}/`);
			} catch (error) {
				if (
					mine === generation.current &&
					error instanceof AccountError &&
					[401, 403, 404].includes(error.status ?? 0)
				)
					deny(error);
			}
		};
		window.addEventListener("focus", verify);
		return () => window.removeEventListener("focus", verify);
	}, [context, id, identity, deny]);
	async function run(
		task: () => Promise<Operation>,
		after?: (fresh: ProductDetail, result: Operation) => void,
	) {
		if (!item || busy || blocked || write.current) return false;
		const owner = Symbol(),
			mine = generation.current;
		write.current = owner;
		setBusy(true);
		setFeedback(null);
		setSuccess(false);
		let acknowledged = false;
		try {
			const session = await accountSession("seller");
			if (mine !== generation.current) return false;
			if (`${session.identity.id}:${session.accounts[0].id}` !== identity) {
				deny(new AccountError(403));
				return false;
			}
			const result = await task();
			acknowledged = true;
			if (mine !== generation.current) return false;
			const fresh = await api<ProductDetail>(context, `products/${item.id}/`);
			if (mine !== generation.current) return false;
			setItem(fresh);
			after?.(fresh, result);
			setSuccess(true);
			return true;
		} catch (error) {
			if (mine !== generation.current) return false;
			if (
				error instanceof AccountError &&
				[401, 403, 404].includes(error.status ?? 0)
			)
				deny(error);
			else {
				setFeedback(
					acknowledged
						? { message: copy.acknowledged, issues: [] }
						: failure(error, locale),
				);
				if (
					acknowledged ||
					!(error instanceof AccountError) ||
					(error.status ?? 0) >= 500
				)
					setBlocked(true);
			}
			return acknowledged;
		} finally {
			if (write.current === owner) write.current = null;
			if (mine === generation.current) setBusy(false);
		}
	}
	async function refresh() {
		if (!item || busy || write.current) return;
		const mine = generation.current;
		setBusy(true);
		try {
			const session = await accountSession("seller");
			if (mine !== generation.current) return;
			if (`${session.identity.id}:${session.accounts[0].id}` !== identity) {
				deny(new AccountError(403));
				return;
			}
			const fresh = await api<ProductDetail>(context, `products/${item.id}/`);
			if (mine !== generation.current) return;
			install(fresh, selected?.id);
			setBlocked(false);
			setFeedback(null);
			setSuccess(false);
		} catch (error) {
			if (mine !== generation.current) return;
			if (
				error instanceof AccountError &&
				[401, 403, 404].includes(error.status ?? 0)
			)
				deny(error);
			else setFeedback(failure(error, locale));
		} finally {
			if (mine === generation.current) setBusy(false);
		}
	}
	async function transition(
		action: "submit" | "withdraw" | "unpublish",
		revision: string,
	) {
		if (!item || sourceDirty || priceDirty) return;
		const accepted = await run(
			() =>
				api<Operation>(context, `products/${item.id}/actions/`, {
					version: item.version,
					revision,
					action,
					reason: action === "unpublish" ? reason : "",
				}),
			(fresh) => {
				if (selected)
					setSelected(
						fresh.revisions.find((row) => row.id === selected.id) ?? selected,
					);
				setReason("");
			},
		);
		if (accepted) removeDialog.current?.close();
	}
	const back = productHref(locale, "catalogue", seller, query);
	return (
		<CatalogueValidation.Provider
			value={{ locale, issues: feedback?.issues ?? [] }}
		>
			<ProductsPage
				locale={locale}
				title={id ? body?.title || copy.untitled : copy.title}
				description={id ? item?.seller_name : copy.listHelp}
				back={id ? back : undefined}
				actions={
					!id && list?.sellers.length ? (
						<Link
							className={`${productLink} border-primary! bg-primary! text-on-primary!`}
							href={productHref(locale, "catalogue/new", seller, query)}
						>
							{copy.add}
						</Link>
					) : id && item?.published ? (
						<Link
							className={productLink}
							href={`/${locale}/products/${item.id}`}
							target="_blank"
							rel="noopener noreferrer"
						>
							{copy.viewPublic}
						</Link>
					) : undefined
				}
			>
				{feedback && <Feedback value={feedback} locale={locale} />}{" "}
				{success && (
					<p
						role="status"
						className="rounded-control bg-success-surface p-3 text-success"
					>
						{t.success}
					</p>
				)}
				{guard.feedback}
				{blocked && (
					<div
						role="status"
						className="rounded-xl bg-warning-surface p-4 text-warning"
					>
						<p>{copy.reloadRequired}</p>
						{item && (
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => guard.choose(() => void refresh())}
							>
								{t.reload}
							</Button>
						)}
					</div>
				)}
				{!id && list && (
					<>
						<section
							className="rounded-2xl border border-border bg-surface p-5"
							aria-label={t.filter}
						>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									router.push(
										productHref(locale, "catalogue", seller, query, {
											state: filter,
											page: "1",
										}),
									);
								}}
								className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end"
							>
								<div className="min-w-0 sm:w-72">
									<Control
										path="state"
										label={t.state}
										value={filter}
										options={[
											{ value: "", label: t.all },
											...filterStates.map((value) => ({
												value,
												label: catalogueStatuses[locale][value],
											})),
										]}
										onChange={setFilter}
									/>
								</div>
								<Button type="submit" variant="secondary" className="mt-0!">
									{t.filter}
								</Button>
							</form>
							<p className="mt-4 text-sm leading-relaxed text-muted">
								{copy.filterHelp}
							</p>
						</section>
						<CatalogueOverview
							locale={locale}
							list={list}
							seller={seller}
							filters={query}
						/>
						<nav
							aria-label={copy.page}
							className="flex flex-wrap items-center justify-between gap-3"
						>
							<Button
								variant="secondary"
								disabled={page === 1}
								onClick={() =>
									router.push(
										productHref(locale, "catalogue", seller, query, {
											page: String(page - 1),
										}),
									)
								}
							>
								{t.back}
							</Button>
							<p className="text-sm text-muted">
								{copy.page} <bdi>{page}</bdi>
							</p>
							<Button
								variant="secondary"
								disabled={page * 30 >= list.count || page >= 10000}
								onClick={() =>
									router.push(
										productHref(locale, "catalogue", seller, query, {
											page: String(page + 1),
										}),
									)
								}
							>
								{t.next}
							</Button>
						</nav>
					</>
				)}
				{id && item && body && taxonomy && (
					<>
						<section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
							<div className="flex flex-wrap items-center justify-between gap-4">
								<div className="flex flex-wrap gap-4 text-sm">
									<span>
										{copy.savedVersion}:{" "}
										<StatusBadge
											variant={
												selected ? statusVariant(selected.state) : "neutral"
											}
										>
											{selected
												? catalogueStatuses[locale][selected.state]
												: copy.notSaved}{" "}
											{selected && <bdi>#{selected.number}</bdi>}
										</StatusBadge>
									</span>
									<span>
										{copy.publicStatus}:{" "}
										<StatusBadge
											variant={item.published ? "success" : "neutral"}
										>
											{item.published ? copy.live : copy.notLive}
										</StatusBadge>
									</span>
								</div>
								<StatusBadge
									variant={sourceDirty || priceDirty ? "warning" : "neutral"}
								>
									{sourceDirty || priceDirty ? copy.unsaved : copy.unchanged}
								</StatusBadge>
							</div>
							<p className="text-sm text-muted">
								<bdi dir="ltr">{item.currency}</bdi> ·{" "}
								{item.pricing_mode === "fixed" ? t.fixed : t.negotiable} ·{" "}
								{copy.productVersion} <bdi>{item.version}</bdi>
							</p>
							<p className="text-sm leading-relaxed text-muted">
								{copy.publicHelp}
							</p>
							<nav aria-label={copy.edit} className="flex flex-wrap gap-2">
								{[
									["product-details", copy.details],
									["product-options", copy.options],
									[
										item.prices.length
											? "product-prices-live"
											: "product-prices-new",
										copy.prices,
									],
									["product-photos", copy.photos],
									["product-review", copy.review],
								].map(([anchor, label]) => (
									<a key={anchor} href={`#${anchor}`} className={productLink}>
										{label}
									</a>
								))}
							</nav>
						</section>
						<ProductEditor
							locale={locale}
							body={body}
							item={item}
							taxonomy={taxonomy}
							busy={busy || priceDirty || blocked}
							dirty={sourceDirty || !selected}
							onReload={() => guard.choose(() => void refresh())}
							onChange={setBody}
							onSave={() =>
								void run(
									() =>
										api<Operation>(context, `products/${item.id}/`, {
											version: item.version,
											body,
										}),
									(fresh, result) => install(fresh, result.revision),
								)
							}
							onUpload={(file) => {
								if (file.size > 8 * 1024 * 1024) {
									setFeedback({
										message: t.imageRule,
										issues: [{ path: "file", code: "image_size" }],
									});
									return;
								}
								const data = new FormData();
								data.set("version", String(item.version));
								data.set("file", file);
								void run(() =>
									api<Operation>(context, `products/${item.id}/images/`, data),
								);
							}}
						/>
						<details className="rounded-2xl border border-border bg-surface p-5">
							<summary className="min-h-11 cursor-pointer text-base font-semibold">
								{sourceDirty ? t.working : t.preview}
							</summary>
							<div className="mt-4">
								<ProductRevisionPreview
									sellerPreview
									locale={locale}
									body={body}
									item={item}
									label={sourceDirty ? t.working : t.preview}
								/>
							</div>
						</details>
						{!!item.prices.length && (
							<LivePrices
								key={`${identity}-${epoch}`}
								item={item}
								locale={locale}
								disabled={busy || sourceDirty || blocked}
								onDirty={setPrice}
								onEdit={(path) =>
									setFeedback((current) => {
										if (!current) return current;
										const group = path.slice(0, path.lastIndexOf(".")),
											issues = current.issues.filter(
												(issue) => issue.path !== path && issue.path !== group,
											);
										return issues.length
											? { ...current, issues }
											: blocked
												? current
												: null;
									})
								}
								onSave={(prices) =>
									run(() =>
										api<Operation>(context, `products/${item.id}/prices/`, {
											version: item.version,
											prices,
										}),
									)
								}
							/>
						)}
						{stockAccess && !!item.prices.length && (
							<SectionCard
								title={copy.manageStock}
								description={copy.stockHelp}
							>
								<div className="flex flex-wrap gap-3">
									{item.prices.map((variant) => (
										<Link
											key={variant.id}
											className={productLink}
											href={productHref(
												locale,
												`inventory/${variant.id}`,
												item.seller,
											)}
										>
											<bdi dir="ltr" className="wrap-anywhere">
												{variant.sku}
											</bdi>
										</Link>
									))}
								</div>
							</SectionCard>
						)}
						<SectionCard
							id="product-review"
							className="scroll-mt-28"
							title={copy.review}
							description={copy.reviewHelp}
						>
							<div className="space-y-5">
								{selected ? (
									<>
										<Control
											path="revision"
											label={t.revision}
											disabled={busy || blocked}
											value={selected.id}
											options={item.revisions.map((revision) => ({
												value: revision.id,
												label: `#${revision.number} · ${catalogueStatuses[locale][revision.state]} · ${languageNames[revision.body.locale]}`,
											}))}
											onChange={(revision) =>
												guard.choose(() => {
													install(item, revision);
													setFeedback(null);
												})
											}
										/>
										<p className="text-sm text-muted">{copy.historyLimit}</p>
										{selected.reason && (
											<p className="rounded-xl bg-warning-surface p-4 text-sm text-warning wrap-anywhere">
												{selected.reason}
											</p>
										)}
										<details className="rounded-xl border border-border p-4">
											<summary className="min-h-11 cursor-pointer text-base font-semibold">
												{t.saved} <bdi>#{selected.number}</bdi>
											</summary>
											<p className="mt-2 text-sm text-muted">
												{copy.savedHint}
											</p>
											<div className="mt-4">
												<ProductRevisionPreview
													key={selected.id}
													sellerPreview
													locale={locale}
													body={selected.body}
													item={item}
													revision={selected.id}
													label={`${t.saved} #${selected.number}`}
												/>
											</div>
										</details>
										<div className="flex flex-wrap gap-3">
											<Button
												disabled={
													busy ||
													blocked ||
													sourceDirty ||
													priceDirty ||
													selected.state !== "draft" ||
													item.revisions.some(
														(revision) => revision.state === "submitted",
													)
												}
												onClick={() => void transition("submit", selected.id)}
											>
												{t.submit}
											</Button>
											{selected.state === "submitted" && (
												<Button
													variant="secondary"
													disabled={
														busy || blocked || sourceDirty || priceDirty
													}
													onClick={() =>
														void transition("withdraw", selected.id)
													}
												>
													{t.withdraw}
												</Button>
											)}
										</div>
										<div className="space-y-3 border-t border-border pt-5">
											<h3 className="text-base font-semibold">
												{copy.languages}
											</h3>
											<p className="text-sm leading-relaxed text-muted">
												{copy.languageHelp}
											</p>
											<dl className="grid gap-3 sm:grid-cols-2">
												{locales.map((language) => {
													const translation = item.translations.find(
														(row) =>
															row.locale === language &&
															row.revision === selected.id,
													);
													const source = language === selected.body.locale;
													return (
														<div
															key={language}
															className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-page p-3"
														>
															<dt lang={language}>{languageNames[language]}</dt>
															<dd className="m-0">
																<StatusBadge
																	variant={
																		source
																			? "info"
																			: translation?.has_approved
																				? "success"
																				: translation
																					? "warning"
																					: "neutral"
																	}
																>
																	{source
																		? t.language
																		: translation?.has_approved
																			? copy.approved
																			: translation
																				? copy.awaiting
																				: copy.noTranslation}
																</StatusBadge>
															</dd>
														</div>
													);
												})}
											</dl>
										</div>
									</>
								) : (
									<p className="text-base text-muted">{copy.noRevision}</p>
								)}
								{item.published && (
									<div className="space-y-2 border-t border-border pt-5">
										<h3 className="text-base font-semibold">
											{copy.removePublic}
										</h3>
										<p className="text-sm leading-relaxed text-muted">
											{copy.removeHelp}
										</p>
										<Button
											variant="secondary"
											className="text-danger!"
											disabled={busy || blocked || sourceDirty || priceDirty}
											onClick={() => {
												removeFocus.current =
													document.activeElement as HTMLElement;
												removeDialog.current?.showModal();
											}}
										>
											{copy.removePublic}
										</Button>
									</div>
								)}
							</div>
						</SectionCard>
						<dialog
							ref={removeDialog}
							aria-labelledby="product-remove-title"
							aria-describedby="product-remove-help"
							onCancel={(event) => {
								event.preventDefault();
								removeDialog.current?.close();
								setReason("");
								removeFocus.current?.focus();
							}}
							className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-border bg-surface p-6 text-foreground shadow-lifted backdrop:bg-black/50"
						>
							<h2 id="product-remove-title" className="text-xl font-semibold">
								{copy.removePublic}
							</h2>
							<p
								id="product-remove-help"
								className="my-4 text-base leading-relaxed text-muted"
							>
								{copy.removeHelp}
							</p>
							<Control
								path="reason"
								label={t.reason}
								value={reason}
								maxLength={1000}
								required
								textarea
								disabled={busy}
								onChange={setReason}
							/>
							{feedback && (
								<p role="alert" className="mt-3 text-sm text-danger">
									{feedback.message}
								</p>
							)}
							<div className="mt-5 flex flex-col gap-3 sm:flex-row">
								<Button
									autoFocus
									variant="secondary"
									disabled={busy}
									onClick={() => {
										removeDialog.current?.close();
										setReason("");
										removeFocus.current?.focus();
									}}
								>
									{copy.cancel}
								</Button>
								<Button
									disabled={
										busy || blocked || !reason.trim() || !item.published
									}
									onClick={() => {
										if (item.published)
											void transition("unpublish", item.published);
									}}
								>
									{copy.confirmRemove}
								</Button>
							</div>
						</dialog>
					</>
				)}
				{!list && !item && !feedback && <p role="status">{t.loading}</p>}
			</ProductsPage>
		</CatalogueValidation.Provider>
	);
}
