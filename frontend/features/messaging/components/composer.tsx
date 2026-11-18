"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { privateRequest, AccountError } from "../../../lib/api/private-client";
import { useUnsavedNavigation } from "../../../components/layout/navigation-guard";
import { DiscardDialog } from "../../../components/ui/discard-dialog";
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
import { panel, actionBtn, iconBtn, Failure, failureMessage } from "./ui";

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
		[error, setError] = useState<unknown>(null);
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
	const [leave, setLeave] = useState<(() => void) | null>(null);
	const guard = useCallback(
		(action: () => void) => {
			setLeave(() => () => {
				dropDraft(draftKey);
				action();
			});
		},
		[draftKey],
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
				} else {
					toast.error(t.uploadFailed);
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
			toast.success(t.saved);
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
			) {
				update({ ...current.current, pending: undefined });
				toast.error(failureMessage(locale, e));
			} else {
				toast.error(failureMessage(locale, e));
			}
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
			className={`${panel} p-2 sm:p-3`}
			aria-label={t.body}
			data-testid="message-composer"
		>
			<form
				className="space-y-2"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				{!!draft.images.length && (
					<ul className="m-0 flex list-none flex-wrap gap-2 p-0">
						{draft.images.map((row, index) => (
							<li
								key={row.localId}
								className="flex items-center gap-1 rounded-xl border border-border bg-page ps-3 pe-1 text-xs"
							>
								<Icon name="image" className="size-4 text-action" />
								<span className="min-w-0">
									{t.images} <bdi>{index + 1}</bdi> ·{" "}
									{row.image
										? `${row.image.width} × ${row.image.height}`
										: busy
											? t.prepare
											: t.uploadFailed}
								</span>
								{!row.image && (
									<button
										className={actionBtn}
										type="button"
										disabled={busy || !allowed || !!draft.pending}
										onClick={() => void upload(row)}
									>
										{t.retry}
									</button>
								)}
								<button
									className={iconBtn}
									type="button"
									title={t.remove}
									aria-label={t.remove}
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
									<Icon name="close" className="size-4" />
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
				{!!error && <Failure locale={locale} error={error} />}
				<div className="flex items-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action">
					<label className="min-w-0 flex-1">
						<span className="sr-only">{t.body}</span>
						<textarea
							name="message"
							rows={1}
							className="max-h-40 min-h-6 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-base text-foreground [unicode-bidi:plaintext] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							dir="auto"
							maxLength={6000}
							placeholder={t.body}
							value={draft.body}
							disabled={!allowed || busy || !!draft.pending}
							onChange={(e) =>
								update({ ...current.current, body: e.target.value })
							}
						/>
					</label>
					<button
						className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-action transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
						type="submit"
						title={busy ? t.sending : draft.pending ? t.retry : t.send}
						aria-label={busy ? t.sending : draft.pending ? t.retry : t.send}
						disabled={
							!allowed ||
							busy ||
							(!draft.body.trim() && !draft.images.length) ||
							draft.images.some((x) => !x.image)
						}
					>
						<Icon name="send" className="size-5" />
					</button>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label
						className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-info hover:text-action focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action"
						title={t.attach}
					>
						<Icon name="paperclip" className="size-4" />
						{t.attach}
						<input
							type="file"
							aria-label={t.attach}
							className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
					{dirty && (
						<button
							className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-info hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
							type="button"
							title={t.discardDraft}
							aria-label={t.discardDraft}
							disabled={busy}
							onClick={() => {
								setLeave(() => () => {
									update({ body: "", images: [] });
									dropDraft(draftKey);
									setError(null);
								});
							}}
						>
							<Icon name="trash" className="size-4" />
							{t.discardDraft}
						</button>
					)}
				</div>
			</form>
			<DiscardDialog
				locale={locale}
				open={leave !== null}
				title={t.discard}
				cancelLabel={t.keep}
				confirmLabel={t.discardDraft}
				onCancel={() => setLeave(null)}
				onConfirm={() => {
					const next = leave;
					setLeave(null);
					next?.();
				}}
			/>
		</section>
	);
}
