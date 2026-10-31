import { test, expect } from "@playwright/test";
import { marketFixture, marketSeller } from "./support/marketplace-runtime";
import { apiOrigin, disposablePython } from "./support/identity-runtime";
import { adminActor, adminAppearance } from "./support/admin-runtime";
import { marketplaceCopy } from "../features/marketplace/copy";
import { locales } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
import { choosePreference } from "./support/site-preferences";
test.skip(
	process.env.MARKETPLACE_BROWSER_TESTS !== "1",
	"Use the owned Phase 8 runner.",
);
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
// Each journey gets a fresh disposable throttle budget; production limits remain unchanged.
test.beforeEach(() => {
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	);
});
test("seller private edit, stale retention, submit and native independent review", async ({
	browser,
	request,
}) => {
	test.setTimeout(120000);
	const f = marketFixture(),
		{ context, page } = await marketSeller(browser),
		base = `/en/account/seller/settings/store?seller=${f.seller}`;
	await page.goto(base);
	const description = page.locator("textarea");
	await expect(description).toBeVisible();
	const image = Buffer.from(
		disposablePython(
			"import base64,io\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(80,80),'blue').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
		).trim(),
		"base64",
	);
	const uploaded = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/seller/stores/${f.seller}/uploads/`) &&
			response.request().method() === "POST",
	);
	await page
		.getByRole("group", { name: "Logo", exact: true })
		.locator('input[type="file"]')
		.setInputFiles({
			name: "synthetic-store.png",
			mimeType: "image/png",
			buffer: image,
		});
	const preview = page
		.getByRole("group", { name: "Logo", exact: true })
		.locator("img");
	await expect(preview).toBeVisible();
	const uploadResponse = await uploaded;
	expect(uploadResponse.status()).toBe(201);
	const mediaId = (await uploadResponse.json()).id;
	await expect(preview).toHaveAttribute(
		"src",
		`${apiOrigin}/api/v1/marketplace/seller/store-media/${mediaId}/`,
	);
	expect(
		(
			await request.get(
				`${apiOrigin}/api/v1/marketplace/public/store-media/${mediaId}/`,
			)
		).status(),
	).toBe(404);
	await page.getByRole("tab", { name: "English", exact: true }).click();
	await description.fill("Pending browser description");
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await expect(
		page.getByText(marketplaceCopy.en.saved, { exact: true }),
	).toBeVisible();
	const publicBefore = await request.get(
		`${apiOrigin}/api/v1/marketplace/public/en/stores/${f.seller}/`,
	);
	expect((await publicBefore.json()).description).not.toContain(
		"Pending browser",
	);
	const other = await context.newPage();
	await other.goto(base);
	await other.getByRole("tab", { name: "English", exact: true }).click();
	await other.locator("textarea").fill("Concurrent browser description");
	await other.getByRole("button", { name: "Save draft", exact: true }).click();
	await expect(
		other.getByText(marketplaceCopy.en.saved, { exact: true }),
	).toBeVisible();
	await description.fill("Retained stale input");
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await expect(
		page.getByTestId("store-settings").getByRole("alert"),
	).toHaveText(marketplaceCopy.en.stale);
	await expect(description).toHaveValue("Retained stale input");
	page.once("dialog", (dialog) => dialog.accept());
	await page
		.getByRole("button", { name: "Reload saved version", exact: true })
		.click();
	await expect(description).toHaveValue("Concurrent browser description");
	await page
		.getByRole("button", { name: "Submit for review", exact: true })
		.click();
	await expect(description).toBeDisabled();
	const revision = disposablePython(
		"from apps.marketplace.models import StoreRevision\nfrom apps.organizations.models import BusinessProfile\np=BusinessProfile.objects.get(account__user__email='phase08-seller@example.test')\nprint(StoreRevision.objects.get(store_id=p.pk,state='submitted').pk)",
	).trim();
	const staff = await adminActor(browser, "marketplace", [
		"view_store_queue",
		"read_store_submission",
		"assign_store_review",
		"review_store",
		"moderate_store",
	]);
	const review = `${apiOrigin}/admin/marketplace/storerevision/${revision}/review/`;
	await staff.page.goto(review);
	await staff.page.locator('[name="action"]').selectOption("assign");
	await staff.page.locator('[name="assigned_to"]').selectOption(staff.account);
	await staff.page
		.getByRole("button", { name: "Apply guarded action", exact: true })
		.click();
	await staff.page.locator('[name="action"]').selectOption("approve");
	await staff.page
		.locator('[name="reason"]')
		.fill("Synthetic independent browser review");
	await staff.page
		.getByRole("button", { name: "Apply guarded action", exact: true })
		.click();
	expect(
		(
			await (
				await request.get(
					`${apiOrigin}/api/v1/marketplace/public/en/stores/${f.seller}/`,
				)
			).json()
		).description,
	).toBe("Concurrent browser description");
	expect(
		(
			await request.get(
				`${apiOrigin}/api/v1/marketplace/public/store-media/${mediaId}/`,
			)
		).status(),
	).toBe(200);
	await staff.page.screenshot({
		path: `${evidence}/native-store-review.png`,
		fullPage: true,
	});
	for (const width of [1440, 390, 320])
		for (const theme of ["light", "dark"] as const) {
			await adminAppearance(staff.page, width, theme);
			expect(
				await staff.page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
			await staff.page.screenshot({
				path: `${evidence}/native-store-review-${width}-${theme}.png`,
				fullPage: true,
			});
		}
	await staff.context.close();
	await context.close();
});
for (const locale of locales)
	test(`${locale}: seller Settings responsive private preview and read-only company member`, async ({
		browser,
	}) => {
		test.setTimeout(90000);
		const f = marketFixture(),
			{ context, page } = await marketSeller(browser),
			t = marketplaceCopy[locale];
		for (const [width, theme] of [
			[1440, "light"],
			[390, "dark"],
			[320, "light"],
		] as const) {
			await page.setViewportSize({ width, height: 1000 });
			await page.goto(
				`/${locale}/account/seller/settings/store?seller=${f.seller}`,
			);
			await choosePreference(page, messages[locale].theme, theme);
			await expect(
				page.getByText(t.private, { exact: true }).first(),
			).toBeVisible();
			await expect(page.locator("textarea")).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
			await page.screenshot({
				path: `${evidence}/store-settings-${locale}-${width}-${theme}.png`,
				fullPage: true,
			});
		}
		await context.close();
		const member = await marketSeller(browser, "cataloguer");
		await member.page.goto(
			`/${locale}/account/seller/settings/store?seller=${f.company}`,
		);
		await expect(
			member.page.getByText(t.readOnly, { exact: true }),
		).toBeVisible();
		await expect(member.page.locator("textarea")).toBeDisabled();
		await member.context.close();
	});

// Real fixture writes commit before their client responses are deliberately held.
// Client cancellation/navigation never implies that the server rolled back a write.
for (const returnToA of [false, true])
	for (const operation of ["save", "upload"] as const)
		for (const outcome of ["success", "failure"] as const)
			test(`${operation} ${outcome}: pending ${returnToA ? "A → B → A" : "A → B"} request ownership`, async ({
				browser,
			}) => {
				test.setTimeout(120000);
				const f = marketFixture(),
					{ context, page } = await marketSeller(browser);
				const second = disposablePython(
					"from apps.organizations.models import BusinessProfile,Membership\nfrom apps.verification.models import ReviewCase\nfrom apps.accounts.models import Account\na=Account.objects.get(user__email='phase08-seller@example.test',context='seller')\np=BusinessProfile.objects.create(account=a,kind='company',display_name='Synthetic race company')\nMembership.objects.create(company=p,account=a,is_owner=True,active=True)\nReviewCase.objects.create(profile=p,status='approved',snapshot={'display_name':p.display_name})\nprint(p.pk)",
				).trim();
				const base = "/en/account/seller/settings/store",
					a = `${base}?seller=${f.seller}`,
					b = `${base}?seller=${second}`;
				await page.goto(a);
				await expect(page.locator("textarea")).toBeEnabled();
				const endpoint = `**/api/v1/marketplace/seller/stores/${f.seller}/${operation === "upload" ? "uploads/" : ""}`;
				let release: () => void = () => {},
					arrived: () => void = () => {};
				const held = new Promise<void>((resolve) => {
						release = resolve;
					}),
					started = new Promise<void>((resolve) => {
						arrived = resolve;
					});
				await page.route(
					endpoint,
					async (route) => {
						if (route.request().method() !== "POST") return route.continue();
						const response = outcome === "success" ? await route.fetch() : null;
						arrived();
						await held;
						if (response) await route.fulfill({ response });
						else
							await route.fulfill({
								status: 503,
								contentType: "application/json",
								body: '{"error":{"code":"unavailable"}}',
							});
					},
					{ times: 1 },
				);
				if (operation === "save") {
					await page
						.locator("textarea")
						.fill(
							`Old A pending response ${operation} ${outcome} ${returnToA}`,
						);
					await page
						.getByRole("button", { name: "Save draft", exact: true })
						.click();
				} else {
					const image = Buffer.from(
						disposablePython(
							"import io,base64\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(40,40),'blue').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
						).trim(),
						"base64",
					);
					await page
						.getByRole("group", { name: "Logo", exact: true })
						.locator("input[type=file]")
						.setInputFiles({
							name: "race.png",
							mimeType: "image/png",
							buffer: image,
						});
				}
				await started;
				await page.evaluate((url) => history.pushState(null, "", url), b);
				await expect(page.locator("textarea")).toBeEnabled();
				await page.locator("textarea").fill("B retains its independent input");
				await expect(
					page.getByRole("button", { name: "Save draft", exact: true }),
				).toBeEnabled();
				// Return with query navigation so React, rather than a full document reload,
				// must discard the old A instance. The stale A result is still outstanding.
				if (returnToA) {
					await page.evaluate((url) => history.pushState(null, "", url), a);
					await expect(page.locator("textarea")).toBeEnabled();
					await page.locator("textarea").fill("New A must retain this input");
				}
				const retained = returnToA
					? "New A must retain this input"
					: "B retains its independent input";
				const completed = page.waitForResponse(
					(response) =>
						response
							.url()
							.endsWith(
								`/seller/stores/${f.seller}/${operation === "upload" ? "uploads/" : ""}`,
							) && response.request().method() === "POST",
				);
				release();
				await completed;
				await expect(page.locator("textarea")).toHaveValue(retained);
				await expect(
					page.getByRole("button", { name: "Save draft", exact: true }),
				).toBeEnabled();
				await expect(
					page.getByTestId("store-settings").getByRole("alert"),
				).toHaveCount(0);
				// History cancellation and deliberate discard remain available.
				page.once("dialog", (dialog) => dialog.dismiss());
				await page.evaluate(() => history.back());
				await expect(page).toHaveURL(
					new RegExp(`seller=${returnToA ? f.seller : second}$`),
				);
				await expect(page.locator("textarea")).toHaveValue(retained);
				page.once("dialog", (dialog) => dialog.accept());
				await page
					.getByRole("button", { name: "Reload saved version", exact: true })
					.click();
				await expect(page.locator("textarea")).toBeEnabled();
				await page
					.locator("textarea")
					.fill(`Successful edit ${operation} ${outcome} ${returnToA}`);
				await page
					.getByRole("button", { name: "Save draft", exact: true })
					.click();
				await expect(
					page.getByText(marketplaceCopy.en.saved, { exact: true }),
				).toBeVisible();
				await context.close();
			});

for (const operation of ["save", "upload"] as const)
	test(`store ${operation} timeout retains input and permits deliberate subsequent editing`, async ({
		browser,
	}) => {
		test.setTimeout(65000);
		const f = marketFixture(),
			{ context, page } = await marketSeller(browser);
		await page.goto(`/en/account/seller/settings/store?seller=${f.seller}`);
		await expect(page.locator("textarea")).toBeEnabled();
		const wait = operation === "save" ? 11000 : 31000;
		await page.route(
			`**/api/v1/marketplace/seller/stores/${f.seller}/${operation === "upload" ? "uploads/" : ""}`,
			async (route) => {
				if (route.request().method() !== "POST") return route.continue();
				await new Promise((resolve) => setTimeout(resolve, wait));
				await route.abort("timedout").catch(() => {});
			},
			{ times: 1 },
		);
		await page.locator("textarea").fill("Timeout input is retained");
		if (operation === "save")
			await page
				.getByRole("button", { name: "Save draft", exact: true })
				.click();
		else {
			const image = Buffer.from(
				disposablePython(
					"import io,base64\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(40,40),'blue').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
				).trim(),
				"base64",
			);
			await page
				.getByRole("group", { name: "Logo", exact: true })
				.locator("input[type=file]")
				.setInputFiles({
					name: "timeout.png",
					mimeType: "image/png",
					buffer: image,
				});
		}
		await expect(
			page.getByTestId("store-settings").getByRole("alert"),
		).toBeVisible({ timeout: wait + 6000 });
		await expect(page.locator("textarea")).toHaveValue(
			"Timeout input is retained",
		);
		await expect(
			page.getByRole("button", { name: "Save draft", exact: true }),
		).toBeEnabled();
		await context.close();
	});

test("old A completion cannot unlock a newer A write", async ({ browser }) => {
	test.setTimeout(90000);
	const f = marketFixture(),
		{ context, page } = await marketSeller(browser);
	const url = `/en/account/seller/settings/store?seller=${f.seller}`;
	await page.goto(url);
	await expect(page.locator("textarea")).toBeEnabled();
	const releases: Array<() => void> = [],
		arrivals: Array<Promise<void>> = [],
		starts: Array<() => void> = [];
	for (let i = 0; i < 2; i++)
		arrivals.push(
			new Promise<void>((resolve) => {
				starts[i] = resolve;
			}),
		);
	let index = 0;
	await page.route(
		`**/api/v1/marketplace/seller/stores/${f.seller}/`,
		async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			const own = index++,
				response = await route.fetch();
			const held = new Promise<void>((resolve) => {
				releases[own] = resolve;
			});
			starts[own]();
			await held;
			await route.fulfill({ response });
		},
	);
	await page.locator("textarea").fill("Old overlapping A");
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await arrivals[0];
	await page.evaluate(() => history.pushState(null, "", "?seller="));
	await expect(page.locator("textarea")).toHaveCount(0);
	await page.evaluate((value) => history.pushState(null, "", value), url);
	await expect(page.locator("textarea")).toBeEnabled();
	await page.locator("textarea").fill("New overlapping A");
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await arrivals[1];
	let completed = page.waitForResponse(
		(r) =>
			r.url().endsWith(`/seller/stores/${f.seller}/`) &&
			r.request().method() === "POST",
	);
	releases[0]();
	await completed;
	await expect(page.locator("textarea")).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Save draft", exact: true }),
	).toBeDisabled();
	completed = page.waitForResponse(
		(r) =>
			r.url().endsWith(`/seller/stores/${f.seller}/`) &&
			r.request().method() === "POST",
	);
	releases[1]();
	await completed;
	await expect(page.locator("textarea")).toHaveValue("New overlapping A");
	await expect(page.locator("textarea")).toBeEnabled();
	await page
		.getByRole("button", { name: "Submit for review", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Withdraw submission", exact: true }),
	).toBeVisible();
	await expect(page.locator("textarea")).toBeDisabled();
	await page
		.getByRole("button", { name: "Withdraw submission", exact: true })
		.click();
	await expect(page.locator("textarea")).toBeEnabled();
	await context.close();
});
