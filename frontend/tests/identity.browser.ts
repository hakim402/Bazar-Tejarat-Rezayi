import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import {
	apiOrigin as api,
	disposablePython,
	fixturePassword as password,
	identityTestsEnabled as enabled,
} from "./support/identity-runtime";
import { authCopy } from "../lib/i18n/auth";
import { locales, direction, type Locale } from "../lib/i18n/locales";

const evidence =
	process.env.PLAYWRIGHT_EVIDENCE_DIR ?? "../doc/progress/phase-03-identity";
test.skip(
	!enabled,
	"Run through the automatically provisioned disposable test harness.",
);
test.beforeAll(() => {
	if (enabled)
		disposablePython(
			"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
		);
});
// Diagnostic metadata only: no request bodies, cookies, headers, query strings or tokens.
const timings = new WeakMap<Page, object[]>();
test.beforeEach(async ({ page }) => {
	const events: object[] = [];
	timings.set(page, events);
	page.on("requestfinished", (request) => {
		const path = new URL(request.url()).pathname;
		if (
			!/^\/api\/v1\/auth\/(csrf\/|(?:buyer|seller)\/(?:signin\/|link\/(?:buyer|seller)\/))/.test(
				path,
			)
		)
			return;
		void request.response().then((response) =>
			events.push({
				path,
				method: request.method(),
				status: response?.status(),
				durationMs: request.timing().responseEnd,
			}),
		);
	});
});
test.afterEach(async ({ page }, info) => {
	if (process.env.PLAYWRIGHT_EVIDENCE_DIR)
		writeFileSync(
			`${evidence}/identity-timing-${info.testId}.json`,
			JSON.stringify(
				{
					title: info.title,
					outcome: info.status,
					requests: timings.get(page),
				},
				null,
				2,
			),
		);
});

function mailbox(email: string) {
	const script =
		"from pathlib import Path\nfrom email import policy\nfrom email.parser import BytesParser\nimport re,json\nitems=[]\nfor p in Path('/app/data/private-mail').glob('*.eml'):\n m=BytesParser(policy=policy.default).parsebytes(p.read_bytes())\n if str(m['To'])==" +
		JSON.stringify(email) +
		":\n  body=m.get_body(preferencelist=('plain',)).get_content() if m.is_multipart() else m.get_content()\n  match=re.search(r'(http://[^\\s]+#token=[A-Za-z0-9_-]+)',body)\n  if match:items.append((p.stat().st_mtime,match[1]))\nprint(json.dumps(sorted(items)[-1][1]))";
	return JSON.parse(disposablePython(script));
}
function otp(secret: string) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const c of secret.replace(/=/g, "")) {
		bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
	}
	const key = Buffer.from(
		bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [],
	);
	const value = Buffer.alloc(8);
	value.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const digest = createHmac("sha1", key).update(value).digest();
	const offset = digest[19] & 15;
	return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
		.toString()
		.padStart(6, "0");
}
async function login(
	page: Page,
	context = "buyer",
	email = "phase03-linked@example.test",
	locale: Locale = "en",
	pass = password,
) {
	await page.goto(`/${locale}/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(pass);
	await page.locator(".account-card > form button[type=submit]").click();
}

function privilegedFixture(owner: boolean) {
	const email = `browser-${owner ? "owner" : "staff"}-${randomBytes(6).toString("hex")}@example.test`;
	const script =
		"import sys,json,os\nos.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings.development')\nimport django;django.setup()\nfrom apps.accounts.models import User,Account\nfrom apps.accounts.services import audit\nfrom django.contrib.auth.models import Group\ndata=json.load(sys.stdin)\nu=User.objects.create_user(data['email'],data['password'],display_name='Synthetic browser privileged',email_verified=True,is_staff=data['owner'],is_superuser=data['owner'],owner_authority=data['owner'])\nif not data['owner']:\n a=Account.objects.create(user=u,context='staff')\n a.permission_groups.add(Group.objects.get(name='Rezayi: Support'))\naudit('synthetic_browser_fixture_created',user=u)";
	disposablePython(script, JSON.stringify({ email, password, owner }));
	return email;
}
async function newBuyer(page: Page) {
	const email = `browser-${randomBytes(6).toString("hex")}@example.test`;
	await page.goto("/en/auth/buyer-registration");
	await page.locator("[name=display_name]").fill("Synthetic Browser Person");
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(password);
	await page.locator("[name=consent]").check();
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page.getByRole("status")).toContainText("Request received");
	const url = mailbox(email);
	await page.goto(url);
	await expect(page).not.toHaveURL(/#token=/);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page.getByRole("status")).toContainText("Email verified");
	return email;
}

for (const locale of locales) {
	for (const width of [390, 1440]) {
		test(`identity visual ${locale} ${width}: forms direction theme and keyboard`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`/${locale}/auth/buyer-registration`);
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				direction(locale),
			);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				authCopy[locale].buyerRegister,
			);
			await page.evaluate(() => document.fonts.ready);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.keyboard.press("Tab");
			expect(
				await page.evaluate(() => document.activeElement?.tagName !== "BODY"),
			).toBe(true);
			const themes = width === 390 ? ["light", "dark"] : ["light"];
			for (const theme of themes) {
				await page.locator(".preferences select").nth(1).selectOption(theme);
				await page.evaluate(() => {
					(document.activeElement as HTMLElement)?.blur();
					window.scrollTo(0, 0);
				});
				await page.screenshot({
					path: `${evidence}/${locale}-${width}-registration-${theme}.png`,
					fullPage: true,
				});
			}
			await page.goto(`/${locale}/auth/buyer-sign-in`);
			await page
				.locator("[name=email]")
				.fill(
					`missing-${locale}-${width}-${randomBytes(3).toString("hex")}@example.test`,
				);
			await page.locator("[name=password]").fill("Synthetic-wrong-password");
			// Historical measured denial took 8.46 s; await the real response before the 5 s UI assertion.
			const denied = page.waitForResponse(
				(r) =>
					r.url() === `${api}/api/v1/auth/buyer/signin/` &&
					r.request().method() === "POST",
				{ timeout: 12000 },
			);
			await page.locator(".account-card > form button[type=submit]").click();
			expect((await denied).status()).toBe(403);
			await expect(page.locator(".account-error")).toContainText(
				authCopy[locale].denied,
			);
			await expect(page.locator(".account-error")).toBeFocused();
			expect(errors).toEqual([]);
		});
	}
}

test("identity registration verification profile linking and recovery through private mail", async ({
	page,
}) => {
	// This multi-operation real-mail/password journey measured 27.6 s even without the historical slow responses.
	test.setTimeout(60000);
	const email = await newBuyer(page);
	await login(page, "buyer", email);
	await expect(page).toHaveURL(/\/en\/account\/buyer$/);
	await expect(page.locator(".account-summary")).toContainText(email);
	await page.locator("[name=display_name]").fill("Synthetic Updated Person");
	await page.getByRole("button", { name: authCopy.en.editProfile }).click();
	await expect(page.getByRole("status")).toHaveText(authCopy.en.updated);
	await page.goto("/en/account/buyer/link");
	await page.locator("[name=current_password]").fill(password);
	// Linking is real and password-verified; historical response took 5.15 s.
	const linked = page.waitForResponse(
		(r) =>
			r.url() === `${api}/api/v1/auth/buyer/link/seller/` &&
			r.request().method() === "POST",
		{ timeout: 12000 },
	);
	await page.locator(".account-card > form button[type=submit]").click();
	expect((await linked).status()).toBe(200);
	await expect(page.getByRole("status")).toHaveText(authCopy.en.linkDone);
	await page.goto("/en/account/seller");
	await expect(page.locator(".account-error")).toContainText(
		authCopy.en.anonymous,
	);
	await login(page, "seller", email);
	await expect(page).toHaveURL(/\/account\/seller$/);
	await expect(page.locator(".account-summary")).toContainText(
		authCopy.en.pending,
	);
	await page.goto("/en/auth/forgot-password");
	await page.locator("[name=email]").fill(email);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page.getByRole("status")).toContainText("Request received");
	await page.goto(mailbox(email));
	await expect(page).not.toHaveURL(/#token=/);
	const next = `${password}-changed`;
	await page.locator("[name=password]").fill(next);
	await page.locator("[name=repeat]").fill(next);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page.getByRole("status")).toHaveText(
		authCopy.en.passwordUpdated,
	);
	await page.goto("/en/account/buyer");
	await expect(page.locator(".account-error")).toContainText(
		authCopy.en.anonymous,
	);
	await login(page, "buyer", email, "en", next);
	await expect(page).toHaveURL(/\/account\/buyer$/);
});

test("identity distinct tab contexts, context logout and identity replacement", async ({
	page,
	context,
}) => {
	await login(page);
	await expect(page).toHaveURL(/\/account\/buyer$/);
	const buyerId = await page
		.locator(".account-summary bdi")
		.nth(1)
		.textContent();
	const seller = await context.newPage();
	await seller.goto("/en/account/seller");
	await expect(seller.locator(".account-error")).toContainText(
		authCopy.en.anonymous,
	);
	await login(seller, "seller");
	await expect(seller).toHaveURL(/\/account\/seller$/);
	const sellerId = await seller
		.locator(".account-summary bdi")
		.nth(1)
		.textContent();
	expect(buyerId).not.toBe(sellerId);
	await page.reload();
	await expect(page.locator(".account-summary")).toBeVisible();
	await seller
		.getByRole("button", { name: authCopy.en.logout, exact: true })
		.click();
	await expect(seller.getByRole("status")).toHaveText(authCopy.en.signedOut);
	await page.reload();
	await expect(page.locator(".account-summary")).toBeVisible();
	await login(seller, "buyer", "phase03-unrelated@example.test");
	await expect(seller).toHaveURL(/\/account\/buyer$/);
	await page.reload();
	await expect(page.locator(".account-summary")).toContainText(
		"phase03-unrelated@example.test",
	);
	const globalLogout = seller.waitForResponse(
		(response) =>
			response.url() === `${api}/api/v1/auth/logout-all/` &&
			response.request().method() === "POST",
	);
	await seller.getByRole("button", { name: authCopy.en.logoutAll }).click();
	expect((await globalLogout).status()).toBe(200);
	await expect(seller.getByRole("status")).toHaveText(authCopy.en.signedOut);
	await page.reload();
	await expect(page.locator(".account-error")).toContainText(
		authCopy.en.anonymous,
	);
});

test("identity staff enrollment recovery and admin denial", async ({
	page,
}) => {
	const email = privilegedFixture(false);
	await login(page, "staff", email);
	await expect(page.getByText(authCopy.en.enrollBody)).toBeVisible();
	await page.getByRole("button", { name: authCopy.en.beginEnroll }).click();
	const secret = await page.locator(".setup-key").textContent();
	expect(secret).toBeTruthy();
	await page.locator("[name=code]").fill(otp(secret ?? ""));
	// Enrollment hashes one-time recovery codes with the runtime password hasher.
	// Wait for its response rather than racing the default five-second UI assertion.
	const confirmation = page.waitForResponse(
		(response) =>
			response.url() === `${api}/api/v1/auth/mfa/challenge/` &&
			response.request().method() === "POST",
		{ timeout: 20000 },
	);
	await page.locator(".account-card > form button[type=submit]").click();
	expect((await confirmation).status()).toBe(200);
	await expect(page.locator(".recovery-codes")).toBeVisible({ timeout: 10000 });
	const recovery = await page
		.locator(".recovery-codes code")
		.first()
		.textContent();
	await page.getByRole("button", { name: authCopy.en.codesSaved }).click();
	await expect(page).toHaveURL(/\/account\/staff$/);
	await expect(page.locator("main")).toContainText("Support cases");
	await page.screenshot({
		path: `${evidence}/staff-permitted.png`,
		fullPage: true,
	});
	await page.goto(`${api}/admin/`);
	await expect(page).toHaveURL(/\/admin\/login\//);
	await login(page, "staff", email);
	await page.locator("[name=recovery]").check();
	await page.locator("[name=code]").fill(recovery ?? "");
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(/\/account\/staff$/);
});

test("identity owner admin MFA and actual permitted styled administration", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const email = privilegedFixture(true);
	await page.goto(`${api}/admin/login/?locale=en`);
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(password);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("button", { name: "Set up authenticator" }).click();
	const secret = await page.locator("code.private").textContent();
	await page.locator("[name=code]").fill(otp(secret ?? ""));
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await page
		.getByRole("link", {
			name: "I saved my codes — continue to administration",
		})
		.click();
	await expect(page).toHaveURL(`${api}/admin/`);
	await expect(
		page.locator('a[href="/admin/accounts/account/"]:visible').first(),
	).toBeVisible();
	await page.screenshot({
		path: `${evidence}/owner-admin-permitted.png`,
		fullPage: true,
	});
	await page.goto(`${api}/admin/accounts/account/`);
	await expect(page.locator("body")).toContainText("Operational staff");
	await page.setViewportSize({ width: 390, height: 900 });
	await page.screenshot({
		path: `${evidence}/owner-admin-mobile.png`,
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
});

test("identity browser CSRF cookie protection and honest anonymous SSR", async ({
	page,
	context,
	request,
}) => {
	await page.goto("/en/account/buyer");
	await expect(page.locator(".account-error")).toContainText(
		authCopy.en.anonymous,
	);
	const response = await request.get("/en/account/buyer");
	const html = await response.text();
	expect(html).not.toContain("phase03-linked@example.test");
	const rejected = await page.evaluate(async (base) => {
		const response = await fetch(`${base}/api/v1/auth/buyer/signin/`, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		return { status: response.status, data: await response.json() };
	}, api);
	expect(rejected.status).toBe(403);
	expect(rejected.data.error.code).toBe("csrf_failed");
	await login(page);
	await expect(page).toHaveURL(/\/account\/buyer$/);
	const cookies = await context.cookies(api);
	const session = cookies.find((c) => c.name === "sessionid");
	expect(session?.httpOnly).toBe(true);
	expect(session?.sameSite).toBe("Lax");
	expect(session?.domain).toBe("127.0.0.1");
	expect(
		await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k !== "rezayi-theme"),
		),
	).toEqual([]);
});

test("identity A01–A08 Dari desktop and mobile design inventory", async ({
	page,
}) => {
	test.setTimeout(60000);
	const screens = [
		"buyer-registration",
		"seller-registration",
		"buyer-sign-in",
		"seller-sign-in",
		"staff-sign-in",
		"verify-email",
		"forgot-password",
		"reset-password",
	];
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const screen of screens) {
			await page.goto(`/fa-AF/auth/${screen}`);
			await page.locator(".preferences select").nth(1).selectOption("light");
			await page.evaluate(async () => {
				await document.fonts.ready;
				await Promise.all(
					[...document.images]
						.filter((img) => img.getBoundingClientRect().width > 0)
						.map((img) =>
							img.complete
								? Promise.resolve()
								: new Promise((resolve) => {
										img.onload = resolve;
										img.onerror = resolve;
									}),
						),
				);
			});
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.evaluate(() => {
				(document.activeElement as HTMLElement)?.blur();
				window.scrollTo(0, 0);
			});
			await page.screenshot({
				path: `${evidence}/${screen}-fa-AF-${width}.png`,
				fullPage: true,
			});
			if (screen === "buyer-sign-in" || screen === "buyer-registration")
				await page.screenshot({
					path: `${evidence}/${screen}-fa-AF-${width}-viewport.png`,
				});
		}
	}
});
