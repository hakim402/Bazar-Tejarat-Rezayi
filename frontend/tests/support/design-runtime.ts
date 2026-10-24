import { disposablePython } from "./identity-runtime";
/** Image-backed, explicitly labelled DEMO records, exclusively in the guarded run-owned database. */
export function designProduct(kind: "headphones" | "saffron" = "headphones") {
	return JSON.parse(
		disposablePython(
			`
import copy,json,sys,uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.organizations.access import Actor
from apps.catalogue.models import Product
from apps.catalogue import services
from apps.catalogue.media import upload
from apps.accounts.models import Account
kind=json.load(sys.stdin)['kind']
category='electronics' if kind=='headphones' else 'food'
template=Product.objects.get(seller__account__user__email='phase06-seller@example.test',variants__sku='SYN-'+category.upper())
a=Actor(SimpleNamespace(user=template.seller.account.user,account=template.seller.account),'seller')
staff=Account.objects.get(user__email='phase06-full@example.test',context='staff')
r=Actor(SimpleNamespace(user=staff.user,account=staff),'staff')
with patch('apps.organizations.access.get_grant',side_effect=lambda request,context:request.account),override_settings(CATALOGUE_TRANSLATION_ENABLED=False):
 result=services.create(a,{'seller':template.seller_id,'currency':'AFN','pricing_mode':'fixed'})
 p=Product.objects.get(pk=result['id'])
 body=copy.deepcopy(template.revisions.order_by('number').first().body)
 body.update(title='DEMO · هدفون بی‌سیم آبی' if kind=='headphones' else 'DEMO · زعفران در ظرف شیشه‌ای',description='نمونهٔ نمایشی برای بررسی طراحی. این محصول و قیمت برای فروش واقعی نیست. تصاویر و مشخصات تنها در دیتابیس جداگانهٔ آزمایش ذخیره می‌شوند.',brand='DEMO')
 names=['headphones.webp','headphones-front.webp'] if kind=='headphones' else ['saffron.webp']
 body['images']=[]
 for index,name in enumerate(names):
  p.refresh_from_db()
  data=(Path('../frontend/tests/fixtures/images')/name).read_bytes()
  image=upload(a,p.pk,p.version,SimpleUploadedFile(name,data,content_type='image/webp'))
  body['images'].append({'id':str(image['id']),'alt':('هدفون آبی، نمای '+str(index+1)) if kind=='headphones' else 'ظرف نمایشی زعفران','variant':None})
 for v in body['variants']:
  v.pop('id',None)
  v['sku']='DEMO-'+str(uuid.uuid4())[:8]
  v.update(retail='2990.00' if kind=='headphones' else '450.00',wholesale='2490.00' if kind=='headphones' else '390.00',minimum='5',contents='یک عدد در هر بسته؛ دادهٔ نمایشی')
 p.refresh_from_db()
 source=services.save(a,p.pk,{'version':p.version,'body':body})['revision']
 p.refresh_from_db()
 services.transition(a,p.pk,{'version':p.version,'revision':source,'action':'submit'})
 p.refresh_from_db()
 services.transition(r,p.pk,{'version':p.version,'revision':source,'action':'publish'})
 print(json.dumps({'id':str(p.pk),'revision':str(source)}))
`,
			JSON.stringify({ kind }),
		),
	) as { id: string; revision: string };
}
