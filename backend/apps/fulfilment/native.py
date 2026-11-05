"""One important native workflow, retaining ordinary scoped read-only model pages."""

import json
import uuid
from decimal import Decimal
from django import forms
from django.forms import formset_factory
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect, JsonResponse, HttpResponse
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget, UnfoldAdminTextInputWidget
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor
from apps.accounts.admin_copy import COPY as COPY
from apps.orders.admin import private_document
from apps.payments.models import Finance
from apps.inventory.models import Bucket
from . import access, models as m, queries, services, selection, review, contracts as c, documents, validation as v


class ReviewerChoice(forms.ModelChoiceField):
    def label_from_instance(self, obj):
        return obj.display_name or str(obj.pk)


class WorkflowForm(forms.Form):
    command_id = forms.UUIDField(widget=forms.HiddenInput)
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    goods_version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    case_version = forms.IntegerField(min_value=0, required=False, widget=forms.HiddenInput)
    action = forms.ChoiceField(label=COPY["fulfilment_action"], choices=[], widget=UnfoldAdminSelectWidget)
    assigned_to = ReviewerChoice(
        label=COPY["payment_assignee"],
        queryset=__import__("apps.accounts.models", fromlist=["User"]).User.objects.none(),
        required=False,
        widget=UnfoldAdminSelectWidget,
    )
    reason = forms.CharField(
        label=COPY["payment_reason"], min_length=3, max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3})
    )
    provider = forms.CharField(
        label=COPY["fulfilment_provider"], max_length=160, required=False, widget=UnfoldAdminTextInputWidget
    )
    arranger = forms.ChoiceField(
        label=COPY["fulfilment_arranger"],
        choices=[("rezayi", "Rezayi"), ("seller", "Seller")],
        required=False,
        widget=UnfoldAdminSelectWidget,
    )
    self_delivery = forms.BooleanField(label=COPY["fulfilment_self_delivery"], required=False)
    instructions = forms.CharField(
        label=COPY["fulfilment_instructions"],
        max_length=1000,
        required=False,
        widget=UnfoldAdminTextareaWidget(attrs={"rows": 2}),
    )
    amount = forms.DecimalField(
        label=COPY["fulfilment_amount"],
        max_digits=24,
        decimal_places=2,
        min_value=Decimal(0),
        required=False,
        widget=UnfoldAdminTextInputWidget,
    )
    occurred_at = forms.DateTimeField(
        label=COPY["fulfilment_actual_time"], required=False, widget=UnfoldAdminTextInputWidget
    )
    reference = forms.CharField(
        label=COPY["fulfilment_tracking"], max_length=160, required=False, widget=UnfoldAdminTextInputWidget
    )
    kind = forms.ChoiceField(
        label=COPY["fulfilment_hold"],
        choices=[("cancellation", "Operational cancellation hold"), ("dispute", "Operational unresolved dispute")],
        required=False,
        widget=UnfoldAdminSelectWidget,
    )
    disposition = forms.ChoiceField(
        label=COPY["fulfilment_clear"],
        choices=[("erroneous", "Erroneous hold"), ("withdrawn", "Withdrawn hold")],
        required=False,
        widget=UnfoldAdminSelectWidget,
    )


class StockRow(forms.Form):
    bucket = forms.ChoiceField(
        label=COPY["fulfilment_bucket"], choices=[], required=False, widget=UnfoldAdminSelectWidget
    )
    quantity = forms.DecimalField(
        label=COPY["fulfilment_quantity"],
        max_digits=12,
        decimal_places=3,
        min_value=Decimal("0.001"),
        required=False,
        widget=UnfoldAdminTextInputWidget,
    )

    def clean(self):
        data = super().clean()
        if bool(data.get("bucket")) != bool(data.get("quantity")):
            raise forms.ValidationError("Select a bucket and its exact quantity together.")
        return data


StockRows = formset_factory(StockRow, extra=1, max_num=100, absolute_max=100, validate_max=True)


def stock_forms(order, request, *, initial=None):
    prefix = "stock"
    bound = request.POST if request.method == "POST" and "stock-TOTAL_FORMS" in request.POST else None
    ids = []
    if bound:
        for key, value in bound.items():
            if (
                key.startswith("stock-")
                and key.endswith("-bucket")
                and value.isdecimal()
                and len(value) <= 19
                and 0 < int(value) < 2**63
            ):
                ids.append(int(value))
    rows = StockRows(bound, prefix=prefix, initial=initial or [])
    visible = selection.options(order)["results"]
    choices = {
        x[
            "bucket"
        ]: f"{x['sku']} · {x['batch_code'] or 'Non-batch'} · {x['expires_on'] or 'No expiry'} · Available {x['available']}"
        for x in visible
    }
    for b in Bucket.objects.filter(pk__in=ids, position_id__in=selection.demand(order)).select_related(
        "batch", "position__variant"
    ):
        choices[str(b.pk)] = (
            f"{b.position.variant.sku} · {b.batch.code if b.batch_id else 'Non-batch'} · {b.batch.expires_on if b.batch_id else ''}"
        )
    for form in [*rows.forms, rows.empty_form]:
        form.fields["bucket"].choices = [("", "Select stock bucket"), *choices.items()]
    return rows


def actions(actor, order, case, caps):
    result = []
    codes = access.rights(actor)
    dispatched = m.Shipment.objects.filter(order=order).exists()
    if not case and actor.context == "owner":
        result.append(("case_open", COPY["fulfilment_open_case"]))
    if case and case.state == "open":
        if "assign_fulfilment" in codes:
            result.append(("case_assign", COPY["payment_assign"]))
        independent = True
        try:
            access.independent(order, actor.user)
        except APIException:
            independent = False
        if case.assigned_to_id == actor.user.pk and review.CODES[case.kind] in codes and independent:
            if case.kind in {"charge", "payment", "correction"}:
                if case.kind != "charge" or not dispatched:
                    result.append(("case_approve", COPY["fulfilment_approve"]))
                result.append(("case_reject", COPY["fulfilment_reject"]))
            elif case.kind == "blocker":
                if case.blocker.event.actor_id != actor.user.pk:
                    result.append(("case_clear", COPY["fulfilment_clear"]))
            else:
                result.append(("case_resolve", COPY["fulfilment_resolve"]))
            result.append(("case_refer", COPY["fulfilment_refer"]))
    if caps.get("prepare"):
        keys = ["tracking"] if dispatched else ["arrange", "prepare", "charge", "dispatch"]
        result.extend([(key, COPY["fulfilment_" + key]) for key in keys])
    if caps.get("deliver") and dispatched and not m.Delivery.objects.filter(order=order).exists():
        result.append(("deliver", COPY["fulfilment_deliver"]))
    if "manage_delivery_holds" in codes and access.assigned(actor, order):
        result.append(("blocker", COPY["fulfilment_hold"]))
    return result


def payload(action, data, detail, stock, case, order):
    body = {k: data[k] for k in ["command_id", "version", "goods_version"]}
    body["reason"] = data["reason"]
    if action.startswith("case_"):
        if case:
            body.update(case=case.pk, case_version=data.get("case_version"))
        if action == "case_assign":
            if not data.get("assigned_to"):
                v.fail("assigned_to", "required")
            body["assigned_to"] = data["assigned_to"].pk
        if action == "case_clear":
            body["disposition"] = data.get("disposition")
    elif action == "arrange":
        body.update(
            provider=data.get("provider"),
            arranger=data.get("arranger"),
            self_delivery=data.get("self_delivery", False),
            instructions=data.get("instructions", ""),
        )
    elif action == "prepare":
        recipient = m.Recipient.objects.filter(order=order).order_by("-revision").first()
        if not detail or not recipient or not detail["arrangement"]:
            v.fail("prepare", "recipient_and_provider_required")
        body.update(recipient=str(recipient.pk), arrangement=detail["arrangement"]["id"])
        if order.payment_method == "cod":
            if not stock.is_valid():
                v.fail("lines", "review_stock_fields")
            ids = [row.cleaned_data["bucket"] for row in stock if row.cleaned_data.get("bucket")]
            buckets = {str(b.pk): b for b in Bucket.objects.filter(pk__in=ids, position_id__in=selection.demand(order))}
            body["lines"] = [
                {
                    "variant": str(buckets[row.cleaned_data["bucket"]].position_id),
                    "batch": str(buckets[row.cleaned_data["bucket"]].batch_id)
                    if buckets[row.cleaned_data["bucket"]].batch_id
                    else None,
                    "quantity": format(row.cleaned_data["quantity"], ".3f"),
                }
                for row in stock
                if row.cleaned_data.get("bucket")
            ]
    elif action == "charge":
        if not detail or not detail["arrangement"] or data.get("amount") is None:
            v.fail("charge", "provider_and_amount_required")
        body.update(
            provider=detail["arrangement"]["provider_id"], amount=format(data["amount"], ".2f"), currency=order.currency
        )
    elif action == "dispatch":
        if not detail or not detail["preparation"]:
            v.fail("preparation", "required")
        body["preparation"] = detail["preparation"]["id"]
    elif action in {"tracking", "deliver"}:
        body["occurred_at"] = data.get("occurred_at")
        if action == "tracking":
            body["reference"] = data.get("reference")
    elif action == "blocker":
        body["kind"] = data.get("kind")
    return body


@private_document
def workflow(request, pk, *, case_pk=None):
    actor = admin_actor(request)
    if request.method not in {"GET", "HEAD", "POST"}:
        raise PermissionDenied()
    if set(request.GET) - {"case", "page"} or any(len(request.GET.getlist(k)) != 1 for k in request.GET):
        raise PermissionDenied()
    page = int(request.GET.get("page", "1")) if request.GET.get("page", "1").isdecimal() else 0
    if not 1 <= page <= 10000:
        raise PermissionDenied()
    selected = case_pk or request.GET.get("case")
    case = get_object_or_404(access.case_scope(actor), pk=v.identifier(selected)) if selected else None
    if case and case.order_id != pk:
        raise PermissionDenied()
    order = get_object_or_404(
        access.scope(actor, assignment=True).select_related("invoice", "seller__account__user", "buyer__user"), pk=pk
    )
    inspect = access.scope(actor).filter(pk=pk).exists()
    detail = queries.detail(actor, pk, page=page) if inspect else None
    caps = detail["capabilities"] if detail else {}
    choices = actions(actor, order, case, caps)
    access.audit(actor, case or order, "fulfilment_native_workflow", "Scoped native workflow inspection")
    version = m.State.objects.filter(order=order).values_list("version", flat=True).first() or 0
    goods = Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0
    initial = {
        "command_id": uuid.uuid4(),
        "version": version,
        "goods_version": goods,
        "case_version": case.version if case else 0,
        "assigned_to": case.assigned_to_id if case else None,
        "occurred_at": timezone.now().isoformat(),
        "arranger": "rezayi",
    }
    form = WorkflowForm(request.POST if request.method == "POST" else None, initial=initial)
    form.fields["action"].choices = choices
    if case:
        form.fields["assigned_to"].queryset = __import__("apps.accounts.models", fromlist=["User"]).User.objects.filter(
            pk__in=[u.pk for u in review.reviewers(case)]
        )
    if "assign_fulfilment" not in access.rights(actor):
        form.fields.pop("assigned_to")
    stock = stock_forms(order, request) if caps.get("prepare") and order.payment_method == "cod" else None
    pending = None
    status = 200
    if request.method == "POST":
        try:
            if "dispatch_packet" in request.POST:
                raw = json.loads(request.POST["dispatch_packet"])
                validated = c.DispatchCommand(data=raw)
                validated.is_valid(raise_exception=True)
                if request.POST.get("cancel_review"):
                    form = WorkflowForm(initial={**initial, **raw, "action": "dispatch"})
                    form.fields["action"].choices = choices
                    if case:
                        form.fields["assigned_to"].queryset = __import__(
                            "apps.accounts.models", fromlist=["User"]
                        ).User.objects.filter(pk__in=[u.pk for u in review.reviewers(case)])
                else:
                    services.mutate(actor, pk, "dispatch", validated.validated_data)
                    return HttpResponseRedirect(
                        request.path + ("?case=" + str(case.pk) if case and not case_pk else "")
                    )
            elif form.is_valid():
                action = form.cleaned_data["action"]
                body = payload(action, form.cleaned_data, detail, stock, case, order)
                if action == "dispatch":
                    from django.db import transaction
                    from .transitions import packet

                    with transaction.atomic():
                        locked = access.lock_order(actor, pk)
                        services.allowed(actor, locked, "dispatch")
                        current = get_object_or_404(m.State, order=locked)
                        finance = get_object_or_404(Finance, order=locked)
                        v.expect(current.version, body["version"])
                        v.expect(finance.version, body["goods_version"])
                        pending = packet(actor, locked, current, body)[0]
                        pending["command_id"] = str(body["command_id"])
                else:
                    services.mutate(actor, pk, action, body)
                    return HttpResponseRedirect(
                        request.path + ("?case=" + str(case.pk) if case and not case_pk else "")
                    )
        except (APIException, ValueError, KeyError) as error:
            form.add_error(None, COPY["payment_changed"])
            status = getattr(error, "status_code", 400)
    before = None
    if case and case.correction_id and caps.get("financial_details"):
        proposal = case.correction
        prior = (
            m.Correction.objects.filter(
                receipt=proposal.receipt, target_version__lt=proposal.target_version, case__state="approved"
            )
            .order_by("-target_version")
            .first()
        )
        source = prior or proposal.receipt.claim
        before = {"amount": source.amount, "paid_at": source.paid_at, "description": source.description}
    images = []
    if case and caps.get("evidence"):
        bindings = m.EvidenceBinding.objects.none()
        if case.claim_id:
            bindings = m.EvidenceBinding.objects.filter(claim_id=case.claim_id)
        elif case.correction_id:
            bindings = m.EvidenceBinding.objects.filter(
                __import__("django.db.models", fromlist=["Q"]).Q(correction_id=case.correction_id)
                | __import__("django.db.models", fromlist=["Q"]).Q(claim_id=case.correction.receipt.claim_id)
            )
        images = [
            {
                "id": b.evidence_id,
                "url": reverse("admin:fulfilment_evidence_bytes", args=[b.evidence_id]) + "?case=" + str(case.pk),
            }
            for b in bindings[:6]
        ]
    response = render(
        request,
        "fulfilment/workflow.html",
        {
            **owner_site.each_context(request),
            "opts": m.State._meta,
            "title": COPY["fulfilment_title"],
            "detail": detail,
            "order": order,
            "case": case,
            "form": form,
            "stock": stock,
            "pending": pending,
            "pending_json": json.dumps(v.canonical(pending)) if pending else "",
            "before": before,
            "images": images,
            "page": page,
            "next_page": page + 1,
            "handover_url": reverse("admin:fulfilment_state_handover", args=[pk]),
            "stock_url": reverse("admin:fulfilment_state_options", args=[pk]),
        },
        status=status,
    )
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "same-origin"
    response["X-Robots-Tag"] = "noindex, nofollow"
    if request.method == "HEAD":
        response.content = b""
    return response


@private_document
def options(request, pk):
    if request.method not in {"GET", "HEAD"}:
        raise PermissionDenied()
    actor = admin_actor(request)
    order = get_object_or_404(access.scope(actor), pk=pk)
    if not access.capabilities(actor, order)["prepare"]:
        raise PermissionDenied()
    from apps.messaging.views import query

    data = query(request, c.Query)
    result = selection.options(order, page=data["page"], q=data["q"])
    response = JsonResponse(v.canonical(result))
    response["Cache-Control"] = "private, no-store"
    return response


@private_document
def handover(request, pk):
    if request.method not in {"GET", "HEAD"} or set(request.GET) - {"locale", "format"}:
        raise PermissionDenied()
    actor = admin_actor(request)
    locale = request.GET.get("locale", "en")
    kind = request.GET.get("format", "html")
    if kind not in {"html", "pdf"}:
        raise PermissionDenied()
    data = documents.snapshot(actor, pk, locale)
    raw = documents.pdf_bytes(data, locale) if kind == "pdf" else documents.html_bytes(data, locale)
    response = HttpResponse(
        raw if request.method == "GET" else b"",
        content_type="application/pdf" if kind == "pdf" else "text/html; charset=utf-8",
    )
    response["Cache-Control"] = "private, no-store"
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "no-referrer"
    response["Content-Security-Policy"] = documents.HANDOVER_CSP
    response["Content-Disposition"] = 'inline; filename="recipient-handover.' + kind + '"'
    response["Content-Length"] = str(len(raw))
    return response
