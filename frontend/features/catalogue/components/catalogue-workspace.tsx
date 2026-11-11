"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { Icon } from "../../../components/ui/icon";
import { Button } from "../../../components/ui/button";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import {
	productFlowCopy,
	productActionsCopy,
	sellerProductsCopy,
} from "../../../lib/i18n/seller-products";
import { languageNames } from "../../../lib/i18n/locales";
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
import { ProductPagination } from "./product-pagination";
import { ProductEditor } from "./product-editor";
import { LivePrices } from "./live-prices";
import { productStepForIssue } from "./product-steps";

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
	const statusChoices = [
		"",
		"live",
		...(state && state !== "live" ? [state] : []),
	].map((value) => ({
		value,
		label:
			value === "live"
				? copy.live
				: value
					? catalogueStatuses[locale][value]
					: productFlowCopy[locale].all,
	}));
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
	const [step, setStep] = useState(1);
	const [cardAction, setCardAction] = useState<{
		id: string;
		action: "publish" | "unpublish";
	} | null>(null);
	const [cardReason, setCardReason] = useState("");
	const actionDialog = useRef<HTMLDialogElement>(null);
	function askCardAction(productId: string, action: "publish" | "unpublish") {
		setCardAction({ id: productId, action });
		setCardReason("");
		actionDialog.current?.showModal();
	}
	async function applyCardAction() {
		if (
			!cardAction ||
			busy ||
			write.current ||
			(cardAction.action === "unpublish" && !cardReason.trim())
		)
			return;
		const mine = generation.current,
			owner = Symbol();
		write.current = owner;
		setBusy(true);
		let acknowledged = false;
		try {
			const session = await accountSession("seller");
			if (mine !== generation.current) return;
			if (`${session.identity.id}:${session.accounts[0].id}` !== identity)
				throw new AccountError(403);
			const fresh = await api<ProductDetail>(
				context,
				`products/${cardAction.id}/`,
			);
			if (mine !== generation.current) return;
			const approved = fresh.revisions.find((row) => row.state === "published");
			const revision =
				cardAction.action === "unpublish"
					? fresh.published
					: approved?.id ||
						(fresh.revisions[0]?.state === "draft"
							? fresh.revisions[0].id
							: null);
			if (!revision) throw new AccountError(400);
			await api<Operation>(context, `products/${fresh.id}/actions/`, {
				version: fresh.version,
				revision,
				action:
					cardAction.action === "unpublish"
						? "unpublish"
						: approved
							? "publish"
							: "submit",
				reason: cardReason,
			});
			acknowledged = true;
			if (mine !== generation.current) return;
			toast.success(productActionsCopy[locale].done);
			actionDialog.current?.close();
			setCardReason("");
			if (id) install(await api<ProductDetail>(context, `products/${id}/`));
			else
				setList(
					await api<ProductList>(
						context,
						`products/?state=${state}&page=${page}`,
					),
				);
		} catch (error) {
			if (mine !== generation.current) return;
			toast.error(productFlowCopy[locale].errorToast);
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
		} finally {
			if (write.current === owner) write.current = null;
			if (mine === generation.current) setBusy(false);
		}
	}

	const [deleteTarget, setDeleteTarget] = useState<{
		id: string;
		title: string;
	} | null>(null);
	const [epoch, setEpoch] = useState(0),
		[priceDirty, setPriceDirty] = useState(false),
		[stockAccess, setStockAccess] = useState(false),
		[reason, setReason] = useState("");
	const generation = useRef(0),
		write = useRef<symbol | null>(null),
		removeDialog = useRef<HTMLDialogElement>(null),
		deleteDialog = useRef<HTMLDialogElement>(null),
		removeFocus = useRef<HTMLElement | null>(null);
	const sourceDirty = !!body && JSON.stringify(body) !== baseline;
	const guard = useProductGuard(locale, sourceDirty || priceDirty || !!reason);
	const resetGuard = guard.reset;
	const setPrice = useCallback((value: boolean) => setPriceDirty(value), []);
	const clear = useCallback(() => {
		setList(null);
		setStep(1);
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
		deleteDialog.current?.close();
		actionDialog.current?.close();
		setDeleteTarget(null);
		setCardAction(null);
		setCardReason("");
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
			toast.error(productFlowCopy[locale].errorToast);
			setFeedback(failure(error, locale));
		},
		[clear, locale],
	);
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
					if (current && mine === generation.current) {
						toast.error(productFlowCopy[locale].errorToast);
						setFeedback(failure(error, locale));
					}
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
		successMessage = productFlowCopy[locale].savedToast,
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
			toast.success(successMessage);
			return true;
		} catch (error) {
			if (mine !== generation.current) return false;
			if (
				error instanceof AccountError &&
				[401, 403, 404].includes(error.status ?? 0)
			)
				deny(error);
			else {
				toast.error(productFlowCopy[locale].errorToast);
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
			else {
				toast.error(productFlowCopy[locale].errorToast);
				setFeedback(failure(error, locale));
			}
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
			action === "submit"
				? productFlowCopy[locale].submittedToast
				: productFlowCopy[locale].savedToast,
		);
		if (accepted) removeDialog.current?.close();
	}
	async function saveDraft(
		after?: (fresh: ProductDetail, revision: string) => void,
	) {
		if (!item || !body) return false;
		return run(
			() =>
				api<Operation>(context, `products/${item.id}/`, {
					version: item.version,
					body,
				}),
			(fresh, result) => {
				install(fresh, result.revision);
				if (typeof result.revision === "string")
					after?.(fresh, result.revision);
			},
		);
	}
	async function submitProduct() {
		if (
			!item ||
			!body ||
			busy ||
			blocked ||
			priceDirty ||
			item.revisions.some((row) => row.state === "submitted")
		)
			return;
		const target: { current: { version: number; revision: string } | null } = {
			current:
				selected?.state === "draft" && !sourceDirty
					? { version: item.version, revision: selected.id }
					: null,
		};
		if (!target.current) {
			const accepted = await saveDraft((fresh, revision) => {
				target.current = { version: fresh.version, revision };
			});
			if (!accepted || !target.current) return;
		}
		const packet = target.current;
		await run(
			() =>
				api<Operation>(context, `products/${item.id}/actions/`, {
					...packet,
					action: "submit",
					reason: "",
				}),
			(fresh) => install(fresh, packet.revision),
		);
	}
	function askDelete(productId: string, title: string) {
		setDeleteTarget({ id: productId, title });
		deleteDialog.current?.showModal();
	}
	async function deleteProduct() {
		if (!deleteTarget || busy || blocked || write.current) return;
		const target = deleteTarget;
		const owner = Symbol();
		const mine = generation.current;
		write.current = owner;
		setBusy(true);
		try {
			const session = await accountSession("seller");
			if (mine !== generation.current) return;
			if (`${session.identity.id}:${session.accounts[0].id}` !== identity)
				throw new AccountError(403);
			await api<{ deleted: boolean }>(
				context,
				`products/${target.id}/`,
				{},
				"DELETE",
			);
			if (mine !== generation.current) return;
			toast.success(productFlowCopy[locale].deleteSuccess);
			deleteDialog.current?.close();
			setDeleteTarget(null);
			if (id) router.replace(back);
			else
				setList((current) =>
					current
						? {
								...current,
								results: current.results.filter((row) => row.id !== target.id),
								count: Math.max(0, current.count - 1),
							}
						: current,
				);
		} catch (error) {
			toast.error(productFlowCopy[locale].errorToast);
			setFeedback(failure(error, locale));
		} finally {
			if (write.current === owner) write.current = null;
			if (mine === generation.current) setBusy(false);
		}
	}
	const back = productHref(locale, "catalogue", seller, query);
	return (
		<CatalogueValidation.Provider
			value={{ locale, issues: feedback?.issues ?? [] }}
		>
			<ProductsPage
				narrow={!!id}
				locale={locale}
				title={id ? body?.title || copy.untitled : copy.title}
				description={id ? item?.seller_name : productFlowCopy[locale].listHelp}
				back={id ? back : undefined}
				actions={
					!id && list?.sellers.length ? (
						<Link
							className={`${productLink} border-primary! bg-primary! text-on-primary!`}
							href={productHref(locale, "catalogue/new", seller, query)}
						>
							<Icon name="plus" className="size-4" />
							{copy.add}
						</Link>
					) : id && item ? (
						<div className="flex flex-wrap gap-2">
							<Button
								variant="secondary"
								compact
								disabled={busy || blocked || sourceDirty || priceDirty}
								onClick={() =>
									askCardAction(
										item.id,
										item.published ? "unpublish" : "publish",
									)
								}
							>
								{item.published
									? productActionsCopy[locale].unpublish
									: productActionsCopy[locale].publish}
							</Button>
							{item.published && (
								<Link
									className={productLink}
									href={`/${locale}/products/${item.id}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									{copy.viewPublic}
								</Link>
							)}
							<button
								type="button"
								disabled={busy || sourceDirty || priceDirty || blocked}
								onClick={() => askDelete(item.id, body?.title || copy.untitled)}
								className="min-h-11 rounded-xl border border-danger/30 bg-surface px-3 text-sm font-semibold text-danger disabled:opacity-50"
							>
								{productFlowCopy[locale].delete}
							</button>
						</div>
					) : undefined
				}
			>
				{feedback && (
					<Feedback
						value={feedback}
						locale={locale}
						onIssue={(path) => {
							const target = productStepForIssue(path);
							if (target !== undefined) setStep(target);
						}}
					/>
				)}{" "}
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
						<div className="flex flex-wrap items-center justify-between gap-3">
							<nav
								className="hidden flex-wrap gap-2 sm:flex"
								aria-label={productFlowCopy[locale].filters}
							>
								{statusChoices.map(({ value, label }) => (
									<Link
										key={value}
										aria-current={state === value ? "page" : undefined}
										href={productHref(locale, "catalogue", seller, query, {
											state: value,
											page: "1",
										})}
										className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium no-underline transition-colors ${state === value ? "bg-action text-on-primary" : "bg-surface text-muted hover:bg-info hover:text-foreground"}`}
									>
										{label}
									</Link>
								))}
							</nav>
							<select
								aria-label={productFlowCopy[locale].filters}
								className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm text-foreground sm:hidden"
								value={state}
								onChange={(event) =>
									router.push(
										productHref(locale, "catalogue", seller, query, {
											state: event.target.value,
											page: "1",
										}),
									)
								}
							>
								{statusChoices.map((choice) => (
									<option key={choice.value} value={choice.value}>
										{choice.label}
									</option>
								))}
							</select>
							<details className="relative text-xs text-muted">
								<summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full hover:bg-info [&::-webkit-details-marker]:hidden">
									<Icon name="help" className="size-4" />
									<span className="sr-only">
										{productFlowCopy[locale].filterNote}
									</span>
								</summary>
								<p className="absolute end-0 top-full z-20 w-60 max-w-[75vw] rounded-xl border border-border bg-surface p-4 shadow-card leading-relaxed">
									{productFlowCopy[locale].filterNote}
								</p>
							</details>
						</div>
						<CatalogueOverview
							locale={locale}
							list={list}
							seller={seller}
							filters={query}
							onDelete={askDelete}
							onAction={askCardAction}
						/>
						<ProductPagination
							locale={locale}
							page={page}
							count={list.count}
							seller={seller}
							filters={query}
						/>
					</>
				)}
				{id && item && body && taxonomy && (
					<>
						<div className="flex flex-wrap items-center gap-3 text-sm text-muted">
							<bdi>{item.currency}</bdi>
							<span>·</span>
							<span>
								{item.pricing_mode === "fixed" ? t.fixed : t.negotiable}
							</span>
							<StatusBadge
								variant={selected ? statusVariant(selected.state) : "neutral"}
							>
								{selected
									? catalogueStatuses[locale][selected.state]
									: copy.notSaved}
							</StatusBadge>
							{selected?.state === "rejected" && selected.reason && (
								<p className="w-full rounded-xl bg-warning-surface p-3 text-warning">
									{selected.reason}
								</p>
							)}
						</div>
						{item.revisions.some((row) => row.state === "submitted") && (
							<p
								role="status"
								className="mx-auto w-full max-w-4xl rounded-xl bg-info p-4 text-sm text-foreground"
							>
								{productFlowCopy[locale].submitted}
							</p>
						)}
						<ProductEditor
							step={step}
							onStepChange={setStep}
							locale={locale}
							body={body}
							item={item}
							taxonomy={taxonomy}
							onSubmit={() => void submitProduct()}
							canSubmit={
								!item.revisions.some((row) => row.state === "submitted") &&
								(sourceDirty || !selected || selected.state === "draft")
							}
							prices={
								item.prices.length ? (
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
														(issue) =>
															issue.path !== path && issue.path !== group,
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
								) : undefined
							}
							busy={busy || priceDirty || blocked}
							dirty={sourceDirty || !selected}
							onReload={() => guard.choose(() => void refresh())}
							onChange={setBody}
							onSave={() => void saveDraft()}
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
						<details className="mx-auto w-full max-w-4xl rounded-2xl border border-border bg-surface p-5">
							<summary className="min-h-11 cursor-pointer text-sm font-semibold">
								{productFlowCopy[locale].history}
							</summary>
							<div className="mt-4 space-y-4">
								{stockAccess && !!item.prices.length && (
									<section
										className="space-y-3 border-t border-border pt-4"
										aria-label={copy.manageStock}
									>
										<h3 className="text-sm font-semibold">
											{copy.manageStock}
										</h3>
										<p className="text-sm text-muted">{copy.stockHelp}</p>
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
									</section>
								)}

								{selected && (
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
								)}
								<p className="text-sm text-muted">{copy.historyLimit}</p>
								{selected?.state === "submitted" && (
									<Button
										variant="secondary"
										disabled={busy || blocked || sourceDirty || priceDirty}
										onClick={() => void transition("withdraw", selected.id)}
									>
										{t.withdraw}
									</Button>
								)}
								{item.published && (
									<Button
										variant="secondary"
										disabled={busy || blocked || sourceDirty || priceDirty}
										onClick={() => {
											removeFocus.current =
												document.activeElement as HTMLElement;
											removeDialog.current?.showModal();
										}}
									>
										{copy.removePublic}
									</Button>
								)}
							</div>
						</details>
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
				<dialog
					ref={actionDialog}
					aria-labelledby="product-action-title"
					onCancel={(event) => {
						if (busy) event.preventDefault();
					}}
					onClose={() => setCardAction(null)}
					className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-border bg-surface p-6 text-foreground shadow-lifted backdrop:bg-black/50"
				>
					<h2 id="product-action-title" className="text-xl font-semibold">
						{cardAction?.action === "unpublish"
							? productActionsCopy[locale].unpublish
							: productActionsCopy[locale].publish}
					</h2>
					<p className="my-4 text-sm text-muted">
						{cardAction?.action === "unpublish"
							? copy.removeHelp
							: productActionsCopy[locale].help}
					</p>
					{cardAction?.action === "unpublish" && (
						<Control
							path="card-reason"
							label={t.reason}
							value={cardReason}
							onChange={setCardReason}
							required
							maxLength={1000}
						/>
					)}
					<div className="flex justify-end gap-2">
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => actionDialog.current?.close()}
						>
							{copy.cancel}
						</Button>
						<Button
							disabled={
								busy ||
								blocked ||
								(cardAction?.action === "unpublish" && !cardReason.trim())
							}
							onClick={() => void applyCardAction()}
						>
							{cardAction?.action === "unpublish"
								? productActionsCopy[locale].unpublish
								: productActionsCopy[locale].publish}
						</Button>
					</div>
				</dialog>
				<dialog
					ref={deleteDialog}
					aria-labelledby="product-delete-title"
					aria-describedby="product-delete-help"
					onClose={() => setDeleteTarget(null)}
					className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-border bg-surface p-6 text-foreground shadow-lifted backdrop:bg-black/50"
				>
					<h2 id="product-delete-title" className="text-xl font-semibold">
						{productFlowCopy[locale].deleteTitle}
					</h2>
					<p
						id="product-delete-help"
						className="my-3 text-sm leading-relaxed text-muted"
					>
						{productFlowCopy[locale].deleteHelp}
					</p>
					{deleteTarget && (
						<p className="font-semibold wrap-anywhere">{deleteTarget.title}</p>
					)}
					<div className="mt-5 flex flex-wrap justify-end gap-2">
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => deleteDialog.current?.close()}
						>
							{copy.cancel}
						</Button>
						<Button
							className="!border-danger !bg-danger hover:!brightness-95"
							disabled={busy || !deleteTarget}
							onClick={() => void deleteProduct()}
						>
							{productFlowCopy[locale].delete}
						</Button>
					</div>
				</dialog>
				{!list && !item && !feedback && <p role="status">{t.loading}</p>}
			</ProductsPage>
		</CatalogueValidation.Provider>
	);
}
