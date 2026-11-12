"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { direction } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { marketplaceCopy } from "../copy";
export const carouselItemClass = "w-60 shrink-0 snap-start min-[520px]:w-64";
export function MarketplaceCarousel({
	children,
	locale,
	label,
}: {
	children: ReactNode;
	locale: Locale;
	label?: string;
}) {
	const track = useRef<HTMLDivElement>(null),
		[canPrev, setCanPrev] = useState(false),
		[canNext, setCanNext] = useState(false),
		t = marketplaceCopy[locale],
		rtl = direction(locale) === "rtl",
		update = useCallback(() => {
			const el = track.current;
			if (!el) return;
			const max = el.scrollWidth - el.clientWidth,
				pos = Math.abs(el.scrollLeft);
			setCanPrev(pos > 4);
			setCanNext(pos < max - 4);
		}, []);
	useEffect(() => {
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, [update]);
	useEffect(() => {
		update();
	});
	const scroll = (dir: 1 | -1) => {
		const el = track.current;
		if (!el) return;
		const step = Math.max(el.clientWidth - 80, 280),
			behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? ("auto" as const)
				: ("smooth" as const);
		el.scrollBy({ left: (rtl ? -dir : dir) * step, behavior });
	};
	const control =
		"absolute top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-lifted transition-colors hover:bg-info hover:text-action disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-foreground";
	return (
		<section
			className="relative"
			aria-roledescription="carousel"
			aria-label={label ?? t.products}
		>
			<div
				ref={track}
				onScroll={update}
				className="carousel-track flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
			>
				{children}
			</div>
			<button
				type="button"
				aria-label={t.previous}
				disabled={!canPrev}
				onClick={() => scroll(-1)}
				className={`${control} start-1`}
			>
				<Icon name="chevron" className="size-4 rotate-180" />
			</button>
			<button
				type="button"
				aria-label={t.next}
				disabled={!canNext}
				onClick={() => scroll(1)}
				className={`${control} end-1`}
			>
				<Icon name="chevron" className="size-4" />
			</button>
		</section>
	);
}
