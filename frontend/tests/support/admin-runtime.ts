import { expect, type Browser, type Page } from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./identity-runtime";

/** Native HTML authentication. Never store or capture enrollment/recovery material. */
export async function adminLogin(page: Page, email: string) {
	let recoveryCodes: string[] = [];
	await page.goto(`${apiOrigin}/admin/login/`);
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	const enrollment = page.getByRole("button", {
		name: "Set up authenticator",
		exact: true,
	});
	if (await enrollment.count()) await enrollment.click();
	if (await page.locator("[name=code]").count()) {
		const code = disposablePython(
			"import json,sys\nfrom apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\nd=Authenticator.objects.get(user__email=json.load(sys.stdin)['email'])\nprint(f'{TOTP(d.secret).token():06}')",
			JSON.stringify({ email }),
		).trim();
		await page.locator("[name=code]").fill(code);
		await page.getByRole("button", { name: "Verify", exact: true }).click();
		const saved = page.getByRole("link", {
			name: "I saved my codes — continue to administration",
			exact: true,
		});
		if (await saved.count()) {
			recoveryCodes = await page.locator(".private code").allTextContents();
			await saved.click();
		}
	}
	await expect(page).toHaveURL(`${apiOrigin}/admin/`);
	return recoveryCodes;
}
export async function adminActor(
	browser: Browser,
	app: string,
	codes: string[],
) {
	const fixture = JSON.parse(
		disposablePython(
			"import json,sys,uuid\nfrom apps.accounts.models import User,Account\nfrom django.contrib.auth.models import Group,Permission\nd=json.load(sys.stdin)\nu=User.objects.create_user('admin-browser-'+str(uuid.uuid4())+'@example.test',d['password'],display_name='Synthetic assigned employee',email_verified=True,is_staff=True)\na=Account.objects.create(user=u,context='staff')\ng=Group.objects.create(name='Synthetic admin role '+str(a.pk))\ng.permissions.set(Permission.objects.filter(content_type__app_label=d['app'],codename__in=d['codes']))\nu.groups.add(g)\nprint(json.dumps({'email':u.email,'id':str(u.pk),'account':str(a.pk),'group':g.pk}))",
			JSON.stringify({ app, codes, password: fixturePassword }),
		),
	) as { email: string; id: string; account: string; group: number };
	const context = await browser.newContext(),
		page = await context.newPage();
	await adminLogin(page, fixture.email);
	return { context, page, ...fixture };
}
export async function submitAdmin(
	page: Page,
	url: string,
	fields: Record<string, string>,
) {
	await page.goto(`${apiOrigin}${url}`);
	for (const [name, value] of Object.entries(fields)) {
		const control = page.locator(`[name="${name}"]`);
		if ((await control.evaluate((e) => e.tagName)) === "SELECT")
			await control.selectOption(value);
		else await control.fill(value);
	}
	await page
		.locator('form[method="post"]')
		.filter({ has: page.locator("[name=version]") })
		.getByRole("button", { name: /Save|Action|Submit|Apply/i })
		.click();
}

/** Account controls live inside the native responsive navigation. */
export async function openAdminAccountMenu(page: Page) {
	const menu = page.locator('[aria-controls="owner-user-menu"]');
	if (!(await menu.isVisible()))
		await page
			.getByRole("button", { name: "Toggle navigation", exact: true })
			.click();
	await expect(menu).toBeVisible();
	await menu.click();
}

export async function adminAppearance(
	page: Page,
	width: number,
	theme: "light" | "dark",
) {
	await page.setViewportSize({ width, height: 1000 });
	await page.reload();
	const toggle = page.getByRole("button", {
		name: "Toggle navigation",
		exact: true,
	});
	if (width < 1280 && (await toggle.getAttribute("aria-expanded")) !== "true")
		await toggle.click();
	await page.locator('[aria-controls="owner-user-menu"]').click();
	await page
		.getByRole("button", {
			name: theme === "dark" ? "Dark" : "Light",
			exact: true,
		})
		.click();
	await page.locator('[aria-controls="owner-user-menu"]').click();
	if (width < 1280)
		await page
			.getByRole("button", { name: "Close navigation", exact: true })
			.click();
	await expect(page.locator("html")).toHaveClass(
		theme === "dark" ? /dark/ : /^(?!.*dark)/,
	);
	await page.evaluate(() => document.fonts.ready);
}
