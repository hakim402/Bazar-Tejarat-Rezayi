"""Native authenticated factor maintenance; shared identity/grant invariants stay authoritative."""
from django import forms
from unfold.widgets import UnfoldAdminTextInputWidget, UnfoldAdminPasswordWidget, UnfoldBooleanWidget
from django.contrib.auth import logout
from unfold.forms import AdminOwnPasswordChangeForm
from django.db import transaction
from django.shortcuts import render, redirect
from rest_framework.exceptions import APIException
from .admin_access import admin_actor
from .admin_copy import COPY
from .models import User, Authenticator, RecoveryCode
from .services import AuthFailure, audit, rate_limit


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


class ProfileForm(forms.Form):
    display_name = forms.CharField(max_length=150, widget=UnfoldAdminTextInputWidget, label=COPY["display_name"])


def own_profile(site, request):
    from .services import update_display_name
    actor = admin_actor(request)
    form = ProfileForm(request.POST if request.method == "POST" else None,
                       initial={"display_name": request.user.display_name})
    if request.method == "POST" and form.is_valid():
        try:
            update_display_name(request, actor.context, form.cleaned_data["display_name"])
        except APIException:
            form.add_error(None, COPY["profile_refused"])
        else:
            return redirect("admin:own_profile")
    return render(request, "accounts/admin/own_profile.html", {
        **site.each_context(request), "title": COPY["own_profile"], "form": form,
    })


class SharedPasswordForm(AdminOwnPasswordChangeForm):
    def clean_old_password(self):
        # The shared service verifies the credential under lock, after its durable throttle.
        return self.cleaned_data["old_password"]


def own_password(site, request):
    from .services import change_shared_password
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
