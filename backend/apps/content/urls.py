from django.urls import path
from . import views as v

urlpatterns = [
    path("public/<str:locale>/shell/", v.PublicShell.as_view()),
    path("public/<str:locale>/home/", v.PublicHome.as_view()),
    path("public/<str:locale>/help/", v.PublicHelp.as_view()),
    path("public/<str:locale>/pages/<slug:key>/", v.PublicPage.as_view()),
    path("editor/<str:context>/items/", v.EditorItems.as_view()),
    path("editor/<str:context>/items/<slug:key>/", v.EditorDetail.as_view()),
    path("editor/<str:context>/items/<slug:key>/actions/", v.EditorAction.as_view()),
    path("editor/<str:context>/revisions/<uuid:pk>/preview/", v.Preview.as_view()),
]
