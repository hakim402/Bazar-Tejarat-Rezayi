"use client";
import { useEffect, useRef, useState } from "react";
import { direction, type Locale } from "../../lib/i18n/locales";
import { siteCopy } from "../../lib/i18n/site";
import { pageCopy } from "../pages/copy";
import { Icon } from "../../components/ui/icon";
import { heroHref } from "../storefront/data";
import { storefrontCopy } from "../storefront/copy";
import type { Site } from "./contract";
import { heroUI } from "./ui";
export function Hero({ locale, hero }: { locale: Locale; hero: Site["hero"] }) {
  const [index, setIndex] = useState(0),
    [rotating, setRotating] = useState(hero.rotate),
    [reduced, setReduced] = useState(true),
    [visible, setVisible] = useState(false),
    [failed, setFailed] = useState(false),
    [hovered, setHovered] = useState(false);
  const automatic = useRef(true),
    mediaRegion = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const t = heroUI[locale],
    copy = pageCopy[locale].home,
    store = storefrontCopy[locale],
    slides = hero.slides,
    slide = slides[index] ?? slides[0],
    videoOnly = slide?.kind === "video";
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)"),
      update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let intersecting = false;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? false;
      update();
    });
    if (mediaRegion.current) observer.observe(mediaRegion.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    if (!rotating || reduced || !visible || hovered || slides.length < 2)
      return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
      setFailed(false);
    }, hero.interval * 1000);
    return () => clearInterval(timer);
  }, [rotating, reduced, visible, hovered, slides.length, hero.interval]);
  useEffect(() => {
    const element = video.current;
    if (!element || !slide || slide.kind !== "video" || failed) return;
    if (!visible) {
      element.pause();
      return;
    }
    if (hero.autoplay && !reduced && automatic.current) {
      element.muted = true;
      void element.play().catch(() => {});
    }
    return () => element.pause();
  }, [visible, reduced, hero.autoplay, slide, failed]);
  function select(next: number) {
    automatic.current = false;
    setRotating(false);
    video.current?.pause();
    setIndex((next + slides.length) % slides.length);
    setFailed(false);
  }
  return (
    <section
      aria-label={t.slides}
      aria-roledescription={slides.length > 1 ? t.carousel : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).hasAttribute("data-rotation")) {
          automatic.current = false;
          setRotating(false);
        }
      }}
      onFocusCapture={(event) => {
        if (!(event.target as HTMLElement).hasAttribute("data-rotation")) {
          automatic.current = false;
          setRotating(false);
        }
      }}
      className="relative isolate flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border/40 bg-linear-to-br from-campaign-start to-campaign-end text-foreground"
    >
      {hero.rotate && !reduced && slides.length > 1 && (
        <button
          type="button"
          data-rotation
          onClick={() => setRotating((value) => !value)}
          className="absolute end-4 top-3 z-20 min-h-11 rounded-full border border-border bg-surface px-3 text-xs font-bold text-action"
        >
          {rotating ? t.pause : t.play}
        </button>
      )}
      <div
        className={`relative grid flex-1 items-center desktop:min-h-80 ${videoOnly ? "grid-cols-1" : "grid-cols-[1.1fr_0.9fr] gap-1 px-5 pb-2 pt-7 desktop:gap-2 desktop:px-7 desktop:pt-8"}`}
      >
        <div
          className={videoOnly ? "sr-only" : "relative z-10 min-w-0 space-y-4"}
          lang={slide?.content_locale ?? locale}
          dir={direction(slide?.content_locale ?? locale)}
        >
          <p className="inline-flex rounded-full bg-surface/80 px-3 py-1 text-xs font-bold text-action">
            {store.collections}
          </p>
          {slide?.fallback && (
            <p
              lang={locale}
              dir={direction(locale)}
              className="text-xs text-muted"
            >
              {siteCopy[locale].fallback}
            </p>
          )}
          <h1 className="max-w-sm text-[1.65rem] leading-snug desktop:text-[2.35rem]">
            {slide?.title || copy.title}
          </h1>
          <p className="max-w-xs text-sm leading-7 text-muted">
            {slide?.description || copy.intro}
          </p>
          {!videoOnly && slide?.cta_label && slide.cta_url ? (
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-on-primary no-underline"
              href={heroHref(locale, slide.cta_url)}
            >
              {slide.cta_label}
              <Icon name="arrow" className="size-4 rtl:rotate-180" />
            </a>
          ) : !slide ? (
            <a
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2 text-sm font-bold text-on-primary no-underline"
              href={`/${locale}/how-it-works`}
            >
              {pageCopy[locale]["how-it-works"].title}
            </a>
          ) : null}
        </div>
        <div
          ref={mediaRegion}
          className="relative flex min-w-0 items-center justify-center self-stretch"
        >
          <div
            aria-hidden="true"
            className="absolute aspect-square w-full rounded-full bg-surface/30"
          />
          {slide?.kind === "video" && !failed ? (
            <>
              <video
                key={slide.id}
                ref={video}
                lang={slide.content_locale}
                src={slide.video?.url}
                poster={slide.poster?.url}
                controls
                playsInline
                muted={hero.autoplay}
                preload="metadata"
                className="relative z-10 h-full min-h-80 max-h-[32rem] w-full object-contain"
                onError={() => setFailed(true)}
                aria-label={slide.alt || slide.title}
              />
              {slide.source_url && (
                <a
                  href={heroHref(locale, slide.source_url)}
                  aria-label={slide.title || slide.alt}
                  className="absolute inset-x-0 top-0 bottom-14 z-10 rounded-t-3xl focus-visible:outline-2 focus-visible:outline-action"
                >
                  <span className="sr-only">{slide.title || slide.alt}</span>
                </a>
              )}
            </>
          ) : (
            // biome-ignore lint/performance/noImgElement: owner-upload media uses the validated direct media boundary.
            <img
              key={slide?.id ?? "bundled"}
              src={
                !failed && slide?.image?.url
                  ? slide.image.url
                  : "/images/marketplace/hero.webp"
              }
              alt={slide?.alt ?? ""}
              width={slide?.image?.width ?? 1536}
              height={slide?.image?.height ?? 1024}
              fetchPriority="high"
              className="relative z-10 max-h-80 w-full object-contain drop-shadow-lg"
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>
      {videoOnly && slide?.transcript && (
        <p
          className="sr-only"
          lang={slide.content_locale}
          dir={direction(slide.content_locale)}
        >
          {slide.transcript}
        </p>
      )}
      {!videoOnly && slide?.transcript && (
        <details
          className="px-5 py-2 text-sm"
          lang={slide.content_locale}
          dir={direction(slide.content_locale)}
        >
          <summary className="min-h-11">{t.transcript}</summary>
          <p className="whitespace-pre-line">{slide.transcript}</p>
        </details>
      )}
      {slides.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4 pt-3 desktop:px-7">
          <fieldset className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0">
            <legend className="sr-only">{t.slides}</legend>
            {slides.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`${t.slides} ${i + 1} / ${slides.length}`}
                aria-pressed={index === i}
                onClick={() => select(i)}
                className="flex size-8 items-center justify-center rounded-full border-0 bg-transparent"
              >
                <span
                  className={`block h-2 rounded-full ${index === i ? "w-5 bg-action" : "w-2 bg-muted/35"}`}
                />
              </button>
            ))}
          </fieldset>
          <div className="flex items-center gap-1">
            <span
              aria-live={rotating ? "off" : "polite"}
              className="me-2 text-xs text-muted"
            >
              <bdi>
                {index + 1} / {slides.length}
              </bdi>
            </span>
            <button
              type="button"
              aria-label={t.previous}
              onClick={() => select(index - 1)}
              className="flex size-11 items-center justify-center rounded-full border border-border bg-surface/70 text-action"
            >
              <Icon name="chevron" className="size-4 ltr:rotate-180" />
            </button>
            <button
              type="button"
              aria-label={t.next}
              onClick={() => select(index + 1)}
              className="flex size-11 items-center justify-center rounded-full border border-border bg-surface/70 text-action"
            >
              <Icon name="chevron" className="size-4 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
