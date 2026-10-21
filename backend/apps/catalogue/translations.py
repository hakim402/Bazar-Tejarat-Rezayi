import uuid
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from apps.organizations.access import Conflict, assert_version
from . import access
from .models import Translation, TranslationJob, TranslationBudget, Product, LOCALES, CatalogueEvent
from .translation_provider import provider_status, content, validate_output, translate
from .validation import text, fail


def enqueue(job_id):
    from .tasks import generate_translation

    try:
        generate_translation.apply_async(args=[str(job_id)], retry=False)
    except Exception:
        # Durable queued row is recovered by periodic dispatcher. Never expose broker details.
        pass


def target_locales():
    """Only evaluated adapter targets; never infer Groq support from UI languages."""
    status = provider_status()
    if status == "test_adapter":
        return LOCALES
    return tuple(settings.GROQ_TRANSLATION_LOCALES) if status == "groq" else ()


def schedule_job(translation, *, retry=False):
    """Caller holds the product lock. Exact source/target intent is durable before enqueue."""
    if translation.human_edited or translation.approved_body:
        raise Conflict()
    job = TranslationJob.objects.filter(translation=translation).first()
    if job and not retry:
        # A repeated request observes the same intent; never reset leases, attempts or results.
        return job
    if retry and (not job or job.status not in {"failed", "blocked"} or job.attempts >= 3):
        raise Conflict()
    if not job:
        job = TranslationJob(translation=translation, expected_version=translation.version)
    eligible = translation.locale in target_locales()
    job.status = "queued" if eligible else "blocked"
    job.error_code = "" if eligible else "provider_disabled"
    job.next_attempt_at = timezone.now()
    job.save()
    if eligible:
        transaction.on_commit(lambda job_id=job.pk: enqueue(job_id))
    return job


def schedule_publication(item, revision):
    """Publication transaction/lock owns this bounded fan-out; no provider or broker I/O here."""
    if item.published_id != revision.pk:
        raise Conflict()
    for locale in target_locales():
        if locale == revision.body["locale"]:
            continue
        translation, _ = Translation.objects.get_or_create(revision=revision, locale=locale)
        if not translation.human_edited and not translation.approved_body:
            schedule_job(translation)


@transaction.atomic
def edit(actor, pk, revision_id, locale, data):
    item = access.resource(actor, pk, lock=True, capability="review_translation")
    if actor.context == "seller":
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied()
    revision = get_object_or_404(item.revisions, pk=revision_id)
    if locale not in LOCALES or locale == revision.body["locale"]:
        fail("locale", "choice")
    translation, _ = Translation.objects.get_or_create(revision=revision, locale=locale)
    assert_version(translation, data["version"])
    action = data["action"]
    if action == "save":
        value = validate_output(
            {
                "title": data.get("title", ""),
                "description": data.get("description", ""),
                "image_alts": data.get("image_alts", {}),
            },
            content(revision.body),
        )
        for k, v in value.items():
            setattr(translation, k, v)
        translation.state, translation.human_edited = "draft", True
        translation.version += 1
        translation.save()
    elif action in {"approve", "reject"}:
        if any(
            key in data and data[key] != getattr(translation, key) for key in ("title", "description", "image_alts")
        ):
            raise Conflict()
        if item.published_id != revision.pk or translation.state != "draft":
            raise Conflict()
        reason = text(data.get("reason", ""), "reason", 1000, optional=action == "approve")
        translation.reason = reason
        if action == "approve":
            translation.approved_body = validate_output(
                {
                    "title": translation.title,
                    "description": translation.description,
                    "image_alts": translation.image_alts,
                },
                content(revision.body),
            )
            translation.state = "approved"
            translation._allow_catalogue_review = True
        else:
            translation.state = "rejected"
        translation.version += 1
        translation.save()
    elif action in {"generate", "retry"}:
        if item.published_id != revision.pk or translation.human_edited or translation.approved_body:
            raise Conflict()
        schedule_job(translation, retry=action == "retry")
    access.audit(actor, item, "translation_" + action, revision, data.get("reason", ""), translation=translation)
    return {"id": item.pk, "version": item.version, "revision": revision.pk}


def generate(job_id):
    # A lease guards duplicate/delayed deliveries. No DB lock is held during provider I/O.
    with transaction.atomic():
        job = TranslationJob.objects.select_for_update().select_related("translation__revision").get(pk=job_id)
        translation = job.translation
        source = translation.revision
        if job.status not in {"queued", "retry"} or job.next_attempt_at > timezone.now() or job.attempts >= 3:
            return
        if (
            source.product.published_id != source.pk
            or translation.version != job.expected_version
            or translation.human_edited
            or translation.approved_body
        ):
            job.status = "stale"
            job.save(update_fields=["status"])
            return
        status = provider_status()
        if (
            status not in {"groq", "test_adapter"}
            or status == "groq"
            and translation.locale not in settings.GROQ_TRANSLATION_LOCALES
        ):
            job.status, job.error_code = "blocked", "provider_disabled"
            job.save(update_fields=["status", "error_code"])
            return
        chars = len(str(content(source.body)))
        if status == "groq":
            budget, _ = TranslationBudget.objects.get_or_create(day=timezone.localdate())
            budget = TranslationBudget.objects.select_for_update().get(pk=budget.pk)
            if (
                budget.calls >= settings.GROQ_DAILY_CALL_LIMIT
                or budget.characters + chars > settings.GROQ_DAILY_CHARACTER_LIMIT
            ):
                job.status, job.error_code = "blocked", "usage_limit"
                job.save(update_fields=["status", "error_code"])
                return
            budget.calls += 1
            budget.characters += chars
            budget.save()
        job.status, job.lease = "running", uuid.uuid4()
        job.attempts += 1
        job.input_chars = chars
        job.next_attempt_at = timezone.now() + timedelta(minutes=2)
        job.save()
        lease, expected = job.lease, job.expected_version
        body, target = source.body, translation.locale
    output, error = None, ""
    try:
        output = translate(body, target)
    except Exception:
        error = "provider_failed"
    with transaction.atomic():
        # Same lock order as human operations: product -> translation/job.
        item = Product.objects.select_for_update().get(pk=source.product_id)
        translation = Translation.objects.select_for_update().get(pk=translation.pk)
        job = TranslationJob.objects.select_for_update().get(pk=job_id)
        if job.status != "running" or job.lease != lease:
            return
        if (
            item.published_id != source.pk
            or translation.version != expected
            or translation.human_edited
            or translation.approved_body
        ):
            job.status = "stale"
        elif error:
            job.status = "retry" if job.attempts < 3 else "failed"
            job.error_code = error
            job.next_attempt_at = timezone.now() + timedelta(seconds=30 * job.attempts)
        else:
            for k, v in output.items():
                setattr(translation, k, v)
            translation.version += 1
            translation.save()
            job.status, job.error_code = "completed", ""
        job.save()
        CatalogueEvent.objects.create(
            product=item,
            revision=source,
            translation=translation,
            translation_version=translation.version,
            actor=None,
            account=None,
            context="worker",
            action="translation_" + job.status,
            version=item.version,
            reason=job.error_code,
        )


def dispatch():
    now = timezone.now()
    # Expired worker leases are recoverable, with the same bounded attempt counter.
    TranslationJob.objects.filter(status="running", next_attempt_at__lte=now, attempts__lt=3).update(
        status="retry", lease=None
    )
    TranslationJob.objects.filter(status="running", next_attempt_at__lte=now, attempts__gte=3).update(
        status="failed", error_code="worker_timeout", lease=None
    )
    for pk in TranslationJob.objects.filter(
        status__in=["queued", "retry"], next_attempt_at__lte=now, attempts__lt=3
    ).values_list("pk", flat=True)[:20]:
        enqueue(pk)
