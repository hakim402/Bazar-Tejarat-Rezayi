import uuid

from django.db import models

CATEGORIES = ("identity", "business", "representative_identity", "representative_authority")


class ReviewCase(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT, related_name="cases")
    revision = models.PositiveIntegerField(default=1)
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(
        max_length=18,
        default="draft",
        choices=[(s, s) for s in ("draft", "submitted", "under_review", "approved", "rejected", "needs_information")],
    )
    snapshot = models.JSONField(default=dict)
    alternative_requests = models.JSONField(default=dict)
    accepted_alternatives = models.JSONField(default=dict)
    assigned_to = models.ForeignKey(
        "accounts.Account", null=True, blank=True, on_delete=models.PROTECT, related_name="assigned_verifications"
    )
    reason = models.CharField(max_length=1000, blank=True)
    submitted_at = models.DateTimeField(null=True)
    decided_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.profile} / revision {self.revision}"

    class Meta:
        constraints = [models.UniqueConstraint(fields=["profile", "revision"], name="verification_unique_revision")]
        permissions = [
            ("view_queue", "View verification queue metadata"),
            ("assign_review", "Assign or take over verification cases"),
            ("read_evidence", "Read assigned private evidence"),
            ("decide_review", "Decide assigned verification cases"),
            ("review_transfer", "Review ownership transfers"),
        ]


class Evidence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(ReviewCase, on_delete=models.PROTECT, related_name="evidence")
    category = models.CharField(max_length=24, choices=[(s, s) for s in CATEGORIES])
    storage_alias = models.CharField(max_length=32)
    key = models.CharField(max_length=200)
    content_type = models.CharField(max_length=32)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
