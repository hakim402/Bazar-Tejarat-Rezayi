"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { privateRequest, AccountError } from "../../../lib/api/private-client";
import { useUnsavedNavigation } from "../../../components/layout/navigation-guard";
import { communicationCopy } from "../copy";
import {
	clearDrafts,
	draftFor,
	saveDraft,
	dropDraft,
	type Draft,
	type Prepared,
	type Pending,
} from "../drafts";
import { accessLost } from "../hooks";
import type { ImageRef, Sent } from "../api";
import { control, action, primaryAction, Failure } from "./controls";
export function Composer({
	locale,
	draftKey,
	uploadPath,
	send,
	onSaved,
	onExisting,
	onDenied,
	allowed = true,
}: {
	locale: Locale;
	draftKey: string;
	uploadPath: string;
	send: (value: Pending, signal: AbortSignal) => Promise<Sent>;
	onSaved: (result: Sent) => void;
	onExisting?: (id: string, draft: Draft) => void;
	onDenied?: (error: unknown) => void;
	allowed?: boolean;
}) {
	const t = communicationCopy[locale],
		[draft, setDraft] = useState<Draft>(() => draftFor(draftKey)),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<unknown>(null),
		[notice, setNotice] = useState("");
	const live = useRef<object | null>({}),
		write = useRef<object | null>(null),
		current = useRef(draft),
		controllers = useRef(new Set<AbortController>());
	const update = (next: Draft) => {
		current.current = next;
		saveDraft(draftKey, next);
		setDraft(next);
	};
	useEffect(() => {
		live.current = {};
		return () => {
			live.current = null;
			write.current = null;
			for (const c of controllers.current) c.abort();
		};
	}, []);
	const dirty = !!draft.body || !!draft.images.length || !!draft.pending;
	const guard = useCallback(
		(action: () => void) => {
			if (window.confirm(t.discard)) {
				dropDraft(draftKey);
				action();
			}
		},
		[draftKey, t.discard],
	);
	useUnsavedNavigation(dirty, guard);
	async function upload(row: Prepared) {
		if (write.current || !row.file || !allowed) return;
		const owner = {};
		write.current = owner;
		const lifecycle = live.current;
		const controller = new AbortController();
		controllers.current.add(controller);
		setBusy(true);
		setError(null);
		update({
			...current.current,
			images: current.current.images.map((x) =>
				x.localId === row.localId ? { ...x, failed: true } : x,
			),
		});
		try {
			const form = new FormData();
			form.set("command_id", row.command);
			form.set("file", row.file);
			const image = await privateRequest<ImageRef>(uploadPath, form, "POST", {
				signal: controller.signal,
			});
			if (!lifecycle || live.current !== lifecycle || write.current !== owner)
				return;
			update({
				...current.current,
				images: current.current.images.map((x) =>
					x.localId === row.localId
						? { localId: row.localId, command: row.command, image }
						: x,
				),
			});
		} catch (e) {
			if (lifecycle && live.current === lifecycle && write.current === owner) {
				if (accessLost(e)) {
					clearDrafts();
					onDenied?.(e);
					current.current = { body: "", images: [] };
					setDraft(current.current);
				}
				setError(e);
			}
		} finally {
			controllers.current.delete(controller);
			if (lifecycle && live.current === lifecycle && write.current === owner) {
				write.current = null;
				setBusy(false);
			}
		}
	}
	async function submit() {
		if (
			write.current ||
			!allowed ||
			current.current.images.some((x) => !x.image)
		)
			return;
		const owner = {};
		write.current = owner;
		const lifecycle = live.current;
		const controller = new AbortController();
		controllers.current.add(controller);
		setBusy(true);
		setNotice("");
		setError(null);
		const reconciling = current.current.pending !== undefined;
		const packet = current.current.pending ?? {
			command_id: crypto.randomUUID(),
			body: current.current.body,
			images: current.current.images.flatMap((x) =>
				x.image ? [x.image.id] : [],
			),
		};
		update({ ...current.current, pending: packet });
		try {
			const result = await send(packet, controller.signal);
			if (!lifecycle || live.current !== lifecycle || write.current !== owner)
				return;
			update({ body: "", images: [] });
			dropDraft(draftKey);
			setNotice(t.saved);
			onSaved(result);
		} catch (e) {
			if (!lifecycle || live.current !== lifecycle || write.current !== owner)
				return;
			if (e instanceof AccountError && e.resource && onExisting) {
				const retained = { ...current.current, pending: undefined };
				onExisting(e.resource, retained);
				dropDraft(draftKey);
				return;
			}
			if (accessLost(e)) {
				clearDrafts();
				onDenied?.(e);
				current.current = { body: "", images: [] };
				setDraft(current.current);
			} else if (
				!reconciling &&
				e instanceof AccountError &&
				[400, 409, 429].includes(e.status ?? 0)
			)
				update({ ...current.current, pending: undefined });
			setError(e);
		} finally {
			controllers.current.delete(controller);
			if (lifecycle && live.current === lifecycle && write.current === owner) {
				write.current = null;
				setBusy(false);
			}
		}
	}
	return (
		<section
			className="space-y-3 rounded-card border border-border bg-surface p-4"
			aria-label={t.body}
			data-testid="message-composer"
		>
			<p className="text-sm text-muted">{t.enquiryNote}</p>
			<p className="text-sm text-muted">{t.privacy}</p>
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<label className="block space-y-2">
					<span className="font-bold">{t.body}</span>
					<textarea
						name="message"
						className={`${control} min-h-32 resize-y [unicode-bidi:plaintext]`}
						dir="auto"
						maxLength={6000}
						value={draft.body}
						disabled={!allowed || busy || !!draft.pending}
						aria-describedby="message-limits"
						onChange={(e) =>
							update({ ...current.current, body: e.target.value })
						}
					/>
				</label>
				<p id="message-limits" className="text-sm text-muted">
					<bdi>{draft.body.length} / 6000</bdi> · {t.imageRule}
				</p>
				<label className="block space-y-2">
					<span>{t.images}</span>
					<input
						type="file"
						className="block w-full min-w-0 max-w-full text-sm"
						accept="image/jpeg,image/png,image/webp"
						disabled={
							!allowed || busy || draft.images.length >= 3 || !!draft.pending
						}
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (!file) return;
							if (
								file.size > 5 * 1024 * 1024 ||
								!["image/jpeg", "image/png", "image/webp"].includes(file.type)
							) {
								setError(new AccountError(400));
								return;
							}
							const row: Prepared = {
								localId: crypto.randomUUID(),
								command: crypto.randomUUID(),
								file,
							};
							update({
								...current.current,
								images: [...current.current.images, row],
							});
							void upload(row);
						}}
					/>
				</label>
				{!!draft.images.length && (
					<ul className="space-y-2">
						{draft.images.map((row, index) => (
							<li
								key={row.localId}
								className="flex flex-wrap items-center gap-3 rounded-control border border-border p-3"
							>
								<span>
									{t.images} <bdi>{index + 1}</bdi> ·{" "}
									{row.image
										? `${row.image.width} × ${row.image.height}`
										: busy
											? t.prepare
											: t.uploadFailed}
								</span>
								{!row.image && (
									<button
										className={action}
										type="button"
										disabled={busy || !allowed || !!draft.pending}
										onClick={() => void upload(row)}
									>
										{t.retry}
									</button>
								)}
								<button
									className={action}
									type="button"
									disabled={busy || !!draft.pending}
									onClick={() =>
										update({
											...current.current,
											images: current.current.images.filter(
												(x) => x.localId !== row.localId,
											),
										})
									}
								>
									{t.remove}
								</button>
							</li>
						))}
					</ul>
				)}
				{draft.pending && !busy && (
					<p role="status" className="text-sm text-warning">
						{t.uncertain}
					</p>
				)}
				{!!error && <Failure locale={locale} error={error} />}{" "}
				{notice && <p role="status">{notice}</p>}
				<div className="flex flex-wrap gap-3">
					<button
						className={primaryAction}
						type="submit"
						disabled={
							!allowed ||
							busy ||
							(!draft.body.trim() && !draft.images.length) ||
							draft.images.some((x) => !x.image)
						}
					>
						{busy ? t.sending : draft.pending ? t.retry : t.send}
					</button>
					{dirty && (
						<button
							className={action}
							type="button"
							disabled={busy}
							onClick={() => {
								if (window.confirm(t.discard)) {
									update({ body: "", images: [] });
									dropDraft(draftKey);
									setError(null);
								}
							}}
						>
							{t.discardDraft}
						</button>
					)}
				</div>
			</form>
		</section>
	);
}
