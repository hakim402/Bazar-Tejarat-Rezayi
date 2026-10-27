from django.urls import path
from . import views as v

urlpatterns = [
    path("published/<str:locale>/<uuid:pk>/", v.PublicProduct.as_view()),
    path("images/<uuid:pk>/", v.PublicImage.as_view()),
    path("<seller:context>/images/<uuid:pk>/", v.ImageBytes.as_view()),
    path("<seller:context>/taxonomy/", v.Taxonomy.as_view()),
    path("<seller:context>/products/", v.Products.as_view()),
    path("<seller:context>/products/<uuid:pk>/", v.Detail.as_view()),
    path("<seller:context>/products/<uuid:pk>/actions/", v.Action.as_view()),
    path("<seller:context>/products/<uuid:pk>/prices/", v.Prices.as_view()),
    path("<seller:context>/products/<uuid:pk>/images/", v.Images.as_view()),
]
