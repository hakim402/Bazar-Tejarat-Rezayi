import {
	expect,
	type Browser,
	type Page,
	type BrowserContext,
} from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./identity-runtime";
import { adminActor } from "./admin-runtime";
const states: Record<
	string,
	Awaited<ReturnType<BrowserContext["storageState"]>>
> = {};
export async function catalogueActor(browser: Browser, role = "seller") {
	const permissions: Record<string, string[]> = {
		full: [
			"review_source",
			"review_translation",
			"moderate_catalogue",
			"manage_taxonomy",
		],
		source: ["review_source"],
		translator: ["review_translation"],
		taxonomy: ["manage_taxonomy"],
		moderator: ["moderate_catalogue"],
		inventory: ["read_shortages"],
	};
	if (role in permissions) {
		return (
			await adminActor(
				browser,
				role === "inventory" ? "inventory" : "catalogue",
				permissions[role],
			)
		).context;
	}
	if (!states[role]) {
		const context = await browser.newContext(),
			page = await context.newPage();
		const email = role.startsWith("stock")
			? `phase07-${role === "stock" ? "seller" : role.slice(6)}@example.test`
			: `phase06-${role}@example.test`;
		await page.goto("/en/auth/seller-sign-in");
		await page.locator("[name=email]").fill(email);
		await page.locator("[name=password]").fill(fixturePassword);
		const signed = page.waitForResponse(
			(r) =>
				r.url().endsWith("/api/v1/auth/seller/signin/") &&
				r.request().method() === "POST",
		);
		await page.locator(".account-card > form button[type=submit]").click();
		expect((await signed).status()).toBe(200);
		await expect(page).toHaveURL(/\/account\/seller$/);
		states[role] = await context.storageState();
		await context.close();
	}
	return browser.newContext({ storageState: states[role] });
}
export async function catalogueApi(page: Page, path: string, data?: unknown) {
	return page.evaluate(
		async ({ origin, path, data }) => {
			const token = await fetch(`${origin}/api/v1/auth/csrf/`, {
				credentials: "include",
			}).then((r) => r.json());
			const response = await fetch(`${origin}/api/v1/catalogue/${path}`, {
				method: data === undefined ? "GET" : "POST",
				credentials: "include",
				cache: "no-store",
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": token.csrf_token,
				},
				...(data === undefined ? {} : { body: JSON.stringify(data) }),
			});
			return { status: response.status, body: await response.json() };
		},
		{ origin: apiOrigin, path, data },
	);
}

export async function catalogueOwner(browser: Browser) {
	const context = await browser.newContext(),
		page = await context.newPage();
	const email = disposablePython(
		"import json,sys,uuid\nfrom apps.accounts.models import User\nd=json.load(sys.stdin)\nu=User.objects.create_superuser('phase06-owner-'+str(uuid.uuid4())+'@example.test',d['password'],display_name='Synthetic catalogue owner',email_verified=True)\nprint(u.email)",
		JSON.stringify({ password: fixturePassword }),
	).trim();
	await page.goto(`${apiOrigin}/admin/login/?locale=en`);
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page
		.getByRole("button", { name: "Set up authenticator", exact: true })
		.click();
	const code = disposablePython(
		"import json,sys\nfrom apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\nd=Authenticator.objects.get(user__email=json.load(sys.stdin)['email'])\nprint(f'{TOTP(d.secret).token():06}')",
		JSON.stringify({ email }),
	).trim();
	await page.locator("[name=code]").fill(code);
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await page
		.getByRole("link", {
			name: "I saved my codes — continue to administration",
			exact: true,
		})
		.click();
	await expect(page).toHaveURL(`${apiOrigin}/admin/`);
	return { context, page };
}

/** Fresh owned product; manual-mode fixture publication is explicit, never a real runtime write. */
export function catalogueReviewProduct(category = "clothing") {
	return JSON.parse(
		disposablePython(
			`
import copy,io,json,sys,uuid
from PIL import Image
from types import SimpleNamespace
from unittest.mock import patch
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.organizations.access import Actor
from apps.catalogue.models import Product
from apps.catalogue import services
from apps.catalogue.media import upload
category=json.load(sys.stdin)['category']
template=Product.objects.get(seller__account__user__email='phase06-seller@example.test',variants__sku='SYN-'+category.upper())
u=template.seller.account.user
a=Actor(SimpleNamespace(user=u,account=template.seller.account),'seller')
from apps.accounts.models import Account
staff=Account.objects.get(user__email='phase06-full@example.test',context='staff')
r=Actor(SimpleNamespace(user=staff.user,account=staff),'staff')
with patch('apps.organizations.access.get_grant',side_effect=lambda request,context:request.account),override_settings(CATALOGUE_TRANSLATION_ENABLED=False):
 result=services.create(a,{'seller':template.seller_id,'currency':'AFN','pricing_mode':'fixed'})
 p=Product.objects.get(pk=result['id'])
 body=copy.deepcopy(template.revisions.order_by('number').first().body)
 # Dedicated modes recreate the owned web tmpfs; generate a fresh image instead of copying retired bytes.
 buffer=io.BytesIO()
 Image.new('RGB',(64,48),(30,100,180)).save(buffer,format='PNG')
 uploaded=upload(a,p.pk,p.version,SimpleUploadedFile('synthetic.png',buffer.getvalue(),content_type='image/png'))
 body['images']=[{'id':str(uploaded['id']),'alt':'Synthetic test image','variant':None}]
 for v in body['variants']:
  v.pop('id',None)
  v['sku']='SYN-'+str(uuid.uuid4())[:8]
  v.update(retail='120.50',wholesale='100.00')
 p.refresh_from_db()
 source=services.save(a,p.pk,{'version':p.version,'body':body})['revision']
 p.refresh_from_db()
 services.transition(a,p.pk,{'version':p.version,'revision':source,'action':'submit'})
 p.refresh_from_db()
 services.transition(r,p.pk,{'version':p.version,'revision':source,'action':'publish'})
 p.refresh_from_db()
 print(json.dumps({'id':str(p.pk),'revision':str(source),'version':p.version,'image':str(uploaded['id'])}))
`,
			JSON.stringify({ category }),
		),
	);
}
