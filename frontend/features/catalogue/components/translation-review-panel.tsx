"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "../../../components/ui/button";
import { catalogueCopy, catalogueStatuses } from "../../../lib/i18n/catalogue";
import { locales, type Locale } from "../../../lib/i18n/locales";
import type { ProductDetail, Revision, Translation } from "../types";
import { Control } from "./catalogue-fields";
export function TranslationReviewPanel({
	item,
	revision,
	locale,
	busy,
	onAction,
	onDirty,
}: {
	item: ProductDetail;
	revision: Revision;
	locale: Locale;
	busy: boolean;
	onDirty: (dirty: boolean) => void;
	onAction: (target: Locale, data: Record<string, unknown>) => Promise<boolean>;
}) {
	const t = catalogueCopy[locale];
	const targets = locales.filter((l) => l !== revision.body.locale);
	const [target, setTarget] = useState<Locale>(targets[0]);
	const existing = item.translations.find(
		(v) => v.revision === revision.id && v.locale === target,
	);
	const initial = useCallback(
		(value?: Translation) => ({
			title: value?.title ?? "",
			description: value?.description ?? "",
			image_alts:
				value?.image_alts ??
				Object.fromEntries(revision.body.images.map((i) => [i.id, ""])),
		}),
		[revision.body.images],
	);
	const [buffer, setBuffer] = useState(() => initial(existing));
	const [baseline, setBaseline] = useState(JSON.stringify(buffer));
	const [discard, setDiscard] = useState<Locale | null>(null);
	const dirty = JSON.stringify(buffer) !== baseline;
	useEffect(() => {
		onDirty(dirty);
	}, [dirty, onDirty]);
	useEffect(() => {
		if (!dirty) {
			const value = initial(existing);
			setBuffer(value);
			setBaseline(JSON.stringify(value));
		}
	}, [existing, initial, dirty]);
	function select(next: Locale) {
		setTarget(next);
		const row = item.translations.find(
			(v) => v.revision === revision.id && v.locale === next,
		);
		const value = initial(row);
		setBuffer(value);
		setBaseline(JSON.stringify(value));
		setDiscard(null);
	}
	async function action(name: string) {
		const ok = await onAction(target, {
			version: existing?.version ?? 1,
			action: name,
			...(["generate", "retry"].includes(name) ? {} : buffer),
			reason: reason,
		});
		if (ok) {
			setBaseline(JSON.stringify(buffer));
		}
	}
	const [reason, setReason] = useState("");
	return (
		<section className="space-y-4 rounded-control border border-border p-4">
			<h2 className="text-xl">{t.translations}</h2>
			<p>
				{t.provider}:{" "}
				<span>
					{catalogueStatuses[locale][item.provider] ?? t.providerPending}
				</span>
			</p>
			{!["groq", "test_adapter"].includes(item.provider) && (
				<p className="bg-warning-surface p-3 text-warning">
					{t.providerPending}
				</p>
			)}
			<Control
				path="translation.locale"
				label={t.language}
				value={target}
				options={targets.map((l) => ({ value: l, label: l }))}
				onChange={(value) =>
					dirty ? setDiscard(value as Locale) : select(value as Locale)
				}
			/>
			{discard && (
				<div role="alert" className="rounded-control border border-warning p-3">
					<p>{t.dirty}</p>
					<Button onClick={() => select(discard)}>{t.confirm}</Button>
					<Button variant="secondary" onClick={() => setDiscard(null)}>
						{t.cancel}
					</Button>
				</div>
			)}
			<p>
				<bdi>{revision.id}</bdi> ·{" "}
				{catalogueStatuses[locale][existing?.state ?? "draft"]} ·{" "}
				{existing?.version ?? 1}
			</p>
			<fieldset disabled={busy} className="min-w-0 space-y-4">
				<Control
					path="title"
					label={t.productTitle}
					value={buffer.title}
					onChange={(title) => setBuffer({ ...buffer, title })}
				/>
				<Control
					path="description"
					label={t.description}
					value={buffer.description}
					textarea
					onChange={(description) => setBuffer({ ...buffer, description })}
				/>
				{revision.body.images.map((image, index) => (
					<Control
						key={image.id}
						path={`image_alts.${index}`}
						label={t.alt}
						value={buffer.image_alts[image.id] ?? ""}
						onChange={(alt) =>
							setBuffer({
								...buffer,
								image_alts: { ...buffer.image_alts, [image.id]: alt },
							})
						}
					/>
				))}
				<Control
					path="translation.reason"
					label={t.reason}
					value={reason}
					onChange={setReason}
				/>
				<div className="flex flex-wrap gap-3">
					<Button onClick={() => void action("save")}>
						{t.translationSave}
					</Button>
					<Button
						disabled={dirty || existing?.state !== "draft" || !existing?.title}
						onClick={() => void action("approve")}
					>
						{t.translationApprove}
					</Button>
					<Button
						variant="secondary"
						disabled={dirty || existing?.state !== "draft"}
						onClick={() => void action("reject")}
					>
						{t.translationReject}
					</Button>
					<Button
						variant="secondary"
						disabled={
							dirty ||
							!!existing?.human_edited ||
							!!existing?.has_approved ||
							!!existing?.job
						}
						onClick={() => void action("generate")}
					>
						{t.generate}
					</Button>
					<Button
						variant="secondary"
						disabled={
							dirty ||
							!existing?.job ||
							!!existing?.human_edited ||
							!!existing?.has_approved ||
							!["failed", "blocked"].includes(existing.job.status) ||
							existing.job.attempts >= 3
						}
						onClick={() => void action("retry")}
					>
						{t.retry}
					</Button>
				</div>
			</fieldset>
			{existing?.job && (
				<p role="status">
					<bdi>
						{catalogueStatuses[locale][existing.job.status] ?? t.unavailable} ·{" "}
						{existing.job.attempts} · {existing.job.error_code}
					</bdi>
				</p>
			)}
			{dirty && <p className="text-warning">{t.dirty}</p>}
		</section>
	);
}
