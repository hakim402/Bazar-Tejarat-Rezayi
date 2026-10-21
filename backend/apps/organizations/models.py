import uuid

from django.db import models
from django.db.models import Q

BUNDLES = ("catalogue", "orders_negotiation", "payments_refunds", "fulfilment", "messaging")


class BusinessProfile(models.Model):
    class Kind(models.TextChoices):
        INDIVIDUAL = "individual", "Individual seller"
        COMPANY = "company", "Seller company"
        BUSINESS = "business", "Business buyer"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="business_profiles")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    display_name = models.CharField(max_length=150)
    legal_name = models.CharField(max_length=200, blank=True)
    business_type = models.CharField(max_length=150, blank=True)
    contact_phone = models.CharField(max_length=40, blank=True)
    location = models.CharField(max_length=500, blank=True)
    representative = models.CharField(max_length=200, blank=True)
    version = models.PositiveIntegerField(default=1)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.display_name

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "kind"], condition=~Q(kind="company"), name="organizations_one_owned_profile_kind"
            ),
            models.CheckConstraint(
                condition=Q(kind__in=["individual", "company", "business"]), name="organizations_known_kind"
            ),
        ]


class Membership(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(BusinessProfile, on_delete=models.PROTECT, related_name="memberships")
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="memberships")
    is_owner = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    bundles = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.account} / {self.company}"

    class Meta:
        constraints = [models.UniqueConstraint(fields=["company", "account"], name="organizations_unique_membership")]


class Invitation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(BusinessProfile, on_delete=models.PROTECT, related_name="invitations")
    inviter = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    email = models.EmailField()
    bundles = models.JSONField(default=list)
    locale = models.CharField(max_length=5, default="fa-AF")
    digest = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    status = models.CharField(
        max_length=10, default="pending", choices=[(s, s) for s in ("pending", "accepted", "revoked")]
    )
    accepted_by = models.ForeignKey(
        "accounts.Account", null=True, on_delete=models.PROTECT, related_name="accepted_invitations"
    )
    accepted_at = models.DateTimeField(null=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["company", "email"], condition=Q(status="pending"), name="organizations_one_pending_invite"
            )
        ]


class InvitationMail(models.Model):
    invitation = models.ForeignKey(Invitation, on_delete=models.PROTECT, related_name="deliveries")
    invitation_version = models.PositiveIntegerField()
    encrypted_payload = models.TextField()
    status = models.CharField(max_length=16, default="queued")
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()


class OwnershipTransfer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(BusinessProfile, on_delete=models.PROTECT, related_name="transfers")
    requester = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="requested_transfers")
    recipient = models.ForeignKey(Membership, on_delete=models.PROTECT)
    company_revision = models.PositiveIntegerField()
    company_identity = models.JSONField(default=dict)
    retained_bundles = models.JSONField(default=list)
    status = models.CharField(
        max_length=12,
        default="pending",
        choices=[(s, s) for s in ("pending", "accepted", "approved", "rejected", "cancelled")],
    )
    version = models.PositiveIntegerField(default=1)
    accepted_at = models.DateTimeField(null=True)
    reviewer = models.ForeignKey(
        "accounts.Account", null=True, blank=True, on_delete=models.PROTECT, related_name="reviewed_transfers"
    )
    reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True)

    def __str__(self):
        return f"{self.company} / {self.status}"

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["company"],
                condition=Q(status__in=["pending", "accepted"]),
                name="organizations_one_pending_transfer",
            )
        ]
