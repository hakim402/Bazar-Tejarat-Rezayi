"""Loopback-only protocol probes selected solely by the disposable CGI harness."""
import io
import hashlib
from django.http import JsonResponse,FileResponse
from django.urls import path
from config.urls import urlpatterns as application_urls


def echo(request):
    files={name:{'size':f.size,'sha256':hashlib.sha256(f.read()).hexdigest()} for name,f in request.FILES.items()}
    response=JsonResponse({'secure':request.is_secure(),'path':request.path,'query':request.GET.dict(),
        'post':request.POST.dict(),'files':files,'authorization_present':request.META.get('HTTP_AUTHORIZATION')=='Bearer synthetic-gateway-probe'})
    response.set_cookie('probe_one','one',secure=True)
    response.set_cookie('probe_two','two',secure=True)
    return response


def stream(request):
    return FileResponse(io.BytesIO('Synthetic private streaming bytes — دری'.encode()),content_type='application/octet-stream')


def fail(request):
    raise RuntimeError('SYNTHETIC_NEVER_PUBLIC_GATEWAY_ERROR')


urlpatterns=[path('__gateway__/echo/',echo),path('__gateway__/stream/',stream),path('__gateway__/fail/',fail),*application_urls]
