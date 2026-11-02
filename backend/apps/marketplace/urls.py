from django.urls import path
from . import views as v

urlpatterns = [
    path("public/<str:locale>/home/", v.Home.as_view()),
    path("public/<str:locale>/categories/", v.Categories.as_view()),
    path("public/<str:locale>/categories/<slug:code>/", v.Category.as_view()),
    path("public/<str:locale>/products/", v.Products.as_view()),
    path("public/<str:locale>/products/<uuid:pk>/", v.Product.as_view()),
    path("public/<str:locale>/stores/", v.Stores.as_view()),
    path("public/<str:locale>/stores/<uuid:pk>/", v.Store.as_view()),
    path("public/<str:locale>/stores/<uuid:pk>/products/", v.StoreProducts.as_view()),
    path("public/<str:locale>/sitemap/", v.Sitemap.as_view()),
    path("public/store-media/<uuid:pk>/", v.PublicMedia.as_view()),
    path("seller/stores/", v.SellerProfiles.as_view()),
    path("seller/stores/<uuid:pk>/", v.SellerStore.as_view()),
    path("seller/stores/<uuid:pk>/actions/", v.SellerAction.as_view()),
    path("seller/stores/<uuid:pk>/uploads/", v.SellerUpload.as_view()),
    path("seller/store-media/<uuid:pk>/", v.SellerMedia.as_view()),
]
