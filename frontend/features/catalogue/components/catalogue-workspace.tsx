"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "../../../components/ui/button";
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
import type { ValidationIssue } from "../../../lib/api/private-client";
import { ProductEditor } from "./product-editor";
import { ProductRevisionPreview } from "./product-revision-preview";
import { LivePrices } from "./live-prices";
import { TranslationReviewPanel } from "./translation-review-panel";
import { SourceReviewPanel } from "./source-review-panel";
import { TaxonomyEditor } from "./taxonomy-editor";
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
}: {
	locale: Locale;
	context: "seller" | "staff";
	id?: string;
}) {
	const t = catalogueCopy[locale];
	const [list, setList] = useState<ProductList | null>(null),
		[item, setItem] = useState<ProductDetail | null>(null),
		[taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
	const [body, setBody] = useState<ProductBody | null>(null),
		[baseline, setBaseline] = useState(""),
		[selected, setSelected] = useState<Revision | null>(null),
		[savedPreview, setSavedPreview] = useState<Revision | null>(null);
	const [feedback, setFeedback] = useState<{
			message: string;
			issues: ValidationIssue[];
		} | null>(null),
		[busy, setBusy] = useState(false),
		[success, setSuccess] = useState(false),
		[reason, setReason] = useState("");
	const [pending, setPending] = useState<(() => void) | null>(null),
		[epoch, setEpoch] = useState(0),
		[translationDirty, setTranslationDirty] = useState(false),
		[priceDirty, setPriceDirty] = useState(false);
	const [state, setState] = useState(""),
		[page, setPage] = useState(1);
	const sourceDirty = !!body && JSON.stringify(body) !== baseline;
	const dirty = sourceDirty || translationDirty || priceDirty;
	const previous = item?.revisions.find((r) => r.id === item.published);
	const setTranslation = useCallback(
		(v: boolean) => setTranslationDirty(v),
		[],
	);
	const setPrice = useCallback((v: boolean) => setPriceDirty(v), []);
	const install = useCallback(
		(value: ProductDetail, revisionId?: string | null) => {
			setItem(value);
			const revision =
				value.revisions.find((r) => r.id === revisionId) ??
				value.revisions[0] ??
				null;
			const next = revision?.body ?? blank(locale);
			setSelected(revision);
			setBody(next);
			setBaseline(JSON.stringify(next));
			setTranslationDirty(false);
			setPriceDirty(false);
			setEpoch((v) => v + 1);
		},
		[locale],
	);
	useEffect(() => {
		let current = true;
		setFeedback(null);
		void Promise.all([
			api<Taxonomy>(context, "taxonomy/"),
			id
				? api<ProductDetail>(context, `products/${id}/`)
				: api<ProductList>(context, `products/?state=${state}&page=${page}`),
		])
			.then(([tax, result]) => {
				if (!current) return;
				setTaxonomy(tax);
				if (id) install(result as ProductDetail);
				else setList(result as ProductList);
			})
			.catch((error) => {
				if (current) setFeedback(failure(error, locale));
			});
		return () => {
			current = false;
		};
	}, [context, id, state, page, locale, install]);
	function guarded(fn: () => void) {
		if (dirty) setPending(() => fn);
		else fn();
	}
	async function run(
		task: () => Promise<unknown>,
		after?: (fresh: ProductDetail, result: Operation) => void,
	) {
		setBusy(true);
		setFeedback(null);
		setSuccess(false);
		try {
			const result = (await task()) as Operation;
			if (item) {
				const fresh = await api<ProductDetail>(context, `products/${item.id}/`);
				setItem(fresh);
				after?.(fresh, result);
			}
			setSuccess(true);
			return true;
		} catch (error) {
			setFeedback(failure(error, locale));
			return false;
		} finally {
			setBusy(false);
		}
	}
	async function refresh() {
		if (!item) return;
		setBusy(true);
		try {
			install(
				await api<ProductDetail>(context, `products/${item.id}/`),
				selected?.id,
			);
			setFeedback(null);
		} catch (error) {
			setFeedback(failure(error, locale));
		} finally {
			setBusy(false);
		}
	}
	async function transition(action: string) {
		if (!item || !selected || dirty) return;
		await run(
			() =>
				api(context, `products/${item.id}/actions/`, {
					version: item.version,
					revision: selected.id,
					action,
					reason,
				}),
			(fresh) => {
				const revision = fresh.revisions.find((r) => r.id === selected.id);
				if (revision) setSelected(revision);
			},
		);
	}
	const [seller, setSeller] = useState(""),
		[currency, setCurrency] = useState("AFN"),
		[mode, setMode] = useState("fixed");
	return (
		<CatalogueValidation.Provider
			value={{ locale, issues: feedback?.issues ?? [] }}
		>
			<div className="min-w-0 space-y-6">
				<h1 className="text-2xl">{t.title}</h1>
				{feedback && <Feedback value={feedback} locale={locale} />}{" "}
				{success && (
					<p
						role="status"
						className="rounded-control bg-success-surface p-3 text-success"
					>
						{t.success}
					</p>
				)}
				{pending && (
					<div role="alert" className="border border-warning p-4 space-y-3">
						<p>{t.dirty}</p>
						<Button
							onClick={() => {
								const next = pending;
								setFeedback(null);
								setPending(null);
								setTranslationDirty(false);
								setPriceDirty(false);
								setEpoch((e) => e + 1);
								next();
							}}
						>
							{t.confirm}
						</Button>
						<Button variant="secondary" onClick={() => setPending(null)}>
							{t.cancel}
						</Button>
					</div>
				)}
				{!id && list && (
					<>
						<form
							className="flex flex-wrap gap-4 items-end"
							onSubmit={(e) => {
								e.preventDefault();
								const data = new FormData(e.currentTarget);
								setState(String(data.get("state") ?? ""));
								setPage(1);
							}}
						>
							<label htmlFor="catalogue-state">
								{t.state}
								<select
									id="catalogue-state"
									name="state"
									defaultValue={state}
									className="m-2 rounded-control border border-control bg-surface p-3"
								>
									<option value="">{t.all}</option>
									{["draft", "submitted", "rejected", "withdrawn", "live"].map(
										(s) => (
											<option key={s} value={s}>
												{catalogueStatuses[locale][s]}
											</option>
										),
									)}
								</select>
							</label>
							<Button type="submit">{t.filter}</Button>
						</form>
						{list.results.length === 0 && <p>{t.empty}</p>}
						<ul className="space-y-3">
							{list.results.map((p) => (
								<li
									key={p.id}
									className="rounded-control border border-border p-4"
								>
									<Link
										className="text-action underline break-words"
										href={`/${locale}/account/${context}/catalogue/${p.id}`}
									>
										{p.title || p.id}
									</Link>
									<p>
										{p.seller} · {catalogueStatuses[locale][p.state]} ·{" "}
										{p.version}
									</p>
								</li>
							))}
						</ul>
						<div className="flex gap-4">
							<Button
								variant="secondary"
								disabled={page === 1}
								onClick={() => setPage((p) => p - 1)}
							>
								{t.back}
							</Button>
							<span>{page}</span>
							<Button
								variant="secondary"
								disabled={page * 30 >= list.count}
								onClick={() => setPage((p) => p + 1)}
							>
								{t.next}
							</Button>
						</div>
						{context === "seller" && (
							<form
								onSubmit={(e) => {
									e.preventDefault();
									void run(async () => {
										const created = await api<Operation>(context, "products/", {
											seller: seller || list.sellers[0]?.id,
											currency,
											pricing_mode: mode,
										});
										window.location.assign(
											`/${locale}/account/seller/catalogue/${created.id}`,
										);
										return created;
									});
								}}
								className="space-y-4 rounded-control border border-border p-4"
							>
								<h2 className="text-xl">{t.create}</h2>
								<Control
									path="seller"
									label={t.seller}
									value={seller || list.sellers[0]?.id || ""}
									options={list.sellers.map((s) => ({
										value: s.id,
										label: s.name,
									}))}
									onChange={setSeller}
								/>
								<Control
									path="currency"
									label={t.currency}
									value={currency}
									options={["AFN", "USD"].map((c) => ({ value: c, label: c }))}
									onChange={setCurrency}
								/>
								<Control
									path="pricing_mode"
									label={t.mode}
									value={mode}
									options={[
										{ value: "fixed", label: t.fixed },
										{ value: "negotiable", label: t.negotiable },
									]}
									onChange={setMode}
								/>
								<Button type="submit" disabled={busy || !list.sellers.length}>
									{t.create}
								</Button>
							</form>
						)}
						{list.permissions.includes("manage_taxonomy") && taxonomy && (
							<TaxonomyEditor
								locale={locale}
								taxonomy={taxonomy}
								busy={busy}
								onSave={async (path, data) => {
									setBusy(true);
									setFeedback(null);
									try {
										const fresh = await api<Taxonomy>(context, path, data);
										setTaxonomy(fresh);
										setSuccess(true);
										return fresh;
									} catch (error) {
										setFeedback(failure(error, locale));
										return null;
									} finally {
										setBusy(false);
									}
								}}
							/>
						)}
					</>
				)}
				{id && item && body && taxonomy && (
					<>
						<div className="flex flex-wrap gap-4">
							<Link
								href={`/${locale}/account/${context}/catalogue`}
								onClick={(e) => {
									if (dirty) {
										e.preventDefault();
										const href = e.currentTarget.href;
										guarded(() => window.location.assign(href));
									}
								}}
							>
								{t.list}
							</Link>
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => guarded(() => void refresh())}
							>
								{t.reload}
							</Button>
							{sourceDirty && (
								<Button
									variant="secondary"
									onClick={() =>
										guarded(() => {
											if (selected) {
												setBody(selected.body);
												setBaseline(JSON.stringify(selected.body));
											} else {
												const next = blank(locale);
												setBody(next);
												setBaseline(JSON.stringify(next));
											}
										})
									}
								>
									{t.discard}
								</Button>
							)}
						</div>
						<p>
							{item.seller_name} · {item.currency} ·{" "}
							{item.pricing_mode === "fixed" ? t.fixed : t.negotiable} ·{" "}
							{t.revision} {item.version}
						</p>
						{item.published && (
							<Link
								className="text-action underline"
								target="_blank"
								rel="noopener noreferrer"
								href={`/${locale}/catalogue-preview/${item.id}`}
							>
								{t.published}
							</Link>
						)}
						{dirty && (
							<p
								role="status"
								className="rounded-control bg-warning-surface p-3 text-warning"
							>
								{t.dirty}
							</p>
						)}
						<Control
							path="revision"
							label={t.revision}
							value={selected?.id ?? ""}
							options={[
								{ value: "", label: "—" },
								...item.revisions.map((r) => ({
									value: r.id,
									label: `#${r.number} · ${catalogueStatuses[locale][r.state]} · ${r.body.locale}`,
								})),
							]}
							onChange={(value) =>
								guarded(() => {
									const r = item.revisions.find((r) => r.id === value);
									if (r) {
										setSelected(r);
										setBody(r.body);
										setBaseline(JSON.stringify(r.body));
										setEpoch((e) => e + 1);
										setSavedPreview(null);
									}
								})
							}
						/>
						{context === "seller" && (
							<ProductEditor
								locale={locale}
								body={body}
								item={item}
								taxonomy={taxonomy}
								busy={busy || translationDirty || priceDirty}
								onChange={setBody}
								onSave={() =>
									void run(
										() =>
											api(context, `products/${item.id}/`, {
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
										api(context, `products/${item.id}/images/`, data),
									);
								}}
							/>
						)}
						<ProductRevisionPreview
							locale={locale}
							body={body}
							item={item}
							label={sourceDirty ? t.working : t.preview}
						/>
						{selected && (
							<>
								<Button
									variant="secondary"
									disabled={busy}
									onClick={() =>
										void run(
											() => api<ProductDetail>(context, `products/${item.id}/`),
											(fresh) =>
												setSavedPreview(
													fresh.revisions.find((r) => r.id === selected.id) ??
														null,
												),
										)
									}
								>
									{t.saved}
								</Button>
								{savedPreview && (
									<ProductRevisionPreview
										locale={locale}
										body={savedPreview.body}
										item={item}
										label={`${t.saved} #${savedPreview.number} · ${catalogueStatuses[locale][savedPreview.state]}`}
										revision={savedPreview.id}
									/>
								)}
								{context === "staff" &&
									item.published &&
									item.published !== selected.id && (
										<details>
											<summary>{t.previous}</summary>
											{item.revisions
												.filter((r) => r.id === item.published)
												.map((r) => (
													<ProductRevisionPreview
														key={r.id}
														locale={locale}
														body={r.body}
														item={item}
														label={t.previous}
														revision={r.id}
													/>
												))}
										</details>
									)}
								{context === "staff" &&
									previous &&
									item.published !== selected.id && (
										<SourceReviewPanel
											locale={locale}
											selected={selected}
											previous={previous}
										/>
									)}
								<Control
									path="reason"
									label={t.reason}
									value={reason}
									onChange={setReason}
								/>
								{selected.reason && (
									<p className="bg-warning-surface p-3 text-warning">
										{selected.reason}
									</p>
								)}
								<div className="flex flex-wrap gap-3">
									{(context === "seller"
										? ["submit", "withdraw", "unpublish"]
										: ["publish", "reject", "unpublish"]
									).map((action) => (
										<Button
											key={action}
											variant={action === "publish" ? "primary" : "secondary"}
											disabled={
												busy ||
												dirty ||
												(action === "submit" && selected.state !== "draft") ||
												(["publish", "reject", "withdraw"].includes(action) &&
													selected.state !== "submitted") ||
												(action === "unpublish" &&
													item.published !== selected.id) ||
												(context === "staff" &&
													!item.permissions.includes(
														action === "unpublish"
															? "moderate_catalogue"
															: "review_source",
													))
											}
											onClick={() => void transition(action)}
										>
											{
												t[
													action as
														| "submit"
														| "withdraw"
														| "unpublish"
														| "publish"
														| "reject"
												]
											}
										</Button>
									))}
								</div>
							</>
						)}
						{context === "seller" && (
							<LivePrices
								key={`${item.prices.map((p) => p.id).join("-")}-${epoch}`}
								item={item}
								locale={locale}
								disabled={busy || sourceDirty}
								onDirty={setPrice}
								onEdit={(path) =>
									setFeedback((current) => {
										if (!current) return current;
										const group = path.slice(0, path.lastIndexOf("."));
										const issues = current.issues.filter(
											(issue) => issue.path !== path && issue.path !== group,
										);
										return issues.length ? { ...current, issues } : null;
									})
								}
								onSave={(prices) =>
									run(() =>
										api(context, `products/${item.id}/prices/`, {
											version: item.version,
											prices,
										}),
									)
								}
							/>
						)}
						{context === "staff" &&
							selected &&
							item.permissions.includes("review_translation") && (
								<TranslationReviewPanel
									key={`${selected.id}-${epoch}`}
									item={item}
									revision={selected}
									locale={locale}
									busy={busy || sourceDirty}
									onDirty={setTranslation}
									onAction={(target, data) =>
										run(() =>
											api(
												context,
												`products/${item.id}/translations/${selected.id}/${target}/`,
												data,
											),
										)
									}
								/>
							)}
					</>
				)}
				{!list && !item && !feedback && <p role="status">{t.loading}</p>}
			</div>
		</CatalogueValidation.Provider>
	);
}
