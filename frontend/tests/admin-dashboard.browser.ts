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
    await page.evaluate(() => document.fonts.ready);
    const reference = await page.evaluate(() => {
      const title = getComputedStyle(document.querySelector("main h1")!);
      const input = getComputedStyle(document.querySelector("main input[type=email]")!);
      const card = getComputedStyle(document.querySelector("main aside")!.parentElement!);
      return { titleSize: title.fontSize, titleLine: title.lineHeight, inputRadius: input.borderRadius, inputSize: input.fontSize, cardRadius: card.borderRadius, cardShadow: card.boxShadow };
    });
    await page.goto(`${api}/admin/login/?locale=fa-AF`);
    const actual = await page.evaluate(() => {
      const title = getComputedStyle(document.querySelector("h1")!);
      const input = getComputedStyle(document.querySelector("input[type=email]")!);
      const card = getComputedStyle(document.querySelector("aside")!.parentElement!);
      return { titleSize: title.fontSize, titleLine: title.lineHeight, inputRadius: input.borderRadius, inputSize: input.fontSize, cardRadius: card.borderRadius, cardShadow: card.boxShadow };
    });
    expect(actual).toEqual(reference);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: "Owner sign-in", exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin / Owner" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin / Owner" }).click();
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
  await expect(page.locator('#nav-sidebar-apps a[href="/admin/catalogue/product/"]')).toBeVisible();
  await page.screenshot({ path: `${evidence}/admin-navigation-mobile.png`, fullPage: true });
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
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin / Owner" }).click();
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
  await page.getByRole("button", { name: "DEMO Workspace Owner Super admin / Owner" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.goto(`${api}/admin/login/`);
  await page.getByLabel("Email", { exact: true }).fill(staffEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login\//);
});
