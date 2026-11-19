"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { privateRequest } from "../../../lib/api/private-client";
import type { PublicProduct } from "../../marketplace/types";
import { mediaUrl } from "../../marketplace/api";
import { Icon } from "../../../components/ui/icon";
import { Button } from "../../../components/shadcn/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../../components/shadcn/dialog";
import { localTimestamp, type Conversation } from "../api";
import { communicationCopy } from "../copy";
import { iconBtn, badge, help, Failure } from "./ui";

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
		controller = useRef<AbortController | null>(null);
	const [open, setOpen] = useState(false),
		[product, setProduct] = useState<PublicProduct | null>(null),
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
	const cover = product?.images[0];
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next && !product && !error && !busy) void load();
			}}
		>
			<span className="flex shrink-0 gap-2">
				<DialogTrigger asChild>
					<button
						type="button"
						className={iconBtn}
						title={t.viewInfo}
						aria-label={t.viewInfo}
					>
						<Icon name="eye" className="size-4" />
					</button>
				</DialogTrigger>
			</span>
			<DialogContent
				dir={direction(locale)}
				closeLabel={t.close}
				className="max-w-xl gap-4 rounded-2xl p-6"
			>
				<DialogHeader className="gap-1.5 pe-10 text-start">
					<DialogTitle className="break-words text-lg font-bold" dir="auto">
						{snapshot.title}
					</DialogTitle>
					{unread && <span className={badge}>{t.unread}</span>}
				</DialogHeader>
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
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="self-start rounded-lg"
							onClick={() => void load()}
						>
							{t.retry}
						</Button>
					</div>
				) : null}
				<dl className="m-0 divide-y divide-border rounded-xl border border-border bg-page px-3 text-sm [&_dd]:m-0">
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
				<DialogFooter className="gap-2">
					<Button asChild className="rounded-lg">
						<Link
							prefetch={false}
							href={`/${locale}/products/${snapshot.product}`}
						>
							<Icon name="eye" className="size-4" />
							{t.product}
						</Link>
					</Button>
					<DialogClose asChild>
						<Button type="button" variant="secondary" className="rounded-lg">
							{t.close}
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}