import {
	test,
	expect,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { organizationCopy } from "../lib/i18n/organizations";
import { authCopy } from "../lib/i18n/auth";
import { locales, direction, type Locale } from "../lib/i18n/locales";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
const enabled = process.env.ORGANIZATIONS_BROWSER_TESTS === "1";
const evidence =
	process.env.PLAYWRIGHT_EVIDENCE_DIR ??
	"../doc/progress/phase-04-organizations/evidence";
test.skip(!enabled, "Use the maintained Phase 04 disposable harness.");
let reviewerState: Awaited<ReturnType<BrowserContext["storageState"]>>;
async function login(
	page: Page,
	email: string,
	context = "seller",
	locale: Locale = "en",
) {
	await page.goto(`/${locale}/auth/${context}-sign-in`);
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	if (context !== "staff")
		await expect(page).toHaveURL(new RegExp(`/account/${context}`));
}
function fixture(name: string, context = "seller") {
	return JSON.parse(
		disposablePython(
			"import json,sys\nfrom apps.accounts.models import User,Account\nd=json.load(sys.stdin)\nu=User.objects.create_user(d['email'],d['password'],display_name='Synthetic browser applicant',email_verified=True)\na=Account.objects.create(user=u,context=d['context'])\nif d['context']=='staff':\n from django.contrib.auth.models import Group\n g=Group.objects.create(name='Synthetic browser reviewer '+str(a.pk))\n g.permissions.set(Group.objects.get(name='Rezayi: Business review').permissions.all())\n a.permission_groups.add(g)\nprint(json.dumps({'email':u.email,'account':str(a.pk)}))",
			JSON.stringify({
				email: `phase04-browser-${name}@example.test`,
				password: fixturePassword,
				context,
			}),
		),
	);
}
async function reviewer(browser: Browser) {
	if (!reviewerState) {
		const context = await browser.newContext();
		const page = await context.newPage();
		const actor = fixture(
			`reviewer-${randomBytes(6).toString("hex")}`,
			"staff",
		);
		await login(page, actor.email, "staff");
		await Promise.all([
			page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/v1/auth/mfa/enroll/") &&
					response.status() === 200,
			),
			page
				.getByRole("button", { name: authCopy.en.beginEnroll, exact: true })
				.click(),
		]);
		const code = disposablePython(
			"import json,sys\nfrom apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\nd=Authenticator.objects.get(user__email=json.load(sys.stdin)['email'])\nprint(f'{TOTP(d.secret).token():06}')",
			JSON.stringify({ email: actor.email }),
		).trim();
		await page.locator("[name=code]").fill(code);
		await page.locator(".account-card > form button[type=submit]").click();
		await page
			.getByRole("button", { name: authCopy.en.codesSaved, exact: true })
			.click();
		await expect(page).toHaveURL(/account\/staff/);
		reviewerState = await context.storageState();
		await context.close();
	}
	return browser.newContext({ storageState: reviewerState });
}
async function loginOwner(page: Page, email: string) {
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
}
async function createProfile(
	page: Page,
	locale: Locale,
	kind = "individual",
	displayName = `Synthetic browser ${locale}`,
) {
	const t = organizationCopy[locale];
	await page.goto(`/${locale}/account/seller/organizations`);
	await page.locator("[name=kind]").selectOption(kind);
	for (const [key, value] of Object.entries({
		display_name: displayName,
		legal_name: "Synthetic legal identity",
		business_type: "Synthetic trade",
		contact_phone: "00000000",
		location: "Synthetic location",
		representative: "Synthetic representative",
	})) {
		await page.locator(`[name=${key}]`).fill(value);
	}
	await page.getByRole("button", { name: t.create, exact: true }).click();
	await page.getByRole("link", { name: displayName, exact: true }).click();
	await page.getByRole("button", { name: t.application, exact: true }).click();
}
async function upload(page: Page, locale: Locale) {
	const t = organizationCopy[locale];
	const content = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgMEoBIQgFAA7mAlkuIp5hAAAAAElFTkSuQmCC",
		"base64",
	);
	await page.locator("[name=file]").setInputFiles({
		name: "synthetic.png",
		mimeType: "image/png",
		buffer: content,
	});
	await page.getByRole("button", { name: t.upload, exact: true }).click();
	await expect(
		page.getByRole("link", { name: t.download, exact: true }),
	).toHaveCount(1);
}
async function decide(page: Page, name: string, action: string) {
	const t = organizationCopy.en;
	await page.goto("/en/account/staff/verification");
	await page.locator("[name=filter]").selectOption("submitted");
	const row = page
		.locator("li")
		.filter({ has: page.getByRole("link", { name, exact: true }) })
		.first();
	const href = await row
		.getByRole("link", { name, exact: true })
		.getAttribute("href");
	if (!href) throw new Error("Synthetic case link is missing");
	await Promise.all([
		page.waitForResponse(
			(response) =>
				response.url().includes("/api/v1/verification/cases/") &&
				response.request().method() === "POST" &&
				response.status() === 200,
		),
		row.getByRole("button", { name: t.assign, exact: true }).click(),
	]);
	await page.goto(href);
	await page.locator("[name=action]").selectOption(action);
	await page
		.locator("[name=reason]")
		.fill(
			action === "needs_information"
				? "Synthetic correction requested"
				: "Synthetic approval completed",
		);
	await page
		.locator("[name=internal_note]")
		.fill("PRIVATE synthetic internal note");
	await page.getByRole("button", { name: t.decision, exact: true }).click();
	await expect(page.getByTestId("staff-case-status")).toContainText(
		action === "needs_information" ? t.needs_information : t.approved,
	);
}
test.beforeAll(async () => {
	if (enabled)
		disposablePython(
			"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
		);
	await mkdir(evidence, { recursive: true });
});
for (const locale of locales) {
	test(`Phase04 applicant corrections resubmit and staff approval ${locale}`, async ({
		page,
		browser,
	}) => {
		test.setTimeout(90000);
		const t = organizationCopy[locale];
		const user = fixture(`applicant-${locale}`);
		await login(page, user.email, "seller", locale);
		await createProfile(page, locale);
		page.on("dialog", (dialog) => dialog.accept());
		await upload(page, locale);
		await page.getByRole("button", { name: t.submit, exact: true }).click();
		await expect(page.getByTestId("case-status")).toContainText(t.submitted);
		const staffContext = await reviewer(browser);
		const staff = await staffContext.newPage();
		staff.on("dialog", (dialog) => dialog.accept());
		await decide(staff, `Synthetic browser ${locale}`, "needs_information");
		await page.reload();
		await page
			.getByRole("button", { name: t.application, exact: true })
			.click();
		await expect(page.getByTestId("case-status")).toContainText(
			t.needs_information,
		);
		await expect(page.locator("body")).not.toContainText(
			"PRIVATE synthetic internal note",
		);
		await page.getByRole("button", { name: t.revise, exact: true }).click();
		await expect(page.getByTestId("case-status")).toContainText(t.draft);
		await page.getByRole("button", { name: t.submit, exact: true }).click();
		await expect(page.getByTestId("case-status")).toContainText(t.submitted);
		await decide(staff, `Synthetic browser ${locale}`, "approved");
		await page.reload();
		await expect(page.getByTestId("profile-entitlement")).toHaveText(
			`${t.entitlement}: ${t.eligible}`,
		);
		await page.screenshot({
			path: `${evidence}/phase04-approved-${locale}.png`,
			fullPage: true,
		});
		await staffContext.close();
	});
}
for (const locale of locales) {
	for (const width of [390, 1440]) {
		test(`Phase04 company/invitation visual ${locale} ${width}`, async ({
			page,
		}) => {
			const t = organizationCopy[locale];
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.setViewportSize({ width, height: 900 });
			await login(page, "phase04-company-owner@example.test", "seller", locale);
			await page.goto(`/${locale}/account/seller/organizations`);
			await page
				.getByRole("link", { name: "Synthetic company team", exact: true })
				.click();
			await page.getByRole("button", { name: t.team, exact: true }).click();
			await expect(
				page.getByRole("heading", { name: t.team, exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: /Synthetic company-owner/ }),
			).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				direction(locale),
			);
			await page.keyboard.press("Tab");
			await page.screenshot({
				path: `${evidence}/phase04-team-${locale}-${width}-light.png`,
				fullPage: true,
			});
			await page.evaluate(() => {
				document.documentElement.dataset.theme = "dark";
				localStorage.setItem("rezayi-theme", "dark");
			});
			await page.screenshot({
				path: `${evidence}/phase04-team-${locale}-${width}-dark.png`,
				fullPage: true,
			});
			await page.goto(`/${locale}/invitation#token=${"x".repeat(43)}`);
			await expect(page).not.toHaveURL(/#token=/);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				t.unavailable,
			);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: `${evidence}/phase04-invitation-unavailable-${locale}-${width}.png`,
				fullPage: true,
			});
			expect(errors).toEqual([]);
		});
	}
}
test("Phase04 invitation correct account explicit acceptance permission reduction revocation and denied files", async ({
	page,
	browser,
}) => {
	test.setTimeout(90000);
	const t = organizationCopy.en;
	await login(page, "phase04-company-owner@example.test");
	await page.goto("/en/account/seller/organizations");
	await page
		.getByRole("link", { name: "Synthetic company team", exact: true })
		.click();
	await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
	const companyUrl = page.url();
	await page.getByRole("button", { name: t.team, exact: true }).click();
	await page.getByRole("button", { name: t.invitations, exact: true }).click();
	await page.locator("[name=email]").fill("phase04-invitee@example.test");
	await page.locator("[name=bundles][value=messaging]").check();
	await page.getByRole("button", { name: t.invite, exact: true }).click();
	await expect(
		page.getByText("phase04-invitee@example.test", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: t.resend, exact: true })
		.first()
		.click();
	const token = JSON.parse(
		disposablePython(
			"import json\nfrom email import policy\nfrom email.parser import BytesParser\nfrom pathlib import Path\nimport re\nlinks=[]\nfor p in Path('/app/data/private-mail').glob('*.eml'):\n m=BytesParser(policy=policy.default).parsebytes(p.read_bytes())\n if str(m['To'])=='phase04-invitee@example.test':\n  text=m.get_body(preferencelist=('plain',)).get_content()\n  match=re.search(r'#token=([A-Za-z0-9_-]+)',text)\n  if match:links.append((p.stat().st_mtime,match[1]))\nprint(json.dumps(sorted(links)[-1][1]))",
		),
	);
	const invited = await browser.newContext();
	const guest = await invited.newPage();
	await guest.goto(`/en/invitation#token=${token}`);
	await expect(guest.getByRole("status")).toContainText(t.signin_required);
	await guest.getByRole("link", { name: t.signin, exact: true }).click();
	await guest.locator("[name=email]").fill("phase04-invitee@example.test");
	await guest.locator("[name=password]").fill(fixturePassword);
	await guest.locator(".account-card > form button[type=submit]").click();
	await expect(
		guest.getByRole("button", { name: t.accept, exact: true }),
	).toBeVisible();
	await guest.screenshot({
		path: `${evidence}/phase04-invitation-accept-en.png`,
		fullPage: true,
	});
	await guest.getByRole("button", { name: t.accept, exact: true }).click();
	await expect(guest.getByRole("status")).toContainText(t.joined);
	await guest.goto(companyUrl);
	await expect(guest.getByTestId("profile-entitlement")).toHaveText(
		`${t.entitlement}: ${t.eligible}`,
	);
	await expect(
		guest.getByRole("button", { name: t.application, exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: t.members, exact: true }).click();
	const row = page
		.locator("li")
		.filter({ has: page.getByRole("heading", { name: /Synthetic invitee/ }) })
		.first();
	await row.locator("summary").click();
	await row.locator("[name=bundles][value=messaging]").uncheck();
	await row.locator("[name=bundles][value=catalogue]").check();
	await Promise.all([
		page.waitForResponse(
			(response) =>
				response.url().includes("/members/") &&
				response.request().method() === "POST" &&
				response.status() === 200,
		),
		row.getByRole("button", { name: t.permissions, exact: true }).click(),
	]);
	await guest.reload();
	await expect(guest.getByText(t.catalogue, { exact: true })).toBeVisible();
	await expect(guest.getByText(t.messaging, { exact: true })).toHaveCount(0);
	page.on("dialog", (dialog) => dialog.accept());
	await Promise.all([
		page.waitForResponse(
			(response) =>
				response.url().includes("/members/") &&
				response.request().method() === "POST" &&
				response.status() === 200,
		),
		row.getByRole("button", { name: t.revoke, exact: true }).click(),
	]);
	await guest.reload();
	await expect(
		guest.getByRole("alert").filter({ hasText: t.denied }),
	).toBeVisible();
	const denied = await guest.request.get(
		`${apiOrigin}/api/v1/verification/queue/`,
	);
	expect(denied.status()).toBe(403);
	await invited.close();
});
test("Phase04 recipient accepts and staff reviews ownership transfer; outgoing owner loses team administration", async ({
	page,
	browser,
}) => {
	test.setTimeout(90000);
	const t = organizationCopy.en;
	await login(page, "phase04-member@example.test");
	await page.goto("/en/account/seller/organizations");
	await page
		.getByRole("link", { name: "Synthetic company team", exact: true })
		.click();
	await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
	const companyUrl = page.url();
	await page.getByRole("button", { name: t.transfers, exact: true }).click();
	await page
		.getByRole("button", { name: t.acceptTransfer, exact: true })
		.click();
	await expect(page.getByText(t.accepted, { exact: true })).toBeVisible();
	const context = await reviewer(browser);
	const staff = await context.newPage();
	await staff.goto("/en/account/staff/transfers");
	await staff
		.getByRole("link", { name: "Synthetic company team", exact: true })
		.click();
	staff.on("dialog", (dialog) => dialog.accept());
	await staff
		.locator("[name=reason]")
		.fill("Synthetic browser transfer review");
	await staff.getByRole("button", { name: t.decision, exact: true }).click();
	await expect(staff.getByText(t.approved, { exact: true })).toBeVisible();
	await page.reload();
	await page.getByRole("button", { name: t.team, exact: true }).click();
	await page.getByRole("button", { name: t.invitations, exact: true }).click();
	await expect(
		page.getByRole("button", { name: t.invite, exact: true }),
	).toBeVisible();
	await context.close();
	const outgoing = await browser.newContext();
	const old = await outgoing.newPage();
	await login(old, "phase04-company-owner@example.test");
	await old.goto(companyUrl);
	await expect(
		old.getByRole("heading", { name: "Synthetic company team", exact: true }),
	).toBeVisible();
	await expect(
		old.getByRole("button", { name: t.application, exact: true }),
	).toHaveCount(0);
	await old.getByRole("button", { name: t.invitations, exact: true }).click();
	await expect(
		old.getByRole("button", { name: t.invite, exact: true }),
	).toHaveCount(0);
	await outgoing.close();
});

test("Phase04 business buyer remains independent of the same identity's approved seller", async ({
	page,
}) => {
	const t = organizationCopy.en;
	await login(page, "phase04-shared@example.test", "buyer");
	await page.goto("/en/account/buyer/organizations");
	await page
		.getByRole("link", {
			name: "Synthetic shared buyer unverified",
			exact: true,
		})
		.click();
	await expect(page.getByTestId("profile-entitlement")).toHaveText(
		`${t.entitlement}: ${t.ineligible}`,
	);
	await page.getByRole("button", { name: t.application, exact: true }).click();
	await expect(page.getByTestId("case-status")).toContainText(t.draft);
	await expect(
		page.getByRole("button", { name: t.team, exact: true }),
	).toHaveCount(0);
});

test("Phase04 owner admin shows guarded business records and readonly audit history", async ({
	page,
}) => {
	test.setTimeout(60000);
	const email = "phase04-browser-owner@example.test";
	disposablePython(
		"import sys,json\nfrom apps.accounts.models import User\nd=json.load(sys.stdin)\nUser.objects.create_superuser(d['email'],d['password'],display_name='Synthetic browser owner',email_verified=True)",
		JSON.stringify({ email, password: fixturePassword }),
	);
	await loginOwner(page, email);
	await page.goto(`${apiOrigin}/admin/organizations/businessprofile/`);
	await expect(page.locator("#result_list")).toBeVisible();
	await page.goto(`${apiOrigin}/admin/verification/reviewcase/`);
	await expect(page.locator("#result_list")).toBeVisible();
	await page.screenshot({
		path: `${evidence}/phase04-owner-review-cases.png`,
		fullPage: true,
	});
	await page.goto(`${apiOrigin}/admin/accounts/auditevent/`);
	await expect(page.locator("#result_list")).toBeVisible();
	await expect(page.locator('.object-tools a[href$="/add/"]')).toHaveCount(0);
});

test("Phase04 long Dari company name, upload error recovery and keyboard focus", async ({
	page,
}) => {
	test.setTimeout(60000);
	const locale = "fa-AF";
	const t = organizationCopy[locale];
	const user = fixture("long-name");
	const name = `شرکت آزمایشی ${"بازرگانی ".repeat(12).trim()}`;
	await page.setViewportSize({ width: 390, height: 900 });
	await login(page, user.email, "seller", locale);
	await createProfile(page, locale, "company", name);
	await page
		.locator("header")
		.getByRole("combobox")
		.nth(1)
		.selectOption("dark");
	await page.locator("[name=file]").setInputFiles({
		name: "untrusted.svg",
		mimeType: "image/svg+xml",
		buffer: Buffer.from('<svg onload="alert(1)"/>'),
	});
	await Promise.all([
		page.waitForResponse(
			(response) =>
				response.url().includes("/evidence/") &&
				response.request().method() === "POST" &&
				response.status() === 400,
		),
		page.getByRole("button", { name: t.upload, exact: true }).click(),
	]);
	const alert = page.getByRole("alert").filter({ hasText: t.invalid });
	await expect(alert).toBeVisible();
	await expect(alert).toBeFocused();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: `${evidence}/phase04-long-name-error-dari-mobile.png`,
		fullPage: true,
	});
	await upload(page, locale);
	await expect(alert).toHaveCount(0);
	await page.getByRole("button", { name: t.upload, exact: true }).focus();
	await page.keyboard.press("Tab");
	await expect(page.locator("main summary").first()).toBeFocused();
	await page.setViewportSize({ width: 1440, height: 900 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: `${evidence}/phase04-long-name-dari-desktop.png`,
		fullPage: true,
	});
});

function alternativeFixture(name: string) {
	return JSON.parse(
		disposablePython(
			"import json,sys\nfrom apps.accounts.models import User,Account\nfrom apps.organizations.management.commands.seed_organization_examples import FixtureActor\nfrom apps.organizations.profiles import create_profile,current_case\nfrom apps.verification.services import application_action\nd=json.load(sys.stdin)\nu=User.objects.create_user(d['name']+'@example.test',d['password'],display_name='Synthetic review-fix applicant',email_verified=True)\na=FixtureActor(Account.objects.create(user=u,context='seller'))\np=create_profile(a,dict(kind='company',display_name=d['name'],legal_name='PRIVATE synthetic legal',business_type='Synthetic trade',contact_phone='000000',location='PRIVATE synthetic location',representative='Synthetic representative'))\nreasons={k:'Synthetic requested alternative '+k for k in ('business','representative_identity','representative_authority')}\nc=application_action(a,p.pk,dict(version=current_case(p).version,action='submit',alternative_requests=reasons))\nprint(json.dumps({'id':str(c.pk),'name':p.display_name,'requests':reasons}))",
			JSON.stringify({ name, password: fixturePassword }),
		),
	);
}

test("Phase04 reviewed P1 assignment acknowledgment and active-session read removal stay private", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const item = alternativeFixture("Synthetic-review-fix-assignment");
	const target = fixture("assignment-other", "staff");
	const context = await reviewer(browser);
	const page = await context.newPage();
	const t = organizationCopy.en;
	const path = `${apiOrigin}/api/v1/verification/cases/${item.id}/`;
	await page.goto("/en/account/staff/verification");
	const row = page
		.locator("li")
		.filter({ has: page.getByRole("link", { name: item.name, exact: true }) })
		.first();
	const currentAccount = await page.evaluate(async (origin) => {
		const r = await fetch(`${origin}/api/v1/verification/queue/`, {
			credentials: "include",
		});
		const data: { current_account_id?: unknown } = await r.json();
		if (typeof data.current_account_id !== "string")
			throw new Error("Missing current account");
		return data.current_account_id;
	}, apiOrigin);
	let response = page.waitForResponse(
		(r) => r.url() === path && r.request().method() === "POST",
	);
	await row.getByRole("button", { name: t.assign, exact: true }).click();
	expect(Object.keys(await (await response).json()).sort()).toEqual([
		"id",
		"status",
		"version",
	]);
	await page.goto(`/en/account/staff/verification/${item.id}`);
	await expect(
		page.getByText("PRIVATE synthetic legal", { exact: true }),
	).toBeVisible();
	disposablePython(
		"import json,sys\nfrom apps.accounts.models import Account\nfrom django.contrib.auth.models import Permission\na=Account.objects.get(pk=json.load(sys.stdin)['account'])\ng=a.permission_groups.get()\nassert g.name.startswith('Synthetic browser reviewer ')\ng.permissions.remove(Permission.objects.get(content_type__app_label='verification',codename='read_evidence'))",
		JSON.stringify({ account: currentAccount }),
	);
	await page.reload();
	await expect(
		page.getByRole("alert").filter({ hasText: t.denied }),
	).toBeVisible();
	await expect(
		page.getByText("PRIVATE synthetic legal", { exact: true }),
	).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 900 });
	await page.screenshot({
		path: `${evidence}/phase04-review-fix-staff-denied-mobile.png`,
		fullPage: true,
	});
	await page.goto("/en/account/staff/verification");
	await page.locator("[name=filter]").selectOption("under_review");
	const assignedRow = page
		.locator("li")
		.filter({ has: page.getByRole("link", { name: item.name, exact: true }) })
		.first();
	await assignedRow.locator("[name=reviewer]").selectOption(target.account);
	response = page.waitForResponse(
		(r) => r.url() === path && r.request().method() === "POST",
	);
	await assignedRow
		.getByRole("button", { name: t.assign, exact: true })
		.click();
	expect((await response).status()).toBe(200);
	expect(Object.keys(await (await response).json()).sort()).toEqual([
		"id",
		"status",
		"version",
	]);
	await expect(
		page.getByRole("status").filter({ hasText: t.saved }),
	).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({
		path: `${evidence}/phase04-review-fix-staff-assigned.png`,
		fullPage: true,
	});
	await page.goto(`/en/account/staff/verification/${item.id}`);
	await expect(
		page.getByRole("alert").filter({ hasText: t.denied }),
	).toBeVisible();
	await context.close();
});

test("Phase04 reviewed P2 owner submits rendered alternative form with preserved errors and reasons", async ({
	page,
}) => {
	test.setTimeout(90000);
	const item = alternativeFixture("Synthetic-review-fix-owner-alternatives");
	const email = "phase04-review-fix-owner@example.test";
	disposablePython(
		"import json,sys\nfrom apps.accounts.models import User\nd=json.load(sys.stdin)\nUser.objects.create_superuser(d['email'],d['password'],display_name='Synthetic review-fix owner',email_verified=True)",
		JSON.stringify({ email, password: fixturePassword }),
	);
	await loginOwner(page, email);
	await page.addInitScript(() => {
		localStorage.setItem("adminTheme", JSON.stringify("auto"));
	});
	for (const locale of locales) {
		await page.setViewportSize({ width: 390, height: 900 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(
			`${apiOrigin}/admin/verification/reviewcase/${item.id}/workflow/?locale=${locale}`,
		);
		const section = page.locator("section[lang]");
		await expect(section).toHaveAttribute("dir", direction(locale));
		for (const category of [
			"business",
			"representative_identity",
			"representative_authority",
		]) {
			await expect(
				page.locator(`[name=alternative_${category}]`),
			).toBeVisible();
			await expect(
				page.getByText(item.requests[category], { exact: true }),
			).toBeVisible();
		}
		await page.setViewportSize({ width: 390, height: 900 });
		await page.emulateMedia({ colorScheme: "dark" });
		await expect(page.locator("html")).toHaveClass(/dark/);
		await page.screenshot({
			path: `${evidence}/phase04-review-fix-owner-${locale}-mobile.png`,
			fullPage: true,
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	}
	await page.goto(
		`${apiOrigin}/admin/verification/reviewcase/${item.id}/workflow/?locale=fa-AF`,
	);
	await page.locator("[name=action]").selectOption("approved");
	await page
		.locator("[name=reason]")
		.fill("Synthetic owner decision separate from category reasons");
	await page
		.locator("[name=alternative_business]")
		.fill("Synthetic accepted business alternative");
	await page
		.locator("section[lang] form[method=post] button[type=submit]")
		.click();
	await expect(page.locator(".errorlist").first()).toBeVisible();
	await expect(page.locator("[name=reason]")).toHaveValue(
		"Synthetic owner decision separate from category reasons",
	);
	await expect(page.locator("[name=alternative_business]")).toHaveValue(
		"Synthetic accepted business alternative",
	);
	await page.screenshot({
		path: `${evidence}/phase04-review-fix-owner-dari-errors.png`,
		fullPage: true,
	});
	for (const category of [
		"business",
		"representative_identity",
		"representative_authority",
	]) {
		await page
			.locator(`[name=alternative_${category}]`)
			.fill(`Synthetic accepted ${category} alternative`);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto(
		`${apiOrigin}/admin/verification/reviewcase/${item.id}/workflow/?locale=fa-AF`,
	);
	await page.locator("[name=action]").selectOption("approved");
	await page
		.locator("[name=reason]")
		.fill("Synthetic owner decision separate from category reasons");
	for (const category of [
		"business",
		"representative_identity",
		"representative_authority",
	]) {
		await page
			.locator(`[name=alternative_${category}]`)
			.fill(`Synthetic accepted ${category} alternative`);
	}
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await page.screenshot({
		path: `${evidence}/phase04-review-fix-owner-dari-desktop.png`,
		fullPage: true,
	});
	await page
		.locator("section[lang] form[method=post] button[type=submit]")
		.click();
	const decision = JSON.parse(
		disposablePython(
			"import json,sys\nfrom apps.verification.models import ReviewCase\nc=ReviewCase.objects.get(pk=json.load(sys.stdin)['id'])\nprint(json.dumps(dict(status=c.status,reason=c.reason,alternatives=c.accepted_alternatives)))",
			JSON.stringify({ id: item.id }),
		),
	);
	expect(decision.status).toBe("approved");
	expect(decision.reason).toBe(
		"Synthetic owner decision separate from category reasons",
	);
	expect(decision.alternatives).toEqual(
		Object.fromEntries(
			["business", "representative_identity", "representative_authority"].map(
				(k) => [k, `Synthetic accepted ${k} alternative`],
			),
		),
	);
	await page.screenshot({
		path: `${evidence}/phase04-review-fix-owner-approved.png`,
		fullPage: true,
	});
});
