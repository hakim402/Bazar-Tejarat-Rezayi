from django.urls import path
from . import views as v

urlpatterns = [
    path("invitations/preview/", v.InvitationPreviewView.as_view()),
    path("invitations/accept/", v.InvitationAcceptView.as_view()),
    path("<str:context>/profiles/", v.ProfilesView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/", v.ProfileView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/team/", v.TeamView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/invitations/", v.InviteView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/invitations/<uuid:invitation_id>/", v.InviteActionView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/members/<uuid:member_id>/", v.MemberView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/transfers/", v.TransferCreateView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/transfers/<uuid:transfer_id>/", v.TransferActionView.as_view()),
]
