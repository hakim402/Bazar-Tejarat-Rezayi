from django.contrib.auth.signals import user_logged_out
from django.db.models import F
from django.db.models.signals import m2m_changed, post_save, pre_save
from django.dispatch import receiver

from .models import BrowserAuthority, Account, AuditEvent, User


@receiver(pre_save, sender=Account)
def account_state(sender, instance, **kwargs):
    if not instance._state.adding:
        previous = sender.objects.filter(pk=instance.pk).values("status", "review_status", "access_epoch").first()
        if previous and previous["status"] != instance.status:
            instance.access_epoch = previous["access_epoch"] + 1
        instance._audit_changes = [
            f"{field}:{previous[field]}:{getattr(instance, field)}"
            for field in ("status", "review_status")
            if previous and previous[field] != getattr(instance, field)
        ]


@receiver(post_save, sender=Account)
def account_audit(sender, instance, created, **kwargs):
    AuditEvent.objects.create(
        subject=instance.user,
        account=instance,
        context=instance.context,
        action="account_created" if created else "account_updated",
        changed_fields=getattr(
            instance, "_audit_changes", [f"status:{instance.status}", f"review_status:{instance.review_status}"]
        ),
    )


@receiver(m2m_changed, sender=Account.permission_groups.through)
def account_permissions(sender, instance, action, **kwargs):
    if action.startswith("post_"):
        Account.objects.filter(pk=instance.pk).update(access_epoch=F("access_epoch") + 1)
        AuditEvent.objects.create(
            subject=instance.user,
            account=instance,
            context="staff",
            action="staff_permissions_changed",
            changed_fields=["group_id:" + str(pk) for pk in instance.permission_groups.values_list("pk", flat=True)],
        )


@receiver(pre_save, sender=User)
def identity_state(sender, instance, **kwargs):
    if not instance._state.adding:
        old = (
            sender.objects.filter(pk=instance.pk)
            .values("is_active", "is_staff", "owner_authority", "credential_epoch")
            .first()
        )
        if old and any(old[key] != getattr(instance, key) for key in ("is_active", "is_staff", "owner_authority")):
            instance.credential_epoch = old["credential_epoch"] + 1
            AuditEvent.objects.create(
                subject_id=instance.pk,
                action="identity_authority_changed",
                changed_fields=[
                    f"{key}:{old[key]}:{getattr(instance, key)}"
                    for key in ("is_active", "is_staff", "owner_authority")
                    if old[key] != getattr(instance, key)
                ],
            )


@receiver(user_logged_out)
def revoke_browser(sender, request, **kwargs):
    if request is not None:
        BrowserAuthority.objects.filter(pk=request.session.get("authority")).update(revoked=True)
