import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { staff, api, actors } from "./support/content-runtime";
import { disposablePython } from "./support/identity-runtime";
import { contentCopy } from "../lib/i18n/content";
import { contentEditorCopy } from "../lib/i18n/content-editor";
import { authCopy } from "../lib/i18n/auth";
import { messages } from "../lib/i18n/messages";
import { locales } from "../lib/i18n/locales";
import type { EditorItem } from "../features/content/types";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	process.env.CONTENT_BROWSER_TESTS !== "1",
	"Use automatic disposable Phase 5 tooling.",
);
const button = (page: Page, name: string) =>
	page.getByRole("button", { name, exact: true });
async function article(page: Page) {
	const key = `review-regression-${randomBytes(5).toString("hex")}`;
	let op = await api(page, "editor/staff/items/", { key, kind: "article" });
	expect(op.status).toBe(201);
	op = await api(page, `editor/staff/items/${key}/`, {
		version: op.body.version,
		locale: "fa-AF",
		payload: {
			title: "ORIGINAL SAVED TITLE",
			blocks: [
				{
					id: "review-section",
					type: "text",
					title: "ORIGINAL SAVED SECTION",
					links: [{ label: "Guide", target: "/help" }],
				},
			],
		},
	});
	expect(op.status).toBe(200);
	op = await api(page, `editor/staff/items/${key}/actions/`, {
		version: op.body.version,
		revision: op.body.revision,
		action: "submit",
		reason: "Synthetic submitted review fixture",
	});
	expect(op.status).toBe(200);
	return key;
}
for (const locale of locales)
	test(`${locale}: public buyer and seller CTAs reach actual localized registration forms`, async ({
		page,
	}) => {
		for (const [path, context] of [
			["wholesale", "buyer"],
			["sell", "seller"],
			["how-it-works", "buyer"],
			["how-it-works", "seller"],
		] as const) {
			await page.goto(`/${locale}/${path}`);
			await page
				.locator(
					`main article a[href="/${locale}/auth/${context}-registration"]`,
				)
				.click();
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				authCopy[locale][
					context === "buyer" ? "buyerRegister" : "sellerRegister"
				],
			);
			for (const name of ["display_name", "email", "password", "consent"])
				await expect(page.locator(`[name=${name}]`)).toBeVisible();
			await expect(page).toHaveURL(
				new RegExp(`/${locale}/auth/${context}-registration$`),
			);
		}
	});
test("dirty submitted preview cannot publish old content; discard choices and exact saved preview/save/submit/publish", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const context = await staff(browser),
		page = await context.newPage();
	await page.goto("/en/account/staff/content");
	const key = await article(page);
	await page.goto(`/en/account/staff/content/${key}`);
	await expect(page.locator("[name=title]")).toHaveValue(
		"ORIGINAL SAVED TITLE",
	);
	await page.locator("[name=title]").fill("UNSAVED PREVIEW TITLE");
	await page
		.getByLabel("Title 1", { exact: true })
		.fill("UNSAVED PREVIEW SECTION");
	await button(page, contentCopy.en.preview).click();
	await expect(page.getByTestId("content-preview")).toContainText(
		"UNSAVED PREVIEW SECTION",
	);
	await expect(page.getByTestId("content-preview")).toContainText(
		contentEditorCopy.en.working,
	);
	await page
		.getByLabel("Reason", { exact: true })
		.fill("Publish reviewed revision");
	await expect(button(page, contentCopy.en.publish)).toBeDisabled();
	expect((await api(page, `public/en/pages/${key}/`)).status).toBe(404);
	await button(page, contentEditorCopy.en.savedPreview).click();
	await expect(page.getByTestId("saved-content-preview")).toContainText(
		"ORIGINAL SAVED SECTION",
	);
	await expect(page.getByTestId("saved-content-preview")).not.toContainText(
		"UNSAVED PREVIEW SECTION",
	);
	await button(page, contentCopy.en.reload).click();
	const dialog = page.getByRole("alertdialog");
	await expect(
		dialog.getByRole("button", {
			name: contentEditorCopy.en.keep,
			exact: true,
		}),
	).toBeFocused();
	await dialog
		.getByRole("button", { name: contentEditorCopy.en.keep, exact: true })
		.click();
	await expect(page.locator("[name=title]")).toHaveValue(
		"UNSAVED PREVIEW TITLE",
	);
	await button(page, contentEditorCopy.en.discard).click();
	await dialog
		.getByRole("button", { name: contentEditorCopy.en.discard, exact: true })
		.click();
	await expect(page.locator("[name=title]")).toHaveValue(
		"ORIGINAL SAVED TITLE",
	);
	await page.locator("[name=title]").fill("REVIEWED NEW TITLE");
	await page
		.getByLabel("Title 1", { exact: true })
		.fill("REVIEWED NEW SECTION");
	await button(page, contentCopy.en.save).click();
	await expect(page.getByRole("status")).toHaveText(contentCopy.en.saved);
	await expect(button(page, contentCopy.en.publish)).toHaveCount(0);
	await expect(page.getByTestId("content-dirty")).toHaveCount(0);
	await page
		.getByLabel("Reason", { exact: true })
		.fill("Submit explicit new draft");
	await button(page, contentCopy.en.submit).click();
	await expect(page.getByRole("status")).toHaveText(contentCopy.en.saved);
	await button(page, contentEditorCopy.en.savedPreview).click();
	await expect(page.getByTestId("saved-content-preview")).toContainText(
		"REVIEWED NEW SECTION",
	);
	const detail = (await api(page, `editor/staff/items/${key}/`))
		.body as EditorItem;
	await expect(page.getByTestId("saved-content-preview")).toContainText(
		detail.revisions[0].id,
	);
	await page
		.getByLabel("Reason", { exact: true })
		.fill("Publish exact saved revision");
	await button(page, contentCopy.en.publish).click();
	await expect(page.getByRole("status")).toHaveText(contentCopy.en.saved);
	const published = await api(page, `public/en/pages/${key}/`);
	expect(published.body.revision).toBe(detail.revisions[0].id);
	expect(published.body.payload.title).toBe("REVIEWED NEW TITLE");
	await page.goto(`/en/help/${key}`);
	await expect(page.locator("h1")).toHaveText("REVIEWED NEW TITLE");
	await expect(page.locator("main article")).toContainText(
		"REVIEWED NEW SECTION",
	);
	await context.close();
});
for (const locale of locales)
	test(`${locale}: localized server validation identifies fields, retains input and focuses summary`, async ({
		browser,
	}) => {
		test.setTimeout(60000);
		const context = await staff(browser),
			page = await context.newPage();
		await page.goto(`/${locale}/account/staff/content`);
		const key = await article(page);
		await page.goto(`/${locale}/account/staff/content/${key}`);
		const width = locale === "en" ? 1440 : 390;
		await page.setViewportSize({ width, height: 900 });
		await page
			.getByRole("combobox", { name: messages[locale].theme, exact: true })
			.selectOption(locale === "fa-AF" || locale === "ar" ? "dark" : "light");
		await page.locator("[name=title]").fill("<invalid-markup>");
		await button(page, contentCopy[locale].save).click();
		const summary = page.locator("main [role=alert]");
		await expect(summary).toContainText(contentEditorCopy[locale].plainText);
		await expect(summary).toBeFocused();
		const title = page.locator("[name=title]");
		await expect(title).toHaveValue("<invalid-markup>");
		await expect(page.getByTestId("content-dirty")).toBeVisible();
		await expect(button(page, contentCopy[locale].publish)).toBeDisabled();
		await expect(title).toHaveAttribute("aria-invalid", "true");
		await expect(title).toHaveAttribute(
			"aria-describedby",
			"content-field-payload-title-error",
		);
		await page.keyboard.press("Tab");
		await expect(summary.getByRole("button")).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(title).toBeFocused();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: `${evidence}/review-validation-${locale}-${width}.png`,
			fullPage: true,
		});
		if (locale === "fa-AF")
			await page.screenshot({
				path: `${evidence}/review-validation-fa-AF-390-viewport.png`,
			});
		if (locale === "fa-AF") {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.screenshot({
				path: `${evidence}/review-validation-fa-AF-1440.png`,
				fullPage: true,
			});
		}
		await title.fill("Corrected retained title");
		await expect(summary).toHaveCount(0);
		await expect(title).toHaveAttribute("aria-invalid", "false");
		await button(page, contentCopy[locale].save).click();
		await expect(page.getByRole("status")).toHaveText(
			contentCopy[locale].saved,
		);
		await context.close();
	});
test("bad target, list bound, source structure and stale-version errors retain structured input", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const context = await staff(browser),
		page = await context.newPage();
	await page.goto("/en/account/staff/content");
	const key = await article(page);
	await page.goto(`/en/account/staff/content/${key}`);
	const target = page.locator("#content-field-payload-blocks-0-links-0-target");
	await target.fill("/auth/buyer-register");
	await button(page, contentCopy.en.save).click();
	await expect(page.locator("main [role=alert]")).toContainText(
		contentEditorCopy.en.target,
	);
	await expect(target).toHaveAttribute("aria-invalid", "true");
	await expect(target).toHaveValue("/auth/buyer-register");
	await target.fill("/auth/buyer-registration");
	const items = page.locator("#content-field-payload-blocks-0-items");
	await items.fill(
		Array.from({ length: 13 }, (_, i) => `Unique item ${i}`).join("\n"),
	);
	await button(page, contentCopy.en.save).click();
	await expect(page.locator("main [role=alert]")).toContainText(
		contentEditorCopy.en.limit,
	);
	await expect(items).toHaveAttribute("aria-invalid", "true");
	await expect(items).toHaveValue(
		Array.from({ length: 13 }, (_, i) => `Unique item ${i}`).join("\n"),
	);
	await items.fill("");
	await button(page, contentCopy.en.save).click();
	await expect(page.getByRole("status")).toHaveText(contentCopy.en.saved);
	const original = (await api(page, `editor/staff/items/${key}/`))
		.body as EditorItem;
	await page.locator("#content-field-locale").selectOption("en");
	await expect(page.getByTestId("content-dirty")).toBeVisible();
	await button(page, contentEditorCopy.en.discard).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: contentEditorCopy.en.discard, exact: true })
		.click();
	await expect(page.locator("#content-field-locale")).toHaveValue("fa-AF");
	await expect(page.locator("[name=title]")).toHaveValue(
		original.revisions[0].payload.title,
	);
	await page.locator("#content-field-locale").selectOption("en");
	await page
		.getByLabel("Title 1", { exact: true })
		.fill("Retained translated section");
	await page.getByLabel(contentCopy.en.enabled, { exact: true }).uncheck();
	await button(page, contentCopy.en.save).click();
	await expect(page.locator("main [role=alert]")).toContainText(
		contentEditorCopy.en.source,
	);
	await expect(page.locator("#content-field-source")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(page.getByLabel("Title 1", { exact: true })).toHaveValue(
		"Retained translated section",
	);
	await page.getByLabel(contentCopy.en.enabled, { exact: true }).check();
	await button(page, contentCopy.en.save).click();
	await expect(page.getByRole("status")).toHaveText(contentCopy.en.saved);
	// A second source choice is dirty, and switching away requires an explicit choice.
	await page
		.getByRole("combobox", { name: contentCopy.en.source, exact: true })
		.selectOption(original.revisions[1].id);
	await expect(page.getByTestId("content-dirty")).toBeVisible();
	await button(page, contentCopy.en.reload).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: contentEditorCopy.en.keep, exact: true })
		.click();
	await expect(page.locator("#content-field-source")).toHaveValue(
		original.revisions[1].id,
	);
	await button(page, contentEditorCopy.en.discard).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: contentEditorCopy.en.discard, exact: true })
		.click();
	await page.locator("[name=title]").fill("Retained stale title");
	const current = (await api(page, `editor/staff/items/${key}/`))
		.body as EditorItem;
	const source = current.revisions.find((r) => r.locale === "fa-AF");
	expect(source).toBeTruthy();
	expect(
		(
			await api(page, `editor/staff/items/${key}/`, {
				version: current.version,
				locale: "fa-AF",
				payload: source?.payload,
			})
		).status,
	).toBe(200);
	await button(page, contentCopy.en.save).click();
	await expect(page.locator("main [role=alert]")).toHaveText(
		contentCopy.en.conflict,
	);
	await expect(page.locator("[name=title]")).toHaveValue(
		"Retained stale title",
	);
	const pattern = `**/api/v1/content/editor/staff/items/${key}/`;
	await page.route(pattern, (route) => route.abort("connectionrefused"));
	await button(page, contentCopy.en.save).click();
	await expect(page.locator("main [role=alert]")).toHaveText(
		contentEditorCopy.en.dependency,
	);
	await expect(page.locator("[name=title]")).toHaveValue(
		"Retained stale title",
	);
	await page.unroute(pattern);
	await context.close();
});
test("navigation and support working buffers are dirty and cancel/discard preserves their values", async ({
	browser,
}) => {
	test.setTimeout(90000); // Includes real privileged fixture enrollment; per-assertion waits remain unchanged.
	const context = await staff(browser),
		page = await context.newPage();
	for (const [key, selector, newValue] of [
		[
			"support",
			"#content-field-payload-support-email",
			"retained@example.test",
		],
		[
			"navigation",
			"#content-field-payload-navigation-0-links-0-target",
			"/auth/buyer-registration",
		],
	]) {
		await page.goto(`/en/account/staff/content/${key}`);
		const field = page.locator(selector),
			before = await field.inputValue();
		await field.fill(newValue);
		await expect(page.getByTestId("content-dirty")).toBeVisible();
		await page
			.getByRole("combobox", { name: contentCopy.en.revision, exact: true })
			.selectOption({ index: 2 });
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: contentEditorCopy.en.keep, exact: true })
			.click();
		await expect(field).toHaveValue(newValue);
		await button(page, contentEditorCopy.en.discard).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: contentEditorCopy.en.discard, exact: true })
			.click();
		await expect(field).toHaveValue(before);
		await expect(page.getByTestId("content-dirty")).toHaveCount(0);
		if (key === "navigation") {
			await page
				.getByRole("group", { name: contentCopy.en.links, exact: true })
				.first()
				.getByRole("button", { name: "Move down 1", exact: true })
				.click();
			await expect(page.getByTestId("content-dirty")).toBeVisible();
			await button(page, contentEditorCopy.en.discard).click();
			await page
				.getByRole("alertdialog")
				.getByRole("button", {
					name: contentEditorCopy.en.discard,
					exact: true,
				})
				.click();
			await expect(field).toHaveValue(before);
		}
	}
	await context.close();
});
test("read-only publisher previews exact saved revision and fresh revocation denies preview and mutation", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const pc = await staff(browser),
		publisher = await pc.newPage();
	await publisher.goto("/en/account/staff/content");
	const key = await article(publisher);
	const rc = await staff(browser, "reviewer"),
		page = await rc.newPage();
	await page.goto(`/en/account/staff/content/${key}`);
	await expect(
		page.getByText(contentCopy.en.readOnly, { exact: true }),
	).toBeVisible();
	await expect(button(page, contentCopy.en.save)).toBeDisabled();
	await expect(page.locator("[name=title]")).toBeDisabled();
	await button(page, contentEditorCopy.en.savedPreview).click();
	await expect(page.getByTestId("saved-content-preview")).toContainText(
		"ORIGINAL SAVED SECTION",
	);
	await page
		.getByLabel(contentCopy.en.reason, { exact: true })
		.fill("Read-only publisher reviewed exact saved revision");
	await button(page, contentCopy.en.publish).click();
	await expect(page.getByRole("status")).toHaveText(contentCopy.en.saved);
	disposablePython(
		"import json,sys\nfrom apps.accounts.models import Account\nAccount.objects.get(user__email=json.load(sys.stdin)['email'],context='staff').permission_groups.clear()",
		JSON.stringify({ email: actors.reviewer }),
	);
	await button(page, contentEditorCopy.en.savedPreview).click();
	await expect(page.locator("main [role=alert]")).toHaveText(
		contentEditorCopy.en.denied,
	);
	await expect(page.getByTestId("saved-content-preview")).toHaveCount(0);
	await page
		.getByLabel(contentCopy.en.reason, { exact: true })
		.fill("Denied after revocation");
	await button(page, contentCopy.en.unpublish).click();
	await expect(page.locator("main [role=alert]")).toHaveText(
		contentEditorCopy.en.denied,
	);
	expect((await api(publisher, `public/en/pages/${key}/`)).status).toBe(200);
	await rc.close();
	await pc.close();
});

test("structured section visibility, image and order changes block publication until explicitly saved or discarded", async ({
	browser,
}) => {
	const context = await staff(browser),
		page = await context.newPage();
	await page.goto("/en/account/staff/content/home");
	const discard = async () => {
		await expect(page.getByTestId("content-dirty")).toBeVisible();
		await page
			.getByLabel(contentCopy.en.reason, { exact: true })
			.fill("No transition may discard working structure");
		await expect(button(page, contentCopy.en.unpublish)).toBeDisabled();
		await button(page, contentEditorCopy.en.discard).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: contentEditorCopy.en.discard, exact: true })
			.click();
		await expect(page.getByTestId("content-dirty")).toHaveCount(0);
	};
	await page
		.getByLabel(contentCopy.en.enabled, { exact: true })
		.first()
		.uncheck();
	await discard();
	await page
		.getByRole("combobox", { name: contentCopy.en.asset, exact: true })
		.first()
		.selectOption("");
	await discard();
	await page
		.getByRole("button", { name: "Move down 1", exact: true })
		.last()
		.click();
	await discard();
	await context.close();
});
