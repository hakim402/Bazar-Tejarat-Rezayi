"""Native authenticated factor maintenance; shared identity/grant invariants stay authoritative."""
from copy import copy

from django import forms
from django.contrib import messages
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods
from unfold.widgets import (
    UnfoldAdminImageFieldWidget, UnfoldAdminPasswordWidget, UnfoldAdminSelectWidget,
    UnfoldAdminSingleDateWidget, UnfoldAdminTextareaWidget, UnfoldAdminTextInputWidget, UnfoldBooleanWidget,
)
from django.contrib.auth import logout
from unfold.forms import AdminOwnPasswordChangeForm
from django.db import transaction
from django.shortcuts import render, redirect
from rest_framework.exceptions import APIException, ValidationError
from .access import admin_actor
from .copy import COPY
from .presentation import EMAIL_LABELS, ROLE_LABELS, badge, email_status, identity_role, label
from ..models import User, Authenticator, RecoveryCode
from ..services import PROFILE_FIELDS, AuthFailure, audit, rate_limit
from ..services.profile import save_profile


class FactorResetForm(forms.Form):
    password = forms.CharField(max_length=128, widget=UnfoldAdminPasswordWidget)
    code = forms.CharField(max_length=32, widget=UnfoldAdminTextInputWidget)
    recovery = forms.BooleanField(required=False, widget=UnfoldBooleanWidget, label=COPY['use_recovery_code'])


def reset_factor(request, data):
    actor = admin_actor(request)
    account = actor.account
    rate_limit(request, 'factor_reset', identity=str(request.user.pk), limit=5)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        device = Authenticator.objects.select_for_update().filter(user=user, confirmed=True).first()
        if not user.check_password(data['password']) or not device or not (
            RecoveryCode.consume(user, data['code']) if data['recovery'] else device.verify_token(data['code'])
        ):
            raise AuthFailure()
        device.delete()
        RecoveryCode.objects.filter(user=user).delete()
        user.credential_epoch += 1
        user.save()
        audit('mfa_reset', request=request, user=user, account=account, context=actor.context)
        logout(request)


def factor_reset(site, request):
    admin_actor(request)
    form = FactorResetForm(request.POST if request.method == 'POST' else None)
    if request.method == 'POST' and form.is_valid():
        try:
            reset_factor(request, form.cleaned_data)
        except APIException:
            form.add_error(None, COPY['factor_reset_refused'])
        else:
            return redirect('admin:login')
    return render(request, 'accounts/admin/factor_reset.html', {
        **site.each_context(request), 'title': COPY['reset_factor'], 'form': form,
    })


class ProfileForm(forms.ModelForm):
    bio = forms.CharField(
        label=label("Bio"), max_length=2000, required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 4}),
    )
    photo = forms.FileField(
        label=label("Upload profile photo"), required=False,
        help_text=label("JPEG, PNG, or WebP up to 8 MiB."),
        widget=UnfoldAdminImageFieldWidget(attrs={"accept": "image/jpeg,image/png,image/webp"}),
    )
    remove_photo = forms.BooleanField(
        label=label("Remove current photo"), required=False, widget=UnfoldBooleanWidget(),
    )

    class Meta:
        model = User
        fields = PROFILE_FIELDS
        widgets = {
            "display_name": UnfoldAdminTextInputWidget(attrs={"autocomplete": "nickname"}),
            "first_name": UnfoldAdminTextInputWidget(attrs={"autocomplete": "given-name"}),
            "last_name": UnfoldAdminTextInputWidget(attrs={"autocomplete": "family-name"}),
            "phone": UnfoldAdminTextInputWidget(attrs={"autocomplete": "tel", "type": "tel", "dir": "ltr"}),
            "gender": UnfoldAdminSelectWidget(),
            "date_of_birth": UnfoldAdminSingleDateWidget(),
            "preferred_locale": UnfoldAdminSelectWidget(),
        }
        labels = {
            "display_name": COPY["display_name"],
            "first_name": label("First name"),
            "last_name": label("Last name"),
            "phone": label("Phone"),
            "gender": label("Gender"),
            "date_of_birth": label("Date of birth"),
            "preferred_locale": label("Preferred marketplace language"),
        }

    def clean(self):
        data = super().clean()
        if data.get("photo") and data.get("remove_photo"):
            self.add_error("remove_photo", label("Choose either a new photo or removal."))
        return data


@method_decorator([never_cache, require_http_methods(["GET", "HEAD", "POST"])])
def own_profile(site, request):
    actor = admin_actor(request)
    form = ProfileForm(
        request.POST if request.method == "POST" else None,
        request.FILES if request.method == "POST" else None,
        instance=copy(request.user),
    )
    if request.method == "POST" and form.is_valid():
        changes = {
            field: form.cleaned_data[field] for field in PROFILE_FIELDS
            if field in form.changed_data and field in request.POST
        }
        try:
            save_profile(
                request, actor.context, changes,
                upload=form.cleaned_data["photo"], remove_avatar=form.cleaned_data["remove_photo"],
            )
        except ValidationError as error:
            file_errors = error.detail.get("file", []) if isinstance(error.detail, dict) else []
            if file_errors:
                for error_message in file_errors:
                    form.add_error("photo", error_message)
            else:
                form.add_error(None, COPY["profile_refused"])
        except APIException:
            form.add_error(None, COPY["profile_refused"])
        else:
            messages.success(request, label("Profile saved."))
            return redirect("admin:own_profile")
    user = request.user
    profile_labels = {
        "details": label("Personal details"),
        "photo": label("Profile photo"),
        "security": label("Sign-in & security"),
        "email": label("Sign-in email"),
        "joined": label("Date joined"),
        "last_login": label("Last login"),
        "never_signed_in": label("Never signed in"),
    }
    return render(request, "accounts/admin/own_profile.html", {
        **site.each_context(request),
        "title": COPY["own_profile"],
        "form": form,
        "profile_labels": profile_labels,
        "profile_badges": [badge(identity_role(user), ROLE_LABELS), badge(email_status(user), EMAIL_LABELS)],
        "authenticator_enrolled": Authenticator.objects.filter(user=user, confirmed=True).exists(),
    })


class SharedPasswordForm(AdminOwnPasswordChangeForm):
    def clean_old_password(self):
        # The shared service verifies the credential under lock, after its durable throttle.
        return self.cleaned_data["old_password"]


def own_password(site, request):
    from ..services import change_shared_password
    actor = admin_actor(request)
    form = SharedPasswordForm(request.user, request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        try:
            change_shared_password(request, actor.context, form.cleaned_data["old_password"],
                                   form.cleaned_data["new_password1"])
        except APIException:
            form.add_error(None, COPY["password_refused"])
        else:
            return redirect("admin:login")
    return render(request, "registration/password_change_form.html", {
        **site.each_context(request), "title": COPY["change_password"], "form": form,
    })
