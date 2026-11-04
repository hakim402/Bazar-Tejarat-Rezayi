from django.db import models


class ReceiptManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(seal__isnull=False)


class PlanManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(seal__isnull=False)


class EventManager(models.Manager):
    def get_queryset(self):
        from django.db.models import Exists, OuterRef, Q
        from .models import (
            Receipt,
            Claim,
            Correction,
            StockPlan,
            Extension,
            CaseEvent,
            ClaimDecision,
            AllocationAttempt,
            Reminder,
        )

        qs = super().get_queryset()
        for actions, source in [
            (["claim_withdrawn", "claim_rejected"], ClaimDecision.objects.filter(event_id=OuterRef("pk"))),
            (["stock_reserved", "allocation_shortage"], AllocationAttempt.objects.filter(event_id=OuterRef("pk"))),
            (["receipt_confirmed"], Receipt.objects.filter(event_id=OuterRef("pk"))),
            (["claim_submitted"], Claim.objects.filter(event_id=OuterRef("pk"))),
            (["correction_proposed"], Correction.objects.filter(event_id=OuterRef("pk"), case__isnull=False)),
            (["stock_plan_submitted", "replacement_proposed"], StockPlan.objects.filter(event_id=OuterRef("pk"))),
            (["overdue_reminder"], Reminder.objects.filter(event_id=OuterRef("pk"))),
            (["deadline_extended"], Extension.objects.filter(event_id=OuterRef("pk"))),
            (
                [
                    "case_assign",
                    "case_approve",
                    "case_reject",
                    "case_replenish",
                    "case_refer",
                    "case_resolve",
                    "overdue_cleared",
                    "overdue_reopened",
                ],
                CaseEvent.objects.filter(event_id=OuterRef("pk")),
            ),
        ]:
            qs = qs.filter(~Q(action__in=actions) | Exists(source))
        return qs
