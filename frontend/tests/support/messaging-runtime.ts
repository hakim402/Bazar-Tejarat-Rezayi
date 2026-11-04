import { expect, type Browser, type Page } from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./identity-runtime";
export function messageFixture() {
	return JSON.parse(
		disposablePython(`import json
from apps.messaging.models import Conversation,Report,Attachment
from apps.organizations.models import BusinessProfile
from apps.catalogue.models import Product
a=BusinessProfile.objects.get(account__user__email='phase08-company@example.test',kind='company')
b=BusinessProfile.objects.get(account__user__email='phase09-company2@example.test',kind='company')
c=Conversation.objects.get(buyer__user__email='phase09-buyer@example.test',seller=a)
d=Conversation.objects.get(buyer__user__email='phase09-buyer@example.test',seller=b)
i=Conversation.objects.filter(buyer__user__email='phase09-buyer@example.test',seller__kind='individual').first()
p=Product.objects.filter(seller__account__user__email='phase08-seller@example.test',published__isnull=False).order_by('-created_at').first()
r=Report.objects.filter(message__conversation=c).order_by('created_at').first()
image=Attachment.objects.filter(conversation=c,message__isnull=False).first()
print(json.dumps({'companyA':str(a.pk),'companyB':str(b.pk),'threadA':str(c.pk),'threadB':str(d.pk),'individual':str(i.pk),'product':str(p.pk),'report':str(r.pk),'image':str(image.pk)}))`),
	) as {
		companyA: string;
		companyB: string;
		threadA: string;
		threadB: string;
		individual: string;
		product: string;
		report: string;
		image: string;
	};
}
export async function messageLogin(
	browser: Browser,
	context: "buyer" | "seller",
	role = context === "buyer" ? "buyer" : "member",
) {
	// Transition emulation explicitly before opening pages; default online mode
	// alone can inherit host connectivity. Keep real offline journeys below.
	// Individual offline journeys still toggle this context through Playwright.
	const session = await browser.newContext({ offline: true });
	await session.setOffline(false);
	const page = await session.newPage();
	await page.goto(`/en/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(`phase09-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	const response = page.waitForResponse(
		(r) =>
			r.url().endsWith(`/auth/${context}/signin/`) &&
			r.request().method() === "POST",
	);
	await page.locator(".account-card > form button[type=submit]").click();
	expect((await response).status()).toBe(200);
	await expect(page).toHaveURL(new RegExp(`/account/${context}$`));
	return { session, page };
}
export async function privatePost(
	page: Page,
	path: string,
	data: unknown,
	method = "POST",
) {
	const csrf = (
		await (await page.request.get(`${apiOrigin}/api/v1/auth/csrf/`)).json()
	).csrf_token;
	return page.request.fetch(`${apiOrigin}/api/v1/${path}`, {
		method,
		data,
		headers: {
			"X-CSRFToken": csrf,
			Origin: process.env.PLAYWRIGHT_BASE_URL ?? "",
		},
	});
}
export function syntheticImage() {
	return {
		name: "synthetic-private.png",
		mimeType: "image/png",
		buffer: Buffer.from(
			disposablePython(
				"import base64,io\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(64,48),'blue').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
			).trim(),
			"base64",
		),
	};
}
export function historyCount(id: string) {
	return Number(
		disposablePython(
			`from apps.messaging.models import Message\nprint(Message.objects.filter(conversation_id='${id}').count())`,
		).trim(),
	);
}
export function personalRead(email: string, id: string) {
	return Number(
		disposablePython(
			`from apps.messaging.models import ReadState\nprint(ReadState.objects.filter(account__user__email='${email}',conversation_id='${id}').values_list('last_read',flat=True).first() or 0)`,
		).trim(),
	);
}
