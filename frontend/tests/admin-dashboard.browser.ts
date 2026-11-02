import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { apiOrigin as api, disposablePython, fixturePassword as password } from "./support/identity-runtime";

test.skip(process.env.ADMIN_DASHBOARD_BROWSER_TESTS !== "1", "Requires the guarded native admin verification run.");
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
function ownerFixture() {
  const email = `admin-design-${randomBytes(6).toString("hex")}@example.test`;
  disposablePython("import sys,json\nfrom apps.accounts.models import User\ndata=json.load(sys.stdin)\nUser.objects.create_superuser(data['email'],data['password'],display_name='DEMO Workspace Owner',email_verified=True)", JSON.stringify({ email, password }));
  return email;
}
function otp(email: string) {
  return disposablePython("import sys,json,time\nfrom apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\ndata=json.load(sys.stdin)\nd=Authenticator.objects.get(user__email=data['email']);t=TOTP(d.secret);t.time=time.time();print(f'{t.token():06}')", JSON.stringify({ email })).trim();
}
async function enrollOwner(page: Page) {
  const email = ownerFixture();
  await page.goto(`${api}/admin/login/`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Set up authenticator", exact: true }).click();
  await page.getByLabel("Authenticator or recovery code").fill(otp(email));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  const recovery = await page.locator(".private code").first().textContent();
  await page.getByRole("link", { name: "I saved my codes — continue to administration" }).click();
  await expect(page.getByTestId("owner-dashboard")).toBeVisible();
  return { email, recovery };
}
async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("English login desktop, mobile, dark and validation", async ({ page }) => {
  for (const [width, scheme] of [[1440,"light"],[1440,"dark"],[390,"light"],[390,"dark"]] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/en/auth/buyer-sign-in");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const reference = await page.evaluate(() => {
      const titleElement=document.querySelector("dialog h1"),inputElement=document.querySelector("dialog input[type=email]"),cardElement=document.querySelector("dialog aside")?.parentElement;
      if (!titleElement || !inputElement || !cardElement) throw new Error("Public modal comparison elements missing");
      const title=getComputedStyle(titleElement),input=getComputedStyle(inputElement),card=getComputedStyle(cardElement);
      return { titleSize: title.fontSize, titleLine: title.lineHeight, inputRadius: input.borderRadius, inputSize: input.fontSize, cardRadius: card.borderRadius, cardShadow: card.boxShadow };
    });
    await page.goto(`${api}/admin/login/?locale=fa-AF`);
    const actual = await page.evaluate(() => {
      const titleElement=document.querySelector("h1"),inputElement=document.querySelector("input[type=email]"),cardElement=document.querySelector("aside")?.parentElement;
      if (!titleElement || !inputElement || !cardElement) throw new Error("Owner comparison elements missing");
      const title=getComputedStyle(titleElement),input=getComputedStyle(inputElement),card=getComputedStyle(cardElement);
      return { titleSize: title.fontSize, titleLine: title.lineHeight, inputRadius: input.borderRadius, inputSize: input.fontSize, cardRadius: card.borderRadius, cardShadow: card.boxShadow };
    });
    expect(actual).toEqual(reference);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: "Admin sign-in", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "English", exact: true })).toHaveCount(0);
    expect(await page.locator("[name=email]").evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(width === 390 ? 44 : 40);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/admin-login-${width}-${scheme}.png`, fullPage: true });
  }
  await page.getByLabel("Email", { exact: true }).fill("missing-owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Invalid-test-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-describedby", "owner-error");
  await page.getByLabel("Email", { exact: true }).fill("");
  await page.getByLabel("Password", { exact: true }).fill("");
  await page.screenshot({ path: `${evidence}/admin-login-error.png`, fullPage: true });
  await page.getByLabel("Email", { exact: true }).focus();
  expect(await page.getByLabel("Email", { exact: true }).evaluate(e => getComputedStyle(e).outlineStyle)).toBe("solid");
});

test("Owner MFA dashboard data, navigation, theme and model lists", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.emulateMedia({ colorScheme: "light" });
  await enrollOwner(page);
  await expect(page.getByTestId("dashboard-metric")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Marketplace activity" })).toBeVisible();
  const expected = JSON.parse(disposablePython("import json\nfrom apps.accounts.models import User\nfrom apps.catalogue.models import Product\nprint(json.dumps({'users':User.objects.count(),'products':Product.objects.count()}))"));
  await expect(page.getByTestId("metric-value").nth(0)).toHaveText(String(expected.users));
  await expect(page.getByTestId("metric-value").nth(2)).toHaveText(String(expected.products));
  await page.getByText("View chart data", { exact: true }).click();
  await expect(page.locator("details table tbody tr")).toHaveCount(14);
  await page.getByText("View chart data", { exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: `${evidence}/admin-dashboard-desktop-light.png`, fullPage: true });
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin" }).click();
  await page.screenshot({ path: `${evidence}/admin-dashboard-desktop-dark.png`, fullPage: true });
  for (const path of ["accounts/account", "catalogue/product", "verification/reviewcase", "organizations/businessprofile", "site/sitesettings", "accounts/auditevent"]) {
    const response = await page.goto(`${api}/admin/${path}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible();
  }
  await page.screenshot({ path: `${evidence}/admin-model-list-dark.png`, fullPage: true });
  await page.goto(`${api}/admin/accounts/account/add/`);
  await expect(page.getByRole("heading", { name: /Add account/i })).toBeVisible();
  await page.screenshot({ path: `${evidence}/admin-staff-form-dark.png`, fullPage: true });
});

test("Phone navigation, keyboard, dashboard and model containment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await enrollOwner(page);
  await noOverflow(page);
  await page.screenshot({ path: `${evidence}/admin-dashboard-mobile-light.png`, fullPage: true });
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await page.locator('#nav-sidebar-apps').getByRole('button', { name: 'Catalogue', exact: true }).click();
  await expect(page.locator('#nav-sidebar-apps a[href="/admin/catalogue/product/"]')).toBeVisible();
  await expect(page.locator('#nav-sidebar-inner')).toBeInViewport({ ratio: 0.5 });
  // Full-page capture resizes the viewport and closes the responsive drawer.
  await page.screenshot({ path: `${evidence}/admin-navigation-mobile.png`, fullPage: false });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(toggle).toBeFocused();
  for (const path of ["accounts/account", "catalogue/product", "accounts/account/add"]) {
    await page.goto(`${api}/admin/${path}/`);
    await noOverflow(page);
  }
  await page.screenshot({ path: `${evidence}/admin-staff-form-mobile.png`, fullPage: true });
});

test("Owner recovery code, logout and staff admin denial", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { email, recovery } = await enrollOwner(page);
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.goto(`${api}/admin/`);
  await expect(page).toHaveURL(/\/admin\/login\//);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Use a recovery code").check();
  await page.getByLabel("Authenticator or recovery code").fill(recovery ?? "");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(`${api}/admin/`);
  const staffEmail = `admin-denied-${randomBytes(6).toString("hex")}@example.test`;
  disposablePython("import sys,json\nfrom apps.accounts.models import User,Account\ndata=json.load(sys.stdin)\nu=User.objects.create_user(data['email'],data['password'],email_verified=True,display_name='DEMO Staff')\nAccount.objects.create(user=u,context='staff')", JSON.stringify({ email:staffEmail, password }));
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.goto(`${api}/admin/login/`);
  await page.getByLabel("Email", { exact: true }).fill(staffEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login\//);
});

function verificationFixture(draft = false, alternatives = false) {
  const name = `DEMO owner review ${randomBytes(5).toString("hex")}`;
  return JSON.parse(disposablePython(
    "import sys,json\nfrom apps.accounts.models import User,Account\nfrom apps.organizations.profiles import create_profile,current_case\nfrom apps.organizations.management.commands.seed_organization_examples import FixtureActor\nfrom apps.verification.services import application_action,upload_evidence\nfrom tests.test_organizations import image_file\nd=json.load(sys.stdin)\nu=User.objects.create_user(d['name'].replace(' ','-')+'@example.test',d['password'],display_name=d['name'],email_verified=True)\na=FixtureActor(Account.objects.create(user=u,context='seller'))\np=create_profile(a,dict(kind='individual',display_name=d['name'],legal_name='DEMO legal name',business_type='DEMO trade',contact_phone='000000',location='DEMO Kabul',representative=''))\nc=current_case(p)\nif not d['alternatives']:\n upload_evidence(a,p.pk,image_file(),'identity',c.version)\n c=current_case(p)\nif not d['draft']:\n c=application_action(a,p.pk,dict(version=c.version,action='submit',alternative_requests={'identity':'DEMO request for alternative evidence'} if d['alternatives'] else {}))\nprint(json.dumps(dict(id=str(c.pk),name=p.display_name,version=c.version)))",
    JSON.stringify({ name, password, draft, alternatives }),
  )) as { id: string; name: string; version: number };
}

test("Owner reviews unassigned seller directly with documents and existing admin styling", async ({ page }) => {
  const { email } = await enrollOwner(page);
  expect(disposablePython("import json,sys\nfrom apps.accounts.models import Account\nprint(Account.objects.filter(user__email=json.load(sys.stdin)['email'],context='staff').count())", JSON.stringify({ email })).trim()).toBe("0");
  const item = verificationFixture();
  await page.goto(`${api}/admin/verification/reviewcase/`);
  await page.getByRole("link", { name: item.name, exact: true }).click();
  await expect(page.getByTestId("owner-verification-review")).toBeVisible();
  await expect(page.getByTestId("review-status")).toHaveText("submitted");
  await expect(page.getByRole("heading", { name: "Submitted applicant details" })).toBeVisible();
  await expect(page.getByText("DEMO legal name", { exact: true })).toBeVisible();
  await expect(page.getByText("You have full super admin review access.", { exact: false })).toBeVisible();
  const file = page.getByRole("link", { name: /Download Identity evidence 1/ });
  const href = await file.getAttribute("href");
  expect(href).toBeTruthy();
  const download = await page.request.get(`${api}${href}`);
  expect(download.status()).toBe(200);
  expect(download.headers()["cache-control"]).toContain("no-store");
  for (const [width, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await expect(page.getByLabel("Action", { exact: true })).toHaveValue("");
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/owner-verification-${width}-${scheme}.png`, fullPage: true });
  }
  await page.getByLabel("Action", { exact: true }).selectOption("approved");
  await page.getByLabel("Decision reason", { exact: true }).fill("DEMO documents checked by owner without staff");
  await page.getByRole("button", { name: "Save review decision", exact: true }).click();
  await expect(page.getByTestId("review-status")).toHaveText("approved");
  await expect(page.getByRole("button", { name: "Save review decision", exact: true })).toHaveCount(0);
  const outcome = JSON.parse(disposablePython("import sys,json\nfrom apps.verification.models import ReviewCase\nfrom apps.accounts.models import AuditEvent\nc=ReviewCase.objects.get(pk=json.load(sys.stdin)['id'])\nprint(json.dumps(dict(status=c.status,assigned=c.assigned_to_id,audited=AuditEvent.objects.filter(resource_id=c.pk,context='owner',action='verification_approved').exists())))", JSON.stringify({ id: item.id })));
  expect(outcome).toEqual({ status: "approved", assigned: null, audited: true });
  await page.screenshot({ path: `${evidence}/owner-verification-approved.png`, fullPage: true });
});

test("Owner review draft, alternative errors and stale decision preserve the record", async ({ page }) => {
  await enrollOwner(page);
  const draft = verificationFixture(true);
  await page.goto(`${api}/admin/verification/reviewcase/${draft.id}/workflow/`);
  await expect(page.getByRole("status")).toContainText("seller has not submitted");
  await expect(page.getByRole("button", { name: "Save review decision", exact: true })).toHaveCount(0);
  const item = verificationFixture(false, true);
  await page.goto(`${api}/admin/verification/reviewcase/${item.id}/workflow/`);
  await page.getByLabel("Action", { exact: true }).selectOption("approved");
  await page.getByLabel("Decision reason", { exact: true }).fill("DEMO preserved decision reason");
  await page.getByRole("button", { name: "Save review decision", exact: true }).click();
  await expect(page.getByText("Decision not saved. Check the details below.")).toBeVisible();
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue("DEMO preserved decision reason");
  await expect(page.getByText("Provide evidence or an explicit accepted-alternative reason for this category.", { exact: true })).toBeVisible();
  await page.getByLabel("Accepted alternative — Identity evidence", { exact: true }).fill("DEMO independently reviewed alternative");
  disposablePython("import sys,json\nfrom apps.verification.models import ReviewCase\nfrom django.db.models import F\nReviewCase.objects.filter(pk=json.load(sys.stdin)['id']).update(version=F('version')+1)", JSON.stringify({ id: item.id }));
  await page.getByRole("button", { name: "Save review decision", exact: true }).click();
  await expect(page.getByText("This record changed. Refresh and review it again.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("review-status")).toHaveText("submitted");
  await expect(page.getByLabel("Accepted alternative — Identity evidence", { exact: true })).toHaveValue("DEMO independently reviewed alternative");
  await page.screenshot({ path: `${evidence}/owner-verification-stale.png`, fullPage: true });
  await page.getByRole("link", { name: "Reload current case", exact: true }).click();
  await expect(page.getByLabel("Action", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Decision reason", { exact: true })).toHaveValue("");
  await page.getByLabel("Action", { exact: true }).selectOption("needs_information");
  await page.getByLabel("Decision reason", { exact: true }).fill("DEMO request for clearer supporting information");
  await page.getByRole("button", { name: "Save review decision", exact: true }).click();
  await expect(page.getByTestId("review-status")).toHaveText("needs_information");
});
