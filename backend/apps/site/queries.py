"""Anonymous allowlist. Never reads retained CMS tables or creates missing settings."""
from django.conf import settings
from django.db.models import Prefetch, Q, prefetch_related_objects
from .models import SiteSettings, HeroSlide, ContentPage


def media(asset):
    if asset is None:
        return None
    return {"url": f"/api/v1/site/media/{asset.pk}/", "width": asset.width, "height": asset.height, "content_type": asset.content_type}


def translated(row, source, fields):
    """Use the requested locale only when every non-empty source field is translated."""
    return row if row and all(not getattr(source, field).strip() or getattr(row, field).strip() for field in fields) else source


def public_settings(locale):
    site = SiteSettings.objects.select_related("favicon", "og_image").prefetch_related("locales__logo_light", "locales__logo_dark", "seo__image").get(pk=1)
    kind = "video" if site.hero_mode == "video_carousel" else "image"
    selected = [site.promotion_one_id, site.promotion_two_id]
    active = HeroSlide.objects.filter(enabled=True, is_draft=False, draft_of__isnull=True).filter(Q(placement="main", kind=kind) | Q(placement="promotion", pk__in=[pk for pk in selected if pk]))
    prefetch_related_objects([site], Prefetch("slides", queryset=active.select_related("image", "video", "poster").prefetch_related("locales")))
    texts = {row.locale: row for row in site.locales.all()}
    source = texts["fa-AF"]
    chosen = translated(texts.get(locale), source, ["name", "tagline", "description", "address", "hours"])
    fallback = chosen.locale != locale
    def notice(maintenance=False):
        field = "maintenance_message" if maintenance else "announcement"
        row = texts.get(locale)
        required = [field, "maintenance_title"] if maintenance else [field, *(["announcement_label"] if site.announcement_url else [])]
        row = row if row and all(getattr(row, name).strip() for name in required) else source
        return {"enabled": site.maintenance_enabled if maintenance else site.announcement_enabled, "title": row.maintenance_title if maintenance else "", "text": getattr(row, field), "label": "" if maintenance else row.announcement_label, "url": "" if maintenance else site.announcement_url, "content_locale": row.locale, "fallback": row.locale != locale}
    slides = []
    cards = []
    for slide in site.slides.all():
        rows = {row.locale: row for row in slide.locales.all()}
        source_row = rows.get("fa-AF")
        if source_row is None:
            continue
        required = ["alt", "transcript"] if slide.kind == "video" else ["title", "description", "alt", "cta_label", "cta_url"]
        row = translated(rows.get(locale), source_row, required)
        image = media(slide.image)
        if slide.bundled_image:
            image = {"url": settings.FRONTEND_ORIGIN + "/images/marketplace/hero.webp", "width": 1536, "height": 1024, "content_type": "image/webp"}
        if slide.image_url:
            image = {"url": slide.image_url, "width": 1536, "height": 1024, "content_type": "image/" + ("jpeg" if slide.image_url.lower().endswith((".jpg", ".jpeg")) else slide.image_url.rsplit(".", 1)[-1])}
        video = media(slide.video)
        if slide.video_url:
            video = {"url": slide.video_url, "width": 1920, "height": 1080, "content_type": "video/mp4"}
        item = {"id": slide.pk, "kind": slide.kind, "image": image, "video": video, "poster": media(slide.poster), **{name: getattr(row, name) for name in ["title", "description", "alt", "cta_label", "cta_url", "transcript"]}, "content_locale": row.locale, "fallback": row.locale != locale, "source_url": slide.source_url}
        if slide.kind == "video":
            item.update(title=row.alt or source_row.alt, description="", cta_label="", cta_url="")
        if slide.placement == "main":
            slides.append(item)
        else:
            cards.append({**item, "slot": "promo_1" if slide.pk == site.promotion_one_id else "promo_2"})
    slides = slides[:8]
    return {"default_locale": site.default_locale, "default_theme": site.default_theme, "indexing": site.indexing, "identity": {**{name: getattr(chosen, name) or getattr(source, name) for name in ["name", "tagline", "title_template", "description", "address", "hours"]}, "logo_light": media(texts[locale].logo_light) if locale in texts else None, "logo_dark": media(texts[locale].logo_dark) if locale in texts else None, "content_locale": chosen.locale, "fallback": fallback}, "contacts": {name: getattr(site, name) for name in ["email", "phone", "website", "facebook", "instagram", "linkedin", "youtube"]}, "favicon": media(site.favicon), "og_image": media(site.og_image), "announcement": notice(), "maintenance": notice(True), "hero": {"mode": site.hero_mode, "autoplay": site.hero_autoplay, "rotate": site.hero_rotate, "interval": site.hero_interval, "slides": slides, "cards": sorted(cards, key=lambda card: card["slot"])}, "seo": [{"page": row.page, "title": row.title, "description": row.description, "image": media(row.image)} for row in site.seo.all() if row.locale == locale], "media_hosts": list(settings.SITE_MEDIA_HOSTS), "pages": page_summaries(locale)}


def page_translation(rows, locale):
    """Published translation in the requested language, else published Dari, else None."""
    chosen = rows.get(locale)
    if chosen is not None and not chosen.is_draft:
        return chosen
    source = rows.get("fa-AF")
    return source if source is not None and not source.is_draft else None


def page_summaries(locale):
    summaries = []
    for page in ContentPage.objects.filter(status="published").prefetch_related("locales"):
        row = page_translation({item.locale: item for item in page.locales.all()}, locale)
        if row is None:
            continue
        summaries.append({"slug": page.slug, "path": page.path, "group": page.group, "kind": page.kind, "title": row.title, "intro": row.intro, "position": page.position, "show_in_footer": page.show_in_footer})
    return summaries


def public_page(locale, slug):
    page = ContentPage.objects.select_related("cover").prefetch_related("locales").filter(status="published", slug=slug).first()
    if page is None:
        return None
    row = page_translation({item.locale: item for item in page.locales.all()}, locale)
    if row is None:
        return None
    return {"slug": page.slug, "path": page.path, "group": page.group, "kind": page.kind, "title": row.title, "intro": row.intro, "position": page.position, "show_in_footer": page.show_in_footer, "body": row.body, "meta_description": row.meta_description, "cover": media(page.cover), "cta_label": row.cta_label, "cta_url": row.cta_url, "cta_secondary_label": row.cta_secondary_label, "cta_secondary_url": row.cta_secondary_url, "content_locale": row.locale, "fallback": row.locale != locale, "updated_at": page.updated_at.isoformat()}
