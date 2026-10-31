from django.urls import path
from . import views as v

urlpatterns = [
    path("buyer/enquiries/", v.Enquiries.as_view()),
    path("buyer/enquiries/<uuid:pk>/uploads/", v.EnquiryUpload.as_view()),
    path("seller/profiles/", v.Profiles.as_view()),
    path("<marketplace:context>/conversations/", v.Conversations.as_view()),
    path("<marketplace:context>/conversations/<uuid:pk>/", v.Conversation.as_view()),
    path("<marketplace:context>/conversations/<uuid:pk>/messages/", v.Messages.as_view()),
    path("<marketplace:context>/conversations/<uuid:pk>/read/", v.Read.as_view()),
    path("<marketplace:context>/conversations/<uuid:pk>/uploads/", v.Upload.as_view()),
    path("<marketplace:context>/attachments/<uuid:pk>/", v.Attachment.as_view()),
    path("<marketplace:context>/messages/<uuid:pk>/reports/", v.Reports.as_view()),
]
