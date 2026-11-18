"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { privateRequest } from "../../../lib/api/private-client";
import type { PublicProduct } from "../../marketplace/types";
import { mediaUrl } from "../../marketplace/api";
import { Icon } from "../../../components/ui/icon";
import { localTimestamp, type Conversation } from "../api";
import { communicationCopy } from "../copy";
import {
	panel,
	actionBtn,
	primaryBtn,
	iconBtn,
	badge,
	help,
	Failure,
} from "./ui";

export function ConversationInfo({
	locale,
	snapshot,
	buyer,
	updatedAt,
	unread,
}: {
	locale: Locale;
	snapshot: Conversation["snapshot"];
	buyer: string | null;
	updatedAt: string | null;
	unread: boolean;
}) {
	const t = communicationCopy[locale],
		dialog = useRef<HTMLDialogElement>(null),
		controller = useRef<AbortController | null>(null);
	const [product, setProduct] = useState<PublicProduct | null>(null),
		[error, setError] = useState<unknown>(null),
		[busy, setBusy] = useState(false);
	useEffect(() => () => controller.current?.abort(), []);
	async function load() {
		controller.current?.abort();
		const request = new AbortController();
		controller.current = request;
		setBusy(true);
		setError(null);
		try {
			const value = await privateRequest<PublicProduct>(
				`marketplace/public/${locale}/products/${snapshot.product}/`,
				undefined,
				"GET",
				{ signal: request.signal },
			);
			if (!request.signal.aborted) setProduct(value);
		} catch (e) {
			if (!request.signal.aborted) setError(e);
		} finally {
			if (!request.signal.aborted) setBusy(false);
		}
	}
	const open = () => {
		dialog.current?.showModal();
		if (!product && !error && !busy) void load();
	};
	const cover = product?.images[0];
	return (
		<>
			<span className="flex shrink-0 gap-2">
				<button
					type="button"
					className={iconBtn}
					title={t.viewInfo}
					aria-label={t.viewInfo}
					onClick={open}
				>
					<Icon name="eye" className="size-4" />
				</button>
			</span>
			<dialog
				ref={dialog}
				aria-label={t.viewInfo}
				className={`${panel} max-h-[90dvh] w-[min(34rem,94vw)] space-y-4 overflow-auto p-4 text-foreground shadow-lifted backdrop:bg-black/50 sm:p-5`}
			>
				<header className="flex items-start justify-between gap-3">
					<div className="min-w-0 space-y-1.5">
						<h2 className="break-words text-lg font-bold" dir="auto">
							{snapshot.title}
						</h2>
						{unread && <span className={badge}>{t.unread}</span>}
					</div>
					<button
						type="button"
						className={iconBtn}
						aria-label={t.close}
						onClick={() => dialog.current?.close()}
					>
						<Icon name="close" className="size-4" />
					</button>
				</header>
				{cover ? (
					// biome-ignore lint/performance/noImgElement: single dialog preview of a public marketplace asset.
					<img
						src={mediaUrl(cover.url)}
						alt={cover.alt}
						width={cover.width}
						height={cover.height}
						className="max-h-64 w-full rounded-xl border border-border object-cover"
					/>
				) : busy ? (
					<p
						role="status"
						className={`${help} rounded-xl border border-border bg-page p-4 text-center`}
					>
						{t.loading}
					</p>
				) : error ? (
					<div className="space-y-2 rounded-xl border border-border bg-page p-3">
						<Failure locale={locale} error={error} />
						<p className={help}>{t.productUnavailable}</p>
						<button
							type="button"
							className={actionBtn}
							onClick={() => void load()}
						>
							{t.retry}
						</button>
					</div>
				) : null}
				<dl className="divide-y divide-border rounded-xl border border-border bg-page px-3 text-sm">
					<div className="flex items-start justify-between gap-3 py-2.5">
						<dt className={help}>{t.productName}</dt>
						<dd className="min-w-0 break-words font-semibold" dir="auto">
							{product?.body.title ?? snapshot.title}
						</dd>
					</div>
					<div className="flex items-start justify-between gap-3 py-2.5">
						<dt className={help}>{t.sku}</dt>
						<dd className="flex min-w-0 flex-wrap justify-end gap-1">
							{product ? (
								product.variants.map((variant) => (
									<span key={variant.id} className={badge}>
										<bdi dir="ltr">{variant.sku}</bdi>
									</span>
								))
							) : (
								<span className={help}>—</span>
							)}
						</dd>
					</div>
					<div className="flex items-start justify-between gap-3 py-2.5">
						<dt className={help}>{t.store}</dt>
						<dd className="min-w-0 break-words font-semibold" dir="auto">
							{snapshot.seller}
						</dd>
					</div>
					<div className="flex items-start justify-between gap-3 py-2.5">
						<dt className={help}>{t.currency}</dt>
						<dd className="font-semibold">
							<bdi dir="ltr">{snapshot.currency}</bdi>
						</dd>
					</div>
					{buyer && (
						<div className="flex items-start justify-between gap-3 py-2.5">
							<dt className={help}>{t.buyer}</dt>
							<dd className="min-w-0 break-words font-semibold" dir="auto">
								{buyer}
							</dd>
						</div>
					)}
					{updatedAt && (
						<div className="flex items-start justify-between gap-3 py-2.5">
							<dt className={help}>{t.updated}</dt>
							<dd className="font-semibold">
								<bdi>{localTimestamp(updatedAt, locale)}</bdi>
							</dd>
						</div>
					)}
				</dl>
				<footer className="flex flex-wrap justify-end gap-2">
					<Link
						prefetch={false}
						className={primaryBtn}
						href={`/${locale}/products/${snapshot.product}`}
					>
						<Icon name="eye" className="size-4" />
						{t.product}
					</Link>
					<button
						type="button"
						className={actionBtn}
						onClick={() => dialog.current?.close()}
					>
						{t.close}
					</button>
				</footer>
			</dialog>
		</>
	);
}
