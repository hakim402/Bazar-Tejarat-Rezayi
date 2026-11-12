"use client";
import { useEffect, useRef, useState } from "react";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { marketplaceCopy } from "../copy";
import type { PublicProduct } from "../types";
import { Asset } from "./cards";
export function ProductGallery({
	images,
	locale,
	activeId,
	onSelect,
}: {
	images: PublicProduct["images"];
	locale: Locale;
	activeId?: string;
	onSelect: (id: string) => void;
}) {
	const t = marketplaceCopy[locale],
		rtl = direction(locale) === "rtl",
		[open, setOpen] = useState(false),
		zoomRef = useRef<HTMLButtonElement>(null),
		closeRef = useRef<HTMLButtonElement>(null),
		index = Math.max(
			0,
			images.findIndex((row) => row.id === activeId),
		),
		image = images[index];
	useEffect(() => {
		if (!open) return;
		closeRef.current?.focus();
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
			zoomRef.current?.focus();
		};
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
			if (event.key === "ArrowRight")
				onSelect(images[rtl ? index - 1 : index + 1]?.id ?? images[index].id);
			if (event.key === "ArrowLeft")
				onSelect(images[rtl ? index + 1 : index - 1]?.id ?? images[index].id);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, index, images, onSelect, rtl]);
	const step = (delta: 1 | -1) =>
		onSelect(images[index + delta]?.id ?? images[index].id);
	const roundControl =
		"flex size-10 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-lifted transition-colors hover:bg-info hover:text-action active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-foreground";
	return (
		<div className="flex min-w-0 flex-col gap-3 desktop:flex-row">
			{images.length > 1 && (
				<fieldset className="carousel-track order-2 m-0 flex min-w-0 gap-2 overflow-x-auto border-0 p-0 pb-1 desktop:order-1 desktop:max-h-[24rem] desktop:w-16 desktop:flex-col desktop:overflow-x-hidden desktop:overflow-y-auto desktop:pb-0 desktop:pe-1">
					<legend className="sr-only">{t.images}</legend>
					{images.map((asset, i) => (
						<button
							key={asset.id}
							type="button"
							aria-pressed={i === index}
							aria-label={asset.alt || `${t.zoomImage} ${i + 1}`}
							onClick={() => onSelect(asset.id)}
							className={`size-14 shrink-0 overflow-hidden rounded-control border bg-surface p-1 transition-colors active:scale-95 motion-reduce:active:scale-100 sm:size-16 ${
								i === index
									? "border-action ring-2 ring-action/30"
									: "border-border hover:border-action/50"
							}`}
						>
							<Asset asset={asset} className="size-full object-contain" />
						</button>
					))}
				</fieldset>
			)}
			<div className="order-1 flex min-w-0 flex-1 items-center justify-center desktop:order-2">
				{image ? (
					<div className="relative max-w-full">
						<Asset
							asset={image}
							loading="eager"
							className="block max-h-[22rem] w-auto max-w-full rounded-card border border-border bg-page object-contain sm:max-h-[26rem]"
						/>
						<button
							ref={zoomRef}
							type="button"
							aria-label={t.zoomImage}
							title={t.zoomImage}
							onClick={() => setOpen(true)}
							className="absolute bottom-3 end-3 flex size-10 items-center justify-center rounded-full border border-border bg-surface/90 text-foreground shadow-lifted backdrop-blur-sm transition-colors hover:text-action active:scale-95 motion-reduce:active:scale-100"
						>
							<Icon name="zoom-in" className="size-5" />
						</button>
					</div>
				) : (
					<div className="flex aspect-[4/3] w-full items-center justify-center rounded-card border border-border bg-page text-muted">
						<Icon name="image" className="size-10" />
						<span className="sr-only">{t.noImage}</span>
					</div>
				)}
			</div>
			{open && image && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label={t.zoomImage}
					onClick={(event) => {
						if (event.target === event.currentTarget) setOpen(false);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false);
					}}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
				>
					<div className="flex min-w-0 flex-col items-center gap-4">
						<Asset
							asset={image}
							loading="eager"
							className="max-h-[78vh] w-auto max-w-full rounded-card bg-surface object-contain"
						/>
						<div className="flex items-center gap-2">
							<button
								type="button"
								aria-label={t.previous}
								disabled={index === 0}
								onClick={() => step(-1)}
								className={roundControl}
							>
								<Icon name="chevron" className="size-4 rotate-180" />
							</button>
							<bdi className="min-w-16 text-center text-sm font-bold text-white">
								{index + 1}/{images.length}
							</bdi>
							<button
								type="button"
								aria-label={t.next}
								disabled={index === images.length - 1}
								onClick={() => step(1)}
								className={roundControl}
							>
								<Icon name="chevron" className="size-4" />
							</button>
							<button
								ref={closeRef}
								type="button"
								aria-label={t.closeImage}
								onClick={() => setOpen(false)}
								className={roundControl}
							>
								<Icon name="close" className="size-4" />
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
