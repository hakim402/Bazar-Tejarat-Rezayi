import {
	expect,
	type Page,
	type Browser,
	type BrowserContext,
} from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./identity-runtime";
import { authCopy } from "../../lib/i18n/auth";
export const actors: Record<string, string> = {};
const states: Record<
	string,
	Awaited<ReturnType<BrowserContext["storageState"]>>
> = {};
export async function staff(browser: Browser, role = "publisher") {
	if (!states[role]) {
		const started = performance.now();
		const context = await browser.newContext(),
			page = await context.newPage(),
			email = disposablePython(
				"import json,sys,uuid\nfrom apps.accounts.models import User,Account\nfrom django.contrib.auth.models import Group\nd=json.load(sys.stdin)\nemail='phase05-browser-'+str(uuid.uuid4())+'@example.test'\nu=User.objects.create_user(email,d['password'],display_name='Synthetic browser editor',email_verified=True)\na=Account.objects.create(user=u,context='staff')\na.permission_groups.add(Group.objects.get(name='Synthetic editorial '+d['role']))\nprint(email)",
				JSON.stringify({ role, password: fixturePassword }),
			).trim();
		actors[role] = email;
		await page.goto("/en/auth/staff-sign-in");
		await page.locator("[name=email]").fill(email);
		await page.locator("[name=password]").fill(fixturePassword);
		const login = page.waitForResponse(
			(r) =>
				r.url().endsWith("/api/v1/auth/staff/signin/") &&
				r.request().method() === "POST",
		);
		await page.locator(".account-card > form button[type=submit]").click();
		const stage = (await (await login).json()).status;
		if (stage === "enroll")
			await page
				.getByRole("button", { name: authCopy.en.beginEnroll, exact: true })
				.click();
		const code = disposablePython(
			"import json,sys\nfrom apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\nd=Authenticator.objects.get(user__email=json.load(sys.stdin)['email'])\nprint(f'{TOTP(d.secret).token():06}')",
			JSON.stringify({ email }),
		).trim();
		await page.locator("[name=code]").fill(code);
		await page.locator(".account-card > form button[type=submit]").click();
		if (stage === "enroll")
			await page
				.getByRole("button", { name: authCopy.en.codesSaved, exact: true })
				.click();
		await expect(page).toHaveURL(/account\/staff/);
		states[role] = await context.storageState();
		console.log(
			`Synthetic ${role} privileged fixture ready in ${Math.round(performance.now() - started)} ms`,
		);
		await context.close();
	}
	return browser.newContext({ storageState: states[role] });
}
export async function api(page: Page, path: string, data?: unknown) {
	return page.evaluate(
		async ({ origin, path, data }) => {
			const ready = await fetch(`${origin}/api/v1/auth/csrf/`, {
				credentials: "include",
			}).then((r) => r.json());
			const response = await fetch(`${origin}/api/v1/content/${path}`, {
				credentials: "include",
				cache: "no-store",
				method: data === undefined ? "GET" : "POST",
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": ready.csrf_token,
				},
				...(data === undefined ? {} : { body: JSON.stringify(data) }),
			});
			return { status: response.status, body: await response.json() };
		},
		{ origin: apiOrigin, path, data },
	);
}
