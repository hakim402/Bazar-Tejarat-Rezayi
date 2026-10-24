"use client";
import { useEffect, useRef } from "react";
import type { Locale } from "../../lib/i18n/locales";
import type { Site } from "../site/contract";
import { heroHref } from "./data";
export function PromotionalVideo({
	locale,
	slide,
}: {
	locale: Locale;
	slide: Site["hero"]["cards"][number];
}) {
	const video = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const element = video.current;
		if (!element) return;
		const pause = () => {
			if (document.hidden) element.pause();
		};
		const observer = new IntersectionObserver((entries) => {
			if (!entries[0]?.isIntersecting) element.pause();
		});
		observer.observe(element);
		document.addEventListener("visibilitychange", pause);
		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", pause);
		};
	}, []);
	return (
		<article
			lang={slide.content_locale}
			className="relative flex min-h-40 min-w-0 items-center overflow-hidden rounded-3xl border border-border/30 bg-surface"
		>
			<video
				ref={video}
				controls
				muted
				playsInline
				preload="metadata"
				src={slide.video?.url}
				poster={slide.poster?.url}
				aria-label={slide.alt || slide.title}
				className="max-h-60 w-full object-contain"
			/>
			<a
				href={heroHref(locale, slide.source_url)}
				className="absolute inset-x-0 top-0 bottom-14 z-10 rounded-t-3xl focus-visible:outline-2 focus-visible:outline-action"
			>
				<span className="sr-only">{slide.alt || slide.title}</span>
			</a>
			{slide.transcript && (
				<p className="sr-only" lang={slide.content_locale}>
					{slide.transcript}
				</p>
			)}
		</article>
	);
}
