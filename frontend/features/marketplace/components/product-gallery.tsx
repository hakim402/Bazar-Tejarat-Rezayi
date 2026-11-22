"use client";

import { Button } from "@/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@/components/shadcn/dialog";
import { Icon } from "@/components/ui/icon";
import { direction, type Locale } from "@/lib/i18n/locales";
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
	const t = marketplaceCopy[locale];
	const dir = direction(locale);
	const index = Math.max(
		0,
		images.findIndex((row) => row.id === activeId),
	);
	const image = images[index];
	if (!image) return null;

	function step(delta: number) {
		const next = images[index + delta];
		if (next) onSelect(next.id);
	}

	return (
		<Dialog>
			<div className="relative isolate aspect-[5/4] max-h-[34rem] overflow-hidden rounded-card bg-linear-to-br from-surface to-info lg:aspect-square">
				<Asset
					asset={image}
					loading="eager"
					className="absolute inset-0 block size-full object-contain p-4 sm:p-7"
				/>
				<DialogTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="icon-lg"
						className="absolute end-3 bottom-3 rounded-full sm:end-4 sm:bottom-4"
						aria-label={t.zoomImage}
						title={t.zoomImage}
					>
						<Icon name="zoom-in" className="size-5" />
					</Button>
				</DialogTrigger>
			</div>
			{images.length > 1 && (
				<fieldset className="carousel-track mt-3 flex min-w-0 gap-2 overflow-x-auto border-0 p-1">
					<legend className="sr-only">{t.images}</legend>
					{images.map((asset, i) => (
						<Button
							key={asset.id}
							type="button"
							size="icon"
							variant="outline"
							aria-pressed={i === index}
							aria-label={asset.alt || `${t.images} ${i + 1}`}
							onClick={() => onSelect(asset.id)}
							className={`size-14 overflow-hidden rounded-control p-1 sm:size-16 ${i === index ? "border-action ring-1 ring-action" : ""}`}
						>
							<Asset asset={asset} className="size-full object-contain" />
						</Button>
					))}
				</fieldset>
			)}
			<DialogContent
				dir={dir}
				aria-describedby={undefined}
				className="max-w-5xl p-4 pt-14"
				closeLabel={t.closeImage}
				onKeyDown={(event) => {
					if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
					event.preventDefault();
					step(
						(event.key === "ArrowRight" ? 1 : -1) * (dir === "rtl" ? -1 : 1),
					);
				}}
			>
				<DialogTitle className="sr-only">{t.zoomImage}</DialogTitle>
				<Asset
					asset={image}
					loading="eager"
					className="mx-auto block max-h-[70dvh] w-auto max-w-full object-contain"
				/>
				{images.length > 1 && (
					<div className="flex items-center justify-center gap-3">
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={t.previous}
							disabled={index === 0}
							onClick={() => step(-1)}
						>
							<Icon name="chevron" className="size-4 rotate-180" />
						</Button>
						<bdi className="text-sm text-muted">
							{index + 1} / {images.length}
						</bdi>
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={t.next}
							disabled={index === images.length - 1}
							onClick={() => step(1)}
						>
							<Icon name="chevron" className="size-4" />
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
