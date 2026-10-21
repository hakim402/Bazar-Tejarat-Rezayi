"use client";
import { ContentEditor } from "./content-editor";
import { editorFailure } from "./editor-validation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { contentCopy, contentTypeNames } from "../../../lib/i18n/content";
import type { Locale } from "../../../lib/i18n/locales";
import { privateRequest } from "../../../lib/api/private-client";
import { Button } from "../../../components/ui/button";
import { Field } from "./document-fields";
import type { EditorItem, EditorList, Operation } from "../types";
const base = "content/editor/staff/items/";
export function ContentWorkspace({
	locale,
	contentKey,
}: {
	locale: Locale;
	contentKey?: string;
}) {
	const t = contentCopy[locale];
	const [list, setList] = useState<EditorList | null>(null);
	const [item, setItem] = useState<EditorItem | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const [slug, setSlug] = useState("");
	const [listPage, setListPage] = useState(1);
	const load = useCallback(async () => {
		setBusy(true);
		setError("");
		try {
			const result = await privateRequest<EditorList>(
				`${base}?page=${listPage}`,
			);
			setList(result);
			if (contentKey)
				setItem(await privateRequest<EditorItem>(`${base + contentKey}/`));
		} catch (e) {
			setError(editorFailure(e, locale).message);
			setItem(null);
			setList(null);
		} finally {
			setBusy(false);
		}
	}, [contentKey, locale, listPage]);
	useEffect(() => {
		void load();
	}, [load]);
	async function mutate(path: string, data: unknown) {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await privateRequest<Operation>(path, data);
			await load();
			setNotice(t.saved);
			return true;
		} catch (e) {
			setError(editorFailure(e, locale).message);
			return false;
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="min-w-0 space-y-5">
			<h1 className="text-3xl">{t.editor}</h1>
			{!contentKey && (
				<Link href={`/${locale}/account/staff/content`}>{t.editor}</Link>
			)}
			{error && (
				<p
					role="alert"
					className="rounded-control bg-danger-surface p-4 text-danger"
				>
					{error}
				</p>
			)}
			{!contentKey && (
				<>
					<p role="status">{busy ? t.loading : notice}</p>
					<Button variant="secondary" disabled={busy} onClick={load}>
						{t.reload}
					</Button>
				</>
			)}
			{list && !contentKey && (
				<>
					<ul className="list-none space-y-4 p-0">
						{list.results.map((r) => (
							<li key={r.id} className="rounded-card border border-border p-4">
								<Link href={`/${locale}/account/staff/content/${r.key}`}>
									<bdi>{r.key}</bdi>
								</Link>
								<p>
									{contentTypeNames[locale][r.kind]} · {t.version} {r.version} ·{" "}
									{r.states.map((s) => t[s as "draft"] ?? s).join(" / ")}
								</p>
								<p>
									{t.locale}: <bdi>{r.locales.join(", ")}</bdi> · {t.published}:{" "}
									<bdi>{Object.keys(r.publications).join(", ") || "—"}</bdi>
								</p>
							</li>
						))}
					</ul>
					<nav className="flex flex-wrap gap-4" aria-label={t.editor}>
						{listPage > 1 && (
							<Button
								variant="secondary"
								onClick={() => setListPage(listPage - 1)}
							>
								{t.previous}
							</Button>
						)}
						{list.count > listPage * 50 && (
							<Button
								variant="secondary"
								onClick={() => setListPage(listPage + 1)}
							>
								{t.next}
							</Button>
						)}
					</nav>
					{list.permissions.includes("edit_content") && (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void mutate(base, { key: slug, kind: "article" });
							}}
							className="rounded-card border border-border p-4"
						>
							<Field
								label={t.key}
								value={slug}
								pattern="[a-z][a-z0-9-]*"
								maxLength={80}
								required
								dir="ltr"
								onChange={(e) => setSlug(e.target.value)}
							/>
							<Button type="submit" disabled={busy}>
								{t.create}
							</Button>
						</form>
					)}
				</>
			)}
			{item && list && (
				<ContentEditor
					key={item.id}
					initial={item}
					permissions={list.permissions}
					locale={locale}
					onDenied={() => {
						setItem(null);
						void load();
					}}
				/>
			)}
		</div>
	);
}
