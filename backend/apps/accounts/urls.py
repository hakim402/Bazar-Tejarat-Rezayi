from django.urls import path, re_path

from . import views, google_views

app_name = "accounts"
urlpatterns = [
    path("google/availability/", google_views.GoogleAvailability.as_view(), name="google-availability"),
    path("google/start/", google_views.GoogleStart.as_view(), name="google-start"),
    path("google/callback/", google_views.GoogleCallback.as_view(), name="google-callback"),
    path("google/complete/", google_views.GoogleComplete.as_view(), name="google-complete"),
    path("csrf/", views.CsrfView.as_view(), name="csrf"),
    re_path(r"^(?P<context>buyer|seller)/register/$", views.RegisterView.as_view(), name="register"),
    re_path(r"^(?P<context>buyer|seller|staff|owner)/signin/$", views.SigninView.as_view(), name="signin"),
    re_path(r"^mail/(?P<purpose>verify|reset)/$", views.MailView.as_view(), name="mail"),
    path("verify/", views.VerifyView.as_view(), name="verify"),
    path("reset/", views.ResetView.as_view(), name="reset"),
    path("logout-all/", views.LogoutAllView.as_view(), name="logout-all"),
    path("mfa/enroll/", views.EnrollmentView.as_view(), name="mfa-enroll"),
    path("mfa/challenge/", views.ChallengeView.as_view(), name="mfa-challenge"),
    re_path(r"^(?P<context>buyer|seller|staff)/session/$", views.SessionView.as_view(), name="session"),
    re_path(r"^(?P<context>buyer|seller|staff)/profile/$", views.ProfileView.as_view(), name="profile"),
    re_path(r"^(?P<context>buyer|seller|staff)/password/$", views.PasswordView.as_view(), name="password"),
    re_path(r"^(?P<context>buyer|seller|staff)/logout/$", views.LogoutView.as_view(), name="logout"),
    re_path(r"^(?P<context>buyer|seller)/link/(?P<target>buyer|seller)/$", views.LinkView.as_view(), name="link"),
    re_path(r"^(?P<context>staff|owner)/mfa/reset/$", views.FactorResetView.as_view(), name="mfa-reset"),
]
