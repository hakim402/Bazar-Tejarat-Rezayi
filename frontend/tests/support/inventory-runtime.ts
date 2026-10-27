import type { Page } from "@playwright/test";
import { disposablePython, apiOrigin } from "./identity-runtime";
export function stockFixture(sku = "P7-i-00") {
	return JSON.parse(
		disposablePython(
			"import json,sys\nfrom apps.catalogue.models import Variant\nfrom apps.inventory.models import Batch\nv=Variant.objects.get(sku=json.load(sys.stdin)['sku'])\nprint(json.dumps({'variant':str(v.pk),'seller':str(v.product.seller_id),'product':str(v.product_id),'batch':str(Batch.objects.filter(position_id=v.pk).order_by('code').values_list('pk',flat=True).first() or '')}))",
			JSON.stringify({ sku }),
		),
	) as { variant: string; seller: string; product: string; batch: string };
}
export async function inventoryApi(page: Page, path: string, data?: unknown) {
	return page.evaluate(
		async ({ origin, path, data }) => {
			const csrf = await fetch(`${origin}/api/v1/auth/csrf/`, {
				credentials: "include",
			}).then((r) => r.json());
			const response = await fetch(`${origin}/api/v1/inventory/${path}`, {
				method: data === undefined ? "GET" : "POST",
				credentials: "include",
				cache: "no-store",
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": csrf.csrf_token,
				},
				...(data === undefined ? {} : { body: JSON.stringify(data) }),
			});
			return { status: response.status, body: await response.json() };
		},
		{ origin: apiOrigin, path, data },
	);
}
