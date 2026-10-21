from django.core.exceptions import ObjectDoesNotExist
from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.services import rate_limit
from apps.accounts.views import AuthView
from . import contracts as c
from .access import Actor, membership, visible_profiles
from .models import OwnershipTransfer
from .presentation import invitation_data, member_data, profile_data, transfer_data
from .profiles import create_profile, update_profile
from .teams import accept_invitation, change_member, invitation_action, invitation_from_token, invite
from .transfers import request_transfer, transfer_action


class OrganizationView(AuthView):
    def actor(self, context):
        if context not in {"buyer", "seller", "staff"}:
            raise PermissionDenied()
        actor = Actor(self.request, context)
        actor.account
        return actor

    def handle_exception(self, exc):
        return super().handle_exception(Http404() if isinstance(exc, ObjectDoesNotExist) else exc)

    def profile(self, actor, pk):
        return get_object_or_404(visible_profiles(actor), pk=pk)


class ProfilesView(OrganizationView):
    @extend_schema(operation_id="ProfilesView_get", responses=c.ProfilesResult)
    def get(self, request, context):
        actor = self.actor(context)
        return Response({"profiles": [profile_data(p, actor) for p in visible_profiles(actor)]})

    @extend_schema(operation_id="ProfilesView_post", request=c.ProfileCreate, responses=c.ProfileData)
    def post(self, request, context):
        actor = self.actor(context)
        return Response(profile_data(create_profile(actor, self.data(c.ProfileCreate)), actor), status=201)


class ProfileView(OrganizationView):
    @extend_schema(operation_id="ProfileView_get", responses=c.ProfileData)
    def get(self, request, context, pk):
        actor = self.actor(context)
        return Response(profile_data(self.profile(actor, pk), actor))

    @extend_schema(operation_id="ProfileView_patch", request=c.BusinessProfileUpdate, responses=c.ProfileData)
    def patch(self, request, context, pk):
        actor = self.actor(context)
        self.profile(actor, pk)
        return Response(profile_data(update_profile(actor, pk, self.data(c.BusinessProfileUpdate)), actor))


class TeamView(OrganizationView):
    @extend_schema(operation_id="TeamView_get", responses=c.TeamData)
    def get(self, request, context, pk):
        actor = self.actor(context)
        company = self.profile(actor, pk)
        member = membership(company, actor)
        members = company.memberships.select_related("account__user")
        transfers = company.transfers.select_related("recipient__account__user", "company")
        if not member.is_owner:
            members = members.filter(pk=member.pk)
            transfers = transfers.filter(recipient=member)
        return Response(
            {
                "members": [member_data(m) for m in members.order_by("created_at")],
                "invitations": [invitation_data(i) for i in company.invitations.order_by("-created_at")]
                if member.is_owner
                else [],
                "transfers": [transfer_data(i) for i in transfers.order_by("-created_at")],
            }
        )


class InviteView(OrganizationView):
    @extend_schema(operation_id="InviteView_post", request=c.InvitationCreate, responses=c.InvitationData)
    def post(self, request, context, pk):
        actor = self.actor(context)
        self.profile(actor, pk)
        rate_limit(request, "company_invite", identity=str(actor.account.pk), limit=20)
        item = invite(actor, pk, self.data(c.InvitationCreate))
        item.refresh_from_db()
        return Response(invitation_data(item), status=201)


class InviteActionView(OrganizationView):
    @extend_schema(operation_id="InviteActionView_post", request=c.VersionAction, responses=c.InvitationData)
    def post(self, request, context, pk, invitation_id):
        actor = self.actor(context)
        self.profile(actor, pk)
        data = self.data(c.VersionAction)
        rate_limit(request, "company_invite_resend", identity=str(actor.account.pk), limit=20)
        item = invitation_action(actor, pk, invitation_id, data["action"], data["version"])
        return Response(invitation_data(item))


class MemberView(OrganizationView):
    @extend_schema(operation_id="MemberView_post", request=c.MemberAction, responses=c.MemberData)
    def post(self, request, context, pk, member_id):
        actor = self.actor(context)
        self.profile(actor, pk)
        return Response(member_data(change_member(actor, pk, member_id, self.data(c.MemberAction))))


class InvitationPreviewView(OrganizationView):
    @extend_schema(operation_id="InvitationPreviewView_post", request=c.TokenInput, responses=c.InvitationPreview)
    def post(self, request):
        data = self.data(c.TokenInput)
        rate_limit(request, "invite_preview", limit=30)
        try:
            item = invitation_from_token(data["token"])
        except ValidationError:
            return Response({"status": "unavailable"})
        # Private company details are revealed only after proving the invited identity/context.
        try:
            actor = self.actor("seller")
            if actor.user.email != item.email:
                return Response({"status": "wrong_account"})
        except PermissionDenied:
            return Response({"status": "signin_required"})
        except Exception as exc:
            from apps.accounts.services import AuthFailure

            if isinstance(exc, AuthFailure):
                return Response({"status": "signin_required"})
            raise
        if (
            item.status == "accepted"
            and not item.company.memberships.filter(account=actor.account, active=True).exists()
        ):
            return Response({"status": "unavailable"})
        return Response(
            {
                "status": item.status,
                "company_name": item.company.display_name,
                "invited_hint": item.email[0] + "•••@" + item.email.split("@")[-1],
                "bundles": item.bundles,
            }
        )


class InvitationAcceptView(OrganizationView):
    @extend_schema(operation_id="InvitationAcceptView_post", request=c.TokenInput, responses=c.OperationResult)
    def post(self, request):
        actor = self.actor("seller")
        rate_limit(request, "invite_accept", identity=str(actor.account.pk), limit=20)
        accept_invitation(actor, self.data(c.TokenInput)["token"])
        return Response({"status": "accepted"})


class TransferCreateView(OrganizationView):
    @extend_schema(operation_id="TransferCreateView_post", request=c.TransferCreate, responses=c.TransferData)
    def post(self, request, context, pk):
        actor = self.actor(context)
        self.profile(actor, pk)
        return Response(transfer_data(request_transfer(actor, pk, self.data(c.TransferCreate))), status=201)


class TransferActionView(OrganizationView):
    @extend_schema(operation_id="TransferActionView_post", request=c.TransferAction, responses=c.TransferData)
    def post(self, request, context, pk, transfer_id):
        actor = self.actor(context)
        self.profile(actor, pk)
        get_object_or_404(OwnershipTransfer, pk=transfer_id, company_id=pk)
        data = self.data(c.TransferAction)
        if data["action"] not in {"accept", "cancel"}:
            raise PermissionDenied()
        return Response(transfer_data(transfer_action(actor, transfer_id, data)))
