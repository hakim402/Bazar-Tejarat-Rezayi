import secrets
import time
import unicodedata
import uuid

from cryptography.fernet import Fernet
from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.hashers import check_password
from django.contrib.auth.models import AbstractUser
from django.db import models, transaction
from django.db.models.functions import Lower
from django.utils import timezone
from django_otp.models import Device
from django_otp.oath import TOTP


def normalize_email(value):
    return unicodedata.normalize("NFKC", value).strip().casefold()


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        user = self.model(email=normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, owner_authority=True)
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=150)
    email_verified = models.BooleanField(default=False)
    owner_authority = models.BooleanField(default=False)
    credential_epoch = models.PositiveIntegerField(default=1)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["display_name"]
    objects = UserManager()

    class Meta:
        constraints = [models.UniqueConstraint(Lower("email"), name="accounts_email_case_insensitive")]

    def save(self, *args, **kwargs):
        self.email = normalize_email(self.email)
        if kwargs.get("update_fields"):
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {"credential_epoch"}
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.display_name or self.email


class Account(models.Model):
    class Context(models.TextChoices):
        BUYER = "buyer", "Buyer"
        SELLER = "seller", "Seller"
        STAFF = "staff", "Operational staff"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="accounts")
    context = models.CharField(max_length=8, choices=Context.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    intent = models.CharField(
        max_length=10,
        choices=[("individual", "Individual"), ("business", "Business buyer"), ("company", "Company seller")],
        default="individual",
    )
    review_status = models.CharField(
        max_length=16,
        choices=[
            ("not_requested", "Not requested"),
            ("pending", "Pending review"),
            ("approved", "Approved"),
            ("rejected", "Rejected"),
        ],
        default="not_requested",
    )
    access_epoch = models.PositiveIntegerField(default=1)
    permission_groups = models.ManyToManyField("auth.Group", blank=True, related_name="operational_accounts")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "context"], name="accounts_one_context_per_identity"),
            models.CheckConstraint(
                condition=models.Q(context__in=["buyer", "seller", "staff"]), name="accounts_known_context"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["active", "suspended", "archived"]), name="accounts_known_status"
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(context="buyer", intent__in=["individual", "business"])
                    | models.Q(context="seller", intent__in=["individual", "company"])
                    | models.Q(context="staff", intent="individual")
                ),
                name="accounts_context_intent",
            ),
        ]
        permissions = [
            ("review_identity", "Review identity status"),
            ("manage_content", "Manage content"),
            ("review_payments", "Review payments"),
            ("manage_logistics", "Manage logistics"),
            ("handle_support", "Handle support cases"),
        ]

    def __str__(self):
        return f"{self.user} / {self.get_context_display()}"

    def save(self, *args, **kwargs):
        if kwargs.get("update_fields"):
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {"access_epoch"}
        return super().save(*args, **kwargs)


class ActionToken(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    digest = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=8, choices=[("verify", "Verify email"), ("reset", "Reset password")])
    credential_state = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Authenticator(Device):
    encrypted_secret = models.TextField()
    last_t = models.BigIntegerField(default=-1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user"], name="accounts_one_authenticator")]

    @property
    def secret(self):
        return Fernet(settings.MFA_ENCRYPTION_KEY.encode()).decrypt(self.encrypted_secret.encode())

    def set_secret(self):
        self.encrypted_secret = Fernet(settings.MFA_ENCRYPTION_KEY.encode()).encrypt(secrets.token_bytes(20)).decode()

    def verify_token(self, token):
        with transaction.atomic():
            device = Authenticator.objects.select_for_update().get(pk=self.pk)
            if not isinstance(token, str) or not token.isascii() or not token.isdigit() or len(token) != 6:
                return False
            totp = TOTP(device.secret, step=30, digits=6)
            totp.time = time.time()
            if not totp.verify(int(token), tolerance=1, min_t=device.last_t + 1):
                return False
            device.last_t = totp.t()
            device.save(update_fields=["last_t"])
            self.last_t = device.last_t
            return True


class RecoveryCode(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    code_hash = models.CharField(max_length=128)
    used_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def consume(cls, user, code):
        for item in cls.objects.select_for_update().filter(user=user, used_at__isnull=True):
            if check_password(code, item.code_hash):
                item.used_at = timezone.now()
                item.save(update_fields=["used_at"])
                return True
        return False


class AuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name="audit_actions"
    )
    account = models.ForeignKey(Account, null=True, on_delete=models.PROTECT)
    subject = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name="audit_subjects"
    )
    context = models.CharField(max_length=10, default="system")
    action = models.CharField(max_length=48)
    request_id = models.UUIDField(null=True)
    changed_fields = models.JSONField(default=list)
    resource_type = models.CharField(max_length=32, blank=True)
    resource_id = models.UUIDField(null=True, blank=True)
    reason = models.CharField(max_length=1000, blank=True)
    state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class RateBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()


class MailAttempt(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    purpose = models.CharField(max_length=8)
    status = models.CharField(
        max_length=8, choices=[("sent", "Captured/delivered to adapter"), ("failed", "Adapter failure")]
    )
    created_at = models.DateTimeField(auto_now_add=True)


class BrowserAuthority(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    revoked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class ContextGrant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    authority = models.ForeignKey(BrowserAuthority, on_delete=models.CASCADE)
    context = models.CharField(max_length=8)
    revoked = models.BooleanField(default=False)


class GoogleIdentity(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    issuer = models.CharField(max_length=100, default="https://accounts.google.com")
    subject = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["issuer", "subject"], name="accounts_unique_google_subject")]


class GoogleAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    state_digest = models.CharField(max_length=64, unique=True)
    browser_digest = models.CharField(max_length=64)
    encrypted_payload = models.TextField()
    context = models.CharField(max_length=8)
    locale = models.CharField(max_length=5)
    action = models.CharField(max_length=12)
    return_path = models.CharField(max_length=500)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    credential_state = models.CharField(max_length=64, blank=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True)


class AccountMail(models.Model):
    token = models.OneToOneField(ActionToken, on_delete=models.CASCADE)
    encrypted_payload = models.TextField()
    status = models.CharField(max_length=16, default="queued")
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)
