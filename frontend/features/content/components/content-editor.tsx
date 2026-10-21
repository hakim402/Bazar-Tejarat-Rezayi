"use client";
import { useRef, useState } from "react";
import { privateRequest } from "../../../lib/api/private-client";
import { contentCopy } from "../../../lib/i18n/content";
import { contentEditorCopy } from "../../../lib/i18n/content-editor";
import { locales, type Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import { Document } from "./document";
import { SettingsPreview } from "./settings-preview";
import { DocumentFields, Field, fieldClass } from "./document-fields";
import {
	EditorFeedback,
	editorFailure,
	fieldId,
	ValidationContext,
	issueMessage,
	type Feedback,
} from "./editor-validation";
import type {
	Document as DocumentData,
	EditorItem,
	EditorList,
	Revision,
	Operation,
} from "../types";
const base = "content/editor/staff/items/";
type Buffer = { locale: Locale; source: string; payload: DocumentData };
function revisionBuffer(item: EditorItem, revision?: Revision): Buffer {
	return {
		locale: (revision?.locale ?? "fa-AF") as Locale,
		source: revision?.source_id ?? "",
		payload: structuredClone(
			revision?.payload ?? {
				title: item.key,
				description: "",
				group: "",
				blocks: [],
				navigation: [],
			},
		),
	};
}
export function ContentEditor({
	initial,
	permissions: initialPermissions,
	locale,
	onDenied,
}: {
	initial: EditorItem;
	permissions: string[];
	locale: Locale;
	onDenied: () => void;
}) {
	const t = contentCopy[locale],
		copy = contentEditorCopy[locale];
	const [item, setItem] = useState(initial),
		[permissions, setPermissions] = useState(initialPermissions);
	const [revisionId, setRevisionId] = useState(initial.revisions[0]?.id ?? "");
	const selected = item.revisions.find((r) => r.id === revisionId);
	const [buffer, setBuffer] = useState(() =>
		revisionBuffer(initial, initial.revisions[0]),
	);
	const [baseline, setBaseline] = useState(() => JSON.stringify(buffer));
	const [baselineRevisionId, setBaselineRevisionId] = useState(
		initial.revisions[0]?.id ?? "",
	);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false),
		[notice, setNotice] = useState("");
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const [workingPreview, setWorkingPreview] = useState(false),
		[savedPreview, setSavedPreview] = useState<Revision | null>(null);
	const [pending, setPending] = useState(false);
	const pendingAction = useRef<(() => void) | null>(null),
		returnFocus = useRef<HTMLElement | null>(null);
	const dirty = JSON.stringify(buffer) !== baseline;
	const editable = permissions.includes("edit_content"),
		publishable = permissions.includes("publish_content");
	function edit(next: Buffer) {
		setBuffer(next);
		setFeedback(null);
		setNotice("");
	}
	function choose(next: EditorItem, revision?: Revision) {
		const value = revisionBuffer(next, revision);
		setItem(next);
		setRevisionId(revision?.id ?? "");
		setBuffer(value);
		setBaseline(JSON.stringify(value));
		setBaselineRevisionId(revision?.id ?? "");
		setFeedback(null);
		setWorkingPreview(false);
		setSavedPreview(null);
		setReason("");
	}
	function guard(action: () => void) {
		if (!dirty) {
			action();
			return;
		}
		pendingAction.current = action;
		returnFocus.current = document.activeElement as HTMLElement;
		setPending(true);
		// Focus is set by the ref callback once the inline choice has mounted.
	}
	function cancelDiscard() {
		setPending(false);
		pendingAction.current = null;
		returnFocus.current?.focus();
	}
	function confirmDiscard() {
		const action = pendingAction.current;
		setPending(false);
		pendingAction.current = null;
		action?.();
	}
	function fail(error: unknown) {
		setFeedback(editorFailure(error, locale));
		setWorkingPreview(false);
		setSavedPreview(null);
	}
	async function fresh() {
		const detail = await privateRequest<EditorItem>(`${base}${item.key}/`);
		const list = await privateRequest<EditorList>(base);
		setPermissions(list.permissions);
		return detail;
	}
	async function reload() {
		setBusy(true);
		setFeedback(null);
		try {
			const next = await fresh();
			choose(
				next,
				next.revisions.find((r) => r.locale === buffer.locale) ??
					next.revisions[0],
			);
			setNotice(t.updated);
		} catch (error) {
			fail(error);
			if (editorFailure(error, locale).message === copy.denied) onDenied();
		} finally {
			setBusy(false);
		}
	}
	async function mutate(
		action?: "submit" | "return" | "publish" | "unpublish",
	) {
		if (busy || (action && (dirty || !selected))) return;
		setBusy(true);
		setFeedback(null);
		setNotice("");
		try {
			const operation = await privateRequest<Operation>(
				`${base}${item.key}/${action ? "actions/" : ""}`,
				action
					? {
							version: item.version,
							revision: selected?.id,
							action,
							reason,
						}
					: {
							version: item.version,
							locale: buffer.locale,
							source: buffer.locale === "fa-AF" ? null : buffer.source || null,
							payload: buffer.payload,
						},
			);
			const next = await fresh();
			choose(
				next,
				next.revisions.find((r) => r.id === operation.revision),
			);
			setNotice(t.saved);
		} catch (error) {
			fail(error);
		} finally {
			setBusy(false);
		}
	}
	async function preview(saved: boolean) {
		setBusy(true);
		setFeedback(null);
		try {
			const revision = selected
				? await privateRequest<Revision>(
						`content/editor/staff/revisions/${selected.id}/preview/`,
					)
				: null;
			if (!selected) await privateRequest<EditorItem>(`${base}${item.key}/`);
			if (saved) setSavedPreview(revision);
			else setWorkingPreview((v) => !v);
		} catch (error) {
			fail(error);
		} finally {
			setBusy(false);
		}
	}
	function switchLocale(next: Locale) {
		const revision = item.revisions.find((r) => r.locale === next);
		if (revision) choose(item, revision);
		else {
			const source =
				item.revisions.find((r) => r.id === item.publications["fa-AF"]) ??
				item.revisions.find((r) => r.locale === "fa-AF");
			setRevisionId("");
			edit({
				locale: next,
				source: source?.id ?? "",
				payload: structuredClone(source?.payload ?? buffer.payload),
			});
			setSavedPreview(null);
			setWorkingPreview(false);
		}
	}
	const issues = feedback?.issues ?? [];
	const sourceErrors = issues.filter((i) => i.path === "source");
	const actions = (
		["submit", "return", "publish", "unpublish"] as const
	).filter((action) => {
		if (!selected) return false;
		if (action === "submit")
			return editable && ["draft", "returned"].includes(selected.state);
		if (!publishable) return false;
		if (action === "return") return selected.state === "submitted";
		if (item.kind === "legal") return false;
		return action === "publish"
			? selected.state === "submitted"
			: item.publications[selected.locale] === selected.id;
	});
	function renderPreview(data: DocumentData, language: Locale) {
		return ["shell", "support"].includes(item.kind) ? (
			<SettingsPreview data={data} kind={item.kind} locale={locale} />
		) : (
			<Document
				data={data}
				locale={locale}
				contentLocale={language}
				heading={false}
				compact={item.kind === "announcement"}
			/>
		);
	}
	return (
		<ValidationContext.Provider value={{ issues, locale }}>
			<div
				className="min-w-0 space-y-5"
				onClickCapture={(event) => {
					const link =
						event.target instanceof Element ? event.target.closest("a") : null;
					const href = link?.getAttribute("href");
					if (
						dirty &&
						href &&
						!href.startsWith("#") &&
						link?.target !== "_blank"
					) {
						event.preventDefault();
						guard(() => window.location.assign(href));
					}
				}}
			>
				<Button
					variant="secondary"
					disabled={busy || pending}
					onClick={() =>
						guard(() =>
							window.location.assign(`/${locale}/account/staff/content`),
						)
					}
				>
					{t.editor}
				</Button>
				<h2 className="text-2xl">
					<bdi>{item.key}</bdi> · {t.version} {item.version}
				</h2>
				{feedback && <EditorFeedback feedback={feedback} locale={locale} />}
				<p role="status">{busy ? t.loading : notice}</p>
				{dirty && (
					<div
						className="space-y-3 rounded-control bg-warning-surface p-4 text-warning"
						data-testid="content-dirty"
					>
						<p>{copy.dirty}</p>
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() =>
								guard(() =>
									choose(
										item,
										item.revisions.find((r) => r.id === baselineRevisionId),
									),
								)
							}
						>
							{copy.discard}
						</Button>
					</div>
				)}
				{pending && (
					<div
						role="alertdialog"
						aria-label={copy.discardPrompt}
						className="space-y-3 rounded-card border border-control bg-surface p-4"
					>
						<p>{copy.discardPrompt}</p>
						<div className="flex flex-wrap gap-3">
							<Button
								ref={(node) => {
									node?.focus();
								}}
								variant="secondary"
								onClick={cancelDiscard}
							>
								{copy.keep}
							</Button>
							<Button onClick={confirmDiscard}>{copy.discard}</Button>
						</div>
					</div>
				)}
				<Button
					variant="secondary"
					disabled={busy || pending}
					onClick={() => guard(() => void reload())}
				>
					{t.reload}
				</Button>
				{item.kind === "legal" && <p>{t.legalHint}</p>}
				<label className="block">
					{t.revision}
					<select
						aria-label={t.revision}
						className={fieldClass}
						value={revisionId}
						disabled={busy || pending}
						onChange={(e) => {
							const revision = item.revisions.find(
								(r) => r.id === e.target.value,
							);
							if (revision) guard(() => choose(item, revision));
						}}
					>
						<option value="" disabled>
							{t.empty}
						</option>
						{item.revisions.map((r) => (
							<option key={r.id} value={r.id}>
								{r.number} · {r.locale} · {t[r.state as "draft"] ?? r.state}
								{item.publications[r.locale] === r.id
									? ` · ${t.published}`
									: ""}
							</option>
						))}
					</select>
				</label>
				<form
					className="min-w-0 space-y-5"
					onSubmit={(e) => {
						e.preventDefault();
						void mutate();
					}}
				>
					<fieldset
						disabled={!editable || busy || pending}
						className="min-w-0 space-y-5 border-0 p-0"
					>
						<label className="block">
							{t.locale}
							<select
								aria-label={t.locale}
								id={fieldId("locale")}
								className={fieldClass}
								value={buffer.locale}
								onChange={(e) => {
									const next = e.target.value as Locale;
									guard(() => switchLocale(next));
								}}
							>
								{locales.map((l) => (
									<option key={l}>{l}</option>
								))}
							</select>
						</label>
						{buffer.locale !== "fa-AF" && (
							<>
								<p>{t.translationHint}</p>
								<label className="block">
									{t.source}
									<select
										id={fieldId("source")}
										aria-label={t.source}
										aria-invalid={sourceErrors.length > 0}
										aria-describedby={
											sourceErrors.length
												? `${fieldId("source")}-error`
												: undefined
										}
										className={fieldClass}
										required
										value={buffer.source}
										onChange={(e) => {
											const id = e.target.value;
											guard(() => {
												const source = item.revisions.find((r) => r.id === id);
												edit({
													...buffer,
													source: id,
													payload: structuredClone(
														source?.payload ?? buffer.payload,
													),
												});
											});
										}}
									>
										<option value="">—</option>
										{item.revisions
											.filter((r) => r.locale === "fa-AF")
											.map((r) => (
												<option key={r.id} value={r.id}>
													{r.number} · {t[r.state as "draft"] ?? r.state}
												</option>
											))}
									</select>
								</label>
								{sourceErrors.length > 0 && (
									<p id={`${fieldId("source")}-error`} className="text-danger">
										{issueMessage("source_structure", locale)}
									</p>
								)}
							</>
						)}
						<DocumentFields
							data={buffer.payload}
							kind={item.kind}
							locale={locale}
							onChange={(payload) => edit({ ...buffer, payload })}
						/>
						<Button type="submit" disabled={!editable || busy || pending}>
							{t.save}
						</Button>
					</fieldset>
				</form>
				{!editable && <p>{t.readOnly}</p>}
				<div className="flex flex-wrap gap-3">
					<Button
						variant="secondary"
						disabled={busy || pending}
						onClick={() => void preview(false)}
					>
						{t.preview}
					</Button>
					{selected && (
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => void preview(true)}
						>
							{copy.savedPreview}
						</Button>
					)}
				</div>
				{workingPreview && (
					<section
						data-testid="content-preview"
						className="min-w-0 rounded-card border border-border p-4"
					>
						<p className="font-bold">{copy.working}</p>
						{renderPreview(buffer.payload, buffer.locale)}
					</section>
				)}
				{savedPreview && (
					<section
						data-testid="saved-content-preview"
						className="min-w-0 rounded-card border border-border p-4"
					>
						<p className="font-bold">{copy.savedTarget}</p>
						<p>
							{t.revision}: <bdi>{savedPreview.id}</bdi> · {savedPreview.number}{" "}
							· <bdi>{savedPreview.locale}</bdi>
						</p>
						<p>
							{t.source}: <bdi>{savedPreview.source_id ?? "—"}</bdi>
						</p>
						{renderPreview(savedPreview.payload, savedPreview.locale as Locale)}
					</section>
				)}
				{selected && (
					<form
						onSubmit={(e) => e.preventDefault()}
						className="space-y-4 rounded-card border border-border p-4"
					>
						<p>
							{copy.savedTarget}: <bdi>{selected.id}</bdi> · {selected.number} ·{" "}
							<bdi>{selected.locale}</bdi>
						</p>
						<p>
							{t.state}: {t[selected.state as "draft"] ?? selected.state} ·{" "}
							{t.source}: <bdi>{selected.source_id ?? "—"}</bdi>
						</p>
						<Field
							label={t.reason}
							value={reason}
							maxLength={1000}
							disabled={busy || pending}
							onChange={(e) => setReason(e.target.value)}
						/>
						<div className="flex flex-wrap gap-3">
							{actions.map((action) => (
								<Button
									key={action}
									disabled={busy || dirty || pending || !reason.trim()}
									variant="secondary"
									onClick={() => void mutate(action)}
								>
									{t[action]}
								</Button>
							))}
						</div>
					</form>
				)}
				<details className="rounded-card border border-border p-4">
					<summary>{t.history}</summary>
					<ul>
						{item.history.map((event) => (
							<li key={event.id}>
								{t[event.action as "save"] ?? event.action} ·{" "}
								<bdi>{event.created_at}</bdi>
								<p>
									{event.actor_name} · {event.reason}
								</p>
							</li>
						))}
					</ul>
				</details>
			</div>
		</ValidationContext.Provider>
	);
}
