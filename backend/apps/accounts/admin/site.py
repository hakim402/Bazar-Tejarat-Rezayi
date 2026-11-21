"""Owner admin site: admission, MFA login, index routing and URL composition.

Split out of the former monolithic admin.py; behavior is unchanged. The public
``owner_site`` instance is re-exported from ``accounts.admin`` so every dependent
app keeps importing it from the same path.
"""
from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpResponseRedirect
from django.shortcuts import render
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.decorators import method_decorator
from django.utils.translation import gettext_lazy as _
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework.exceptions import APIException
from unfold.sites import UnfoldAdminSite

from .access import GuardedAdminMixin, admin_actor, is_owner
from .copy import COPY as ADMIN_COPY
from .directory import application_directory
from .theme import ACCOUNT_THEME, DIRECTORY_THEME, ORDER_THEME
from ..models import User
from ..copy.owner import COPY, PASSWORD_ONLY_SUBTITLES
from ..services import (admin_mfa_required, audit, begin_signin, finish_mfa,
                        get_grant, start_enrollment)


class OwnerSite(UnfoldAdminSite):
    site_header = "Bazar Rezayi"
    index_title = _("Overview")
    index_template = "accounts/admin/dashboard.html"
    site_title = "Bazar Rezayi"

    def admin_view(self, view, cacheable=False):
        from functools import wraps
        @wraps(view)
        def guarded(request, *args, **kwargs):
            try:
                return view(request, *args, **kwargs)
            except APIException as error:
                if error.status_code == 404:
                    raise Http404 from None
                if error.status_code in {401, 403}:
                    raise PermissionDenied from None
                raise
        return super().admin_view(guarded, cacheable=cacheable)

    def register(self, model_or_iterable, admin_class=None, **options):
        from .labels import localize_model
        guarded = type("Guarded" + admin_class.__name__, (GuardedAdminMixin, admin_class), {})
        result = super().register(model_or_iterable, guarded, **options)
        models = model_or_iterable if isinstance(model_or_iterable, (list, tuple)) else [model_or_iterable]
        for model in models:
            localize_model(model)
        return result

    def get_app_list(self, request, app_label=None):
        # One fresh authority check for a directory, instead of rechecking it for
        # every permission of every model. Actual views/querysets/actions recheck.
        try:
            get_grant(request, 'owner')
            root = True
        except APIException:
            root = False
        previous = getattr(request, '_admin_directory_root', None)
        request._admin_directory_root = root
        try:
            return super().get_app_list(request, app_label)
        finally:
            if previous is None:
                del request._admin_directory_root
            else:
                request._admin_directory_root = previous

    def index(self, request, extra_context=None):
        if is_owner(request):
            return super().index(request, extra_context)
        request.current_app = self.name
        from .work import my_work
        return TemplateResponse(request, "accounts/admin/staff_index.html", {
            **self.each_context(request), "title": ADMIN_COPY["staff_workspace"], "index": True,
            "app_list": self.get_app_list(request), "my_work": my_work(self, request, admin_actor(request)),
            **(extra_context or {}),
        })

    def each_context(self, request):
        context = super().each_context(request)
        return {
            **context,
            "is_owner_admin": is_owner(request),
            "rz_account": ACCOUNT_THEME,
            "rz_order": ORDER_THEME,
            "rz_directory": DIRECTORY_THEME,
            "application_directory": application_directory(
                request, context["available_apps"], context["sidebar_navigation"],
            ),
        }

    def get_urls(self):
        from apps.reports.admin_views import report_urls
        from apps.site.admin import settings_urls
        from .locale import set_language
        from .review_queues import review_queues
        from .security import factor_reset, own_profile
        return [path("factor-reset/", self.admin_view(lambda request: factor_reset(self, request)),
                     name="factor_reset"), path("profile/", self.admin_view(lambda request: own_profile(self, request)),
                     name="own_profile"), path("language/", set_language, name="admin_set_language"),
                path("review-queues/", self.admin_view(lambda request: review_queues(request, self)),
                     name="review_queues"),
                *settings_urls(self), *report_urls(self), *super().get_urls()]

    def has_permission(self, request):
        try:
            admin_actor(request)
            return True
        except (APIException, PermissionDenied):
            return False

    @method_decorator(never_cache)
    @method_decorator(csrf_protect)
    @method_decorator(sensitive_post_parameters())
    def login(self, request, extra_context=None):
        from .locale import admin_language, frontend_locale
        locale = admin_language(request)
        copy_locale = frontend_locale(locale)
        t = COPY[copy_locale]
        context = {
            "stage": "password",
            "error": "",
            "title": t["title"],
            "subtitle": t["subtitle"] if admin_mfa_required() else PASSWORD_ONLY_SUBTITLES[copy_locale],
            "site_header": self.site_header,
            "t": t,
            "locale": locale,
            "direction": "rtl" if locale == "fa-af" else "ltr",
            "admin_copy": ADMIN_COPY,
            "frontend_url": settings.FRONTEND_ORIGIN + "/" + frontend_locale(locale),
            "recovery_url": settings.FRONTEND_ORIGIN + "/" + frontend_locale(locale) + "/auth/forgot-password",
        }
        if self.has_permission(request):
            return HttpResponseRedirect(reverse("admin:index"))
        if request.method == "POST":
            stage = request.POST.get("stage", "password")
            try:
                if stage == "password":
                    state = begin_signin(
                        request, request.POST.get("email", "")[:254], request.POST.get("password", "")[:128],
                        self.login_context(request.POST.get("email", "")[:254]), admin_entry=True,
                    )
                    if state != "signed_in":
                        request.session["pending_mfa"]["entry"] = "admin"
                        request.session.modified = True
                    if state == "signed_in":
                        return HttpResponseRedirect(reverse("admin:index"))
                    context["stage"] = "enroll_start" if state == "enroll" else "challenge"
                elif stage == "enroll":
                    self.require_admin_pending(request)
                    context.update(start_enrollment(request), stage="challenge")
                elif stage == "challenge":
                    self.require_admin_pending(request)
                    codes = finish_mfa(
                        request, request.POST.get("code", "")[:32], recovery=request.POST.get("recovery") == "on"
                    )
                    if not codes:
                        return HttpResponseRedirect(reverse("admin:index"))
                    context.update(stage="complete", codes=codes)
                else:
                    raise ValueError
            except (APIException, ValueError):
                context["error"] = t["error"]
                if stage == "challenge":
                    context["stage"] = "challenge"
        if context["stage"] != "password":
            context["subtitle"] = t["subtitle"]
        response = render(request, "accounts/owner_login.html", context)
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "same-origin"
        return response

    def require_admin_pending(self, request):
        from ..services import AuthFailure
        if request.session.get("pending_mfa", {}).get("entry") != "admin":
            raise AuthFailure()

    def password_change(self, request, extra_context=None):
        from .security import own_password
        return own_password(self, request)

    def login_context(self, email):
        from ..models import normalize_email
        user = User.objects.filter(email=normalize_email(email)).first()
        return "owner" if user and user.is_superuser else "staff"

    def logout(self, request, extra_context=None):
        if request.method == "POST":
            actor = admin_actor(request)
            audit("owner_session_signed_out" if actor.context == "owner" else "staff_session_signed_out",
                  request=request, user=request.user, account=actor.account, context=actor.context)
        return super().logout(request, extra_context)


owner_site = OwnerSite(name="admin")
