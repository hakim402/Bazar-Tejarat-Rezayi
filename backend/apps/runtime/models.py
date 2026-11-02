"""Durable coordination; no provider credentials or customer content in job payloads."""
from django.db import models
from django.utils import timezone


class Mutex(models.Model):
    name = models.CharField(max_length=64, primary_key=True)


class Job(models.Model):
    key = models.CharField(max_length=160, primary_key=True)
    kind = models.CharField(max_length=32)
    period = models.PositiveIntegerField(default=0)
    resource = models.CharField(max_length=64, blank=True)
    state = models.CharField(max_length=12, default="queued")
    available_at = models.DateTimeField(default=timezone.now)
    lease = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)
    failures = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=32, blank=True)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [models.Index(fields=["state", "available_at"], name="runtime_due_jobs")]


class Scheduler(models.Model):
    name = models.CharField(max_length=32, primary_key=True)
    lease = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    failed_at = models.DateTimeField(null=True)
    error_code = models.CharField(max_length=32, blank=True)


class SearchText(models.Model):
    digest = models.CharField(max_length=64, primary_key=True)
    normalized = models.TextField()


class Schema(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    contract = models.CharField(max_length=64)
    guards = models.JSONField(default=dict)
    verified_at = models.DateTimeField(default=timezone.now)


class Transfer(models.Model):
    digest = models.CharField(max_length=64, primary_key=True)
    state = models.CharField(max_length=16, default="loading")
    manifest = models.JSONField()
    progress = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True)
