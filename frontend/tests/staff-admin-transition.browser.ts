import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
	adminActor,
	adminLogin,
	adminAppearance,
} from "./support/admin-runtime";
import {
	catalogueOwner,
	catalogueReviewProduct,
} from "./support/catalogue-runtime";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	process.env.IDENTITY_BROWSER_TESTS !== "1",
	"Use the owned native harness.",
);
test.beforeEach(() => {
	// Each journey gets its own disposable throttle budget. Production limits stay intact.
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	);
});
async function capture(page: import("@playwright/test").Page, name: string) {
	if (evidence)
		await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
}

test("super admin provisions a staff identity and role through real forms; staff completes native MFA", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const owner = await catalogueOwner(browser),
		page = owner.page;
	const group = disposablePython(
		"from django.contrib.auth.models import Group,Permission\ng,_=Group.objects.get_or_create(name='Synthetic browser provision shortages')\ng.permissions.set(Permission.objects.filter(content_type__app_label='inventory',codename='read_shortages'))\nprint(g.pk)",
	).trim();
	await page.goto(`${apiOrigin}/admin/accounts/user/`);
	await page.getByRole("link", { name: "Add user", exact: true }).click();
	for (const width of [1440, 390])
		for (const theme of ["light", "dark"] as const) {
			await adminAppearance(page, width, theme);
			await capture(page, `staff-admin-provision-empty-${width}-${theme}`);
		}
	await adminAppearance(page, 1440, "light");
	const email = `admin-provision-${randomUUID()}@example.test`;
	await page.locator("[name=email]").fill(email);
	await page
		.locator("[name=display_name]")
		.fill("Synthetic provisioned employee");
	await page.locator("[name=password1]").fill(fixturePassword);
	await page.locator("[name=password2]").fill(fixturePassword);
	await page.locator("[name=is_staff]").check();
	await page.locator("[name=attest_staff_email]").check();
	if (await page.locator("#id_groups_from").count()) {
		await page.locator("#id_groups_from").selectOption(group);
		await page.locator("#id_groups_add").click();
	} else await page.locator("[name=groups]").selectOption(group);
	await page.locator("[name=_save]").click();
	await expect(page).toHaveURL(/\/admin\/accounts\/user\/[^/]+\/change\/$/);
	const employee = await browser.newContext(),
		staff = await employee.newPage();
	await adminLogin(staff, email);
	await expect(staff.locator("body")).toContainText("Shortages");
	await expect(staff.locator("body")).not.toContainText("Registered users");
	for (const path of [
		"/admin/accounts/user/",
		"/admin/auth/group/",
		"/admin/site-setting/general/",
		"/admin/inventory/movement/",
	]) {
		expect((await staff.goto(`${apiOrigin}${path}`))?.status()).toBe(403);
	}
	await staff.goto(`${apiOrigin}/admin/`);
	await capture(staff, "staff-admin-provisioned-workspace");
	await employee.close();
	await owner.context.close();
});

test("all former frontend and staff REST routes are HTTP 404 for anonymous, buyer, seller, staff and owner", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const ordinary = await adminActor(browser, "inventory", ["read_shortages"]);
	const owner = await catalogueOwner(browser);
	const anonymous = await browser.newContext();
	const seller = await browser.newContext(),
		buyer = await browser.newContext();
	const sellerPage = await seller.newPage();
	await sellerPage.goto("/en/auth/seller-sign-in");
	await sellerPage.locator("[name=email]").fill("phase03-seller@example.test");
	await sellerPage.locator("[name=password]").fill(fixturePassword);
	await sellerPage
		.getByRole("button", { name: "Sign in", exact: true })
		.click();
	await expect(sellerPage).toHaveURL(/account\/seller/);
	const buyerPage = await buyer.newPage();
	await buyerPage.goto("/en/auth/buyer-sign-in");
	await buyerPage.locator("[name=email]").fill("phase03-buyer@example.test");
	await buyerPage.locator("[name=password]").fill(fixturePassword);
	await buyerPage.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(buyerPage).toHaveURL(/account\/buyer/);
	const id = "00000000-0000-4000-8000-000000000001";
	for (const context of [
		anonymous,
		buyer,
		seller,
		ordinary.context,
		owner.context,
	]) {
		for (const locale of ["fa-AF", "ps", "ar", "en"]) {
			for (const path of [
				`/${locale}/account/staff`,
				`/${locale}/account/staff/profile`,
				`/${locale}/account/staff/verification/${id}`,
				`/${locale}/account/staff/catalogue/${id}`,
				`/${locale}/account/staff/inventory/shortages/${id}`,
				`/${locale}/auth/staff-sign-in`,
				`/${locale}/auth/mfa`,
				`/${locale}?auth=staff-sign-in`,
				`/${locale}?context=staff&auth=buyer-sign-in`,
			]) {
				const response = await context.request.get(path);
				expect(response.status(), path).toBe(404);
				expect(response.headers()["cache-control"]).toContain("no-store");
			}
		}
		for (const path of [
			`auth/staff/signin/`,
			`auth/owner/signin/`,
			`auth/staff/session/`,
			`auth/mfa/enroll/`,
			`auth/mfa/challenge/`,
			`verification/queue/`,
			`verification/cases/${id}/`,
			`verification/transfers/`,
			`verification/transfers/${id}/`,
			`verification/evidence/staff/${id}/`,
			`catalogue/staff/products/`,
			`catalogue/owner/products/`,
			`inventory/staff/shortages/`,
			`organizations/staff/profiles/`,
		]) {
			expect(
				(await context.request.get(`${apiOrigin}/api/v1/${path}`)).status(),
				path,
			).toBe(404);
		}
	}
	for (const context of [
		anonymous,
		buyer,
		seller,
		ordinary.context,
		owner.context,
	])
		await context.close();
});

test("staff least privilege, direct native URLs and next-action revocation", async ({
	browser,
}) => {
	// Eight independently enrolled roles exercise every direct resource URL.
	test.setTimeout(240000);
	const roleMatrix: [string, string[], string[]][] = [
		[
			"verification",
			["view_queue", "read_evidence", "decide_review"],
			["verification/reviewcase", "verification/evidence"],
		],
		["verification", ["review_transfer"], ["organizations/ownershiptransfer"]],
		["catalogue", ["review_source"], ["catalogue/product"]],
		["catalogue", ["review_translation"], ["catalogue/product"]],
		[
			"catalogue",
			["manage_taxonomy"],
			["catalogue/category", "catalogue/saleunit"],
		],
		["inventory", ["read_shortages"], ["inventory/shortage"]],
		["inventory", ["view_movement"], ["inventory/movement"]],
		["accounts", [], []],
	];
	for (const [app, codes, allowed] of roleMatrix) {
		const actor = await adminActor(browser, app, codes);
		for (const path of [
			"verification/reviewcase",
			"organizations/ownershiptransfer",
			"catalogue/product",
			"catalogue/category",
			"inventory/shortage",
			"inventory/movement",
			"accounts/user",
			"auth/group",
		]) {
			expect(
				(await actor.page.goto(`${apiOrigin}/admin/${path}/`))?.status(),
				`${codes}:${path}`,
			).toBe(allowed.includes(path) ? 200 : 403);
		}
		disposablePython(
			"import json,sys\nfrom django.contrib.auth.models import Group\nGroup.objects.get(pk=json.load(sys.stdin)['id']).permissions.clear()",
			JSON.stringify({ id: actor.group }),
		);
		for (const path of allowed)
			expect(
				(await actor.page.goto(`${apiOrigin}/admin/${path}/`))?.status(),
			).toBe(403);
		await actor.context.close();
	}
});

test("native shortage queue and exact detail preserve approved admin styling on desktop and phone light and dark", async ({
	browser,
}) => {
	test.setTimeout(90000);
	test.skip(
		process.env.INVENTORY_BROWSER_TESTS !== "1",
		"Inventory fixtures require Phase 7.",
	);
	const actor = await adminActor(browser, "inventory", ["read_shortages"]);
	const id = disposablePython(
		"from apps.inventory.models import Shortage\nprint(Shortage.objects.get(operation__reference='synthetic-shortage').pk)",
	).trim();
	for (const width of [1440, 390])
		for (const theme of ["light", "dark"]) {
			await actor.page.goto(`${apiOrigin}/admin/`);
			await adminAppearance(actor.page, width, theme as "light" | "dark");

			await actor.page.goto(`${apiOrigin}/admin/inventory/shortage/`);
			await expect(actor.page.locator("body")).toContainText("Shortages");
			await capture(actor.page, `staff-shortage-list-${width}-${theme}`);
			await actor.page.goto(
				`${apiOrigin}/admin/inventory/shortage/${id}/change/`,
			);
			await expect(actor.page.locator("body")).toContainText("999.000");
			await expect(actor.page.locator("body")).toContainText("Requested");
			await expect(actor.page.locator("body")).toContainText("Available");
			await expect(actor.page.locator("[name=_save]")).toHaveCount(0);
			await capture(actor.page, `staff-shortage-detail-${width}-${theme}`);
		}
	await actor.context.close();
});

test("native source and translation forms keep permissions, source identity, job status and stale human edits", async ({
	browser,
}) => {
	test.setTimeout(90000);
	test.skip(
		process.env.CATALOGUE_BROWSER_TESTS !== "1",
		"Catalogue fixtures require Phase 6 or 7.",
	);
	const item = catalogueReviewProduct();
	const actor = await adminActor(browser, "catalogue", ["review_translation"]);
	const path = `${apiOrigin}/admin/catalogue/product/${item.id}/workflow/?translation=1&revision=${item.revision}&target=en`;
	await actor.page.goto(path);
	await expect(
		actor.page.getByText("Automatic draft provider enabled", { exact: true }),
	).toBeVisible();
	await expect(actor.page.locator("#translation-identity")).toContainText(
		item.revision,
	);
	await actor.page.locator("#id_title").fill("Synthetic native English");
	await actor.page
		.locator("#id_description")
		.fill("Synthetic native translated description");
	await actor.page
		.locator("#id_image_alts")
		.fill(JSON.stringify({ [item.image]: "Synthetic native image" }));
	await actor.page.locator("#id_action").selectOption("save");
	await actor.page.locator("#catalogue-operation button").click();
	await expect(actor.page.locator("#id_title")).toHaveValue(
		"Synthetic native English",
	);
	await actor.page.locator("#id_action").selectOption("approve");
	await actor.page.locator("#catalogue-operation button").click();
	await expect(actor.page.locator("#translation-identity")).toContainText(
		"approved",
	);
	await capture(actor.page, "staff-native-translation");
	expect(
		(
			await actor.page.goto(
				`${apiOrigin}/admin/catalogue/category/food/workflow/`,
			)
		)?.status(),
	).toBe(403);
	await actor.context.close();
});
