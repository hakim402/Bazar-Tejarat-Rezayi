import { test, expect } from "@playwright/test";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
import { contentEditorCopy } from "../lib/i18n/content-editor";
import { contentCopy } from "../lib/i18n/content";
import { locales } from "../lib/i18n/locales";
import { messages } from "../lib/i18n/messages";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	process.env.CONTENT_BROWSER_TESTS !== "1",
	"Use the maintained Phase 5 disposable harness.",
);
import { staff, api, actors } from "./support/content-runtime";
for (const locale of locales)
	test(`${locale}: all public destinations, metadata, anchors, support and narrow reflow`, async ({
		page,
	}) => {
		test.setTimeout(90000);
		for (const path of [
			"",
			"how-it-works",
			"wholesale",
			"sell",
			"about",
			"help",
			"help/payment-and-delivery",
			"help/cancellations-and-disputes",
			"help/verification",
			"contact",
			"terms",
			"privacy",
		]) {
			const response = await page.goto(`/${locale}/${path}`);
			expect(response?.status()).toBe(200);
			await expect(page.locator("h1")).toHaveCount(1);
			await expect(page.locator("meta[name=robots]")).toHaveAttribute(
				"content",
				/noindex/,
			);
			expect(await page.content()).not.toContain("phase05-publisher@");
		}
		await page.goto(`/${locale}/help/payment-and-delivery`);
		await page.setViewportSize({ width: 320, height: 900 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.locator('main a[href^="#"]').first().click();
		await expect(page).toHaveURL(/#section-1/);
		await page.screenshot({
			path: `${evidence}/content-guide-${locale}-320.png`,
			fullPage: true,
		});
		await page.goto(`/${locale}/contact`);
		await expect(
			page.locator("main").getByRole("link", { name: "support@example.test" }),
		).toBeVisible();
		expect(
			await page
				.locator("main bdi")
				.first()
				.evaluate((el) => getComputedStyle(el).direction),
		).toBe("ltr");
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({
			path: `${evidence}/content-contact-${locale}-390.png`,
			fullPage: true,
		});
	});
test("editor saves/submits; publisher publishes; stale editor retains input and exact fallback metadata", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const ec = await staff(browser, "editor"),
		pc = await staff(browser),
		editor = await ec.newPage(),
		publisher = await pc.newPage();
	await editor.goto("/en/account/staff/content/about");
	await expect(editor.locator("[name=title]")).toBeVisible();
	await editor
		.getByLabel("Language", { exact: true })
		.last()
		.selectOption("fa-AF");
	await editor.locator("[name=title]").fill("Synthetic published by browser");
	await editor
		.getByRole("button", { name: contentCopy.en.save, exact: true })
		.click();
	await expect(editor.getByRole("status")).toHaveText(contentCopy.en.saved);
	await editor
		.getByLabel(contentCopy.en.reason, { exact: true })
		.fill("Synthetic review");
	await editor
		.getByRole("button", { name: contentCopy.en.submit, exact: true })
		.click();
	await expect(editor.getByRole("status")).toHaveText(contentCopy.en.saved);
	await expect(
		editor.getByRole("button", { name: contentCopy.en.publish, exact: true }),
	).toHaveCount(0);
	await publisher.goto("/en/account/staff/content/about");
	await publisher
		.getByLabel(contentCopy.en.reason, { exact: true })
		.fill("Synthetic publication");
	await publisher
		.getByRole("button", { name: contentCopy.en.publish, exact: true })
		.click();
	await expect(publisher.getByRole("status")).toHaveText(contentCopy.en.saved);
	const publicPage = await pc.newPage();
	await publicPage.goto("/en/about");
	await expect(publicPage.locator("h1")).toHaveText(
		"Synthetic published by browser",
	);
	await expect(publicPage.getByTestId("source-fallback")).toHaveText(
		contentCopy.en.fallback,
	);
	await expect(publicPage.locator("main article")).toHaveAttribute(
		"dir",
		"rtl",
	);
	await expect(publicPage.locator("link[rel=canonical]")).toHaveAttribute(
		"href",
		"https://bazartejaratrezayi.com/fa-AF/about",
	);
	await expect(publicPage.locator("link[hreflang=en]")).toHaveCount(0);
	await editor.locator("[name=title]").fill("Retain stale unpublished input");
	await editor
		.getByRole("button", { name: contentCopy.en.save, exact: true })
		.click();
	await expect(editor.locator("main").getByRole("alert")).toHaveText(
		contentCopy.en.conflict,
	);
	await expect(editor.locator("[name=title]")).toHaveValue(
		"Retain stale unpublished input",
	);
	await publicPage.reload();
	await expect(publicPage.locator("h1")).toHaveText(
		"Synthetic published by browser",
	);
	await editor.screenshot({
		path: `${evidence}/content-stale-editor.png`,
		fullPage: true,
	});
	await ec.close();
	await pc.close();
});
test("homepage ordering, settings, preview, publication and unpublication with fresh public reads", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const context = await staff(browser),
		page = await context.newPage();
	await page.goto("/en/account/staff/content/home");
	await expect(page.locator("[name=title]")).toBeVisible();
	await page
		.getByRole("button", { name: contentCopy.en.preview, exact: true })
		.click();
	await expect(page.getByTestId("content-preview")).toBeVisible();
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: `${evidence}/content-editor-${width}.png`,
			fullPage: true,
		});
		await page.screenshot({
			path: `${evidence}/content-editor-${width}-viewport.png`,
		});
	}
	for (const locale of ["fa-AF", "ps", "ar"] as const) {
		await page.goto(`/${locale}/account/staff/content/home`);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			contentCopy[locale].editor,
		);
		await expect(page.locator("[name=title]")).toBeVisible();
		await page.setViewportSize({ width: 390, height: 900 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page
			.getByRole("combobox", { name: messages[locale].theme, exact: true })
			.selectOption("dark");
		await page.screenshot({
			path: `${evidence}/content-editor-${locale}-390-dark.png`,
			fullPage: true,
		});
		await page.screenshot({
			path: `${evidence}/content-editor-${locale}-390-dark-viewport.png`,
		});
	}
	await page.goto("/en/account/staff/content/home");
	for (const key of ["navigation", "support", "announcement", "home"]) {
		if (key === "navigation" || key === "support") {
			await page.goto(`/en/account/staff/content/${key}`);
			await expect(page.locator("[name=title]")).toBeVisible();
			await page
				.getByRole("button", { name: contentCopy.en.preview, exact: true })
				.click();
			const preview = page.getByTestId("content-preview");
			await expect(preview).toBeVisible();
			await expect(preview).toContainText(
				key === "support" ? "support@example.test" : contentCopy.en.navigation,
			);
		}
		const detail = await api(page, `editor/staff/items/${key}/`);
		const source = detail.body.revisions.find(
			(v: { locale: string }) => v.locale === "fa-AF",
		);
		const payload = structuredClone(source.payload);
		payload.title = `Synthetic updated ${key}`;
		if (key === "home") {
			payload.blocks.reverse();
			payload.blocks.find((b: { id: string }) => b.id === "welcome").enabled =
				false;
		}
		if (key === "support") payload.support.email = "updated@example.test";
		if (key === "navigation")
			payload.navigation[0].links[0].label = "Synthetic updated guide";
		if (key === "announcement")
			payload.blocks = [
				{
					id: "announcement",
					type: "callout",
					text: "Synthetic updated notice",
				},
			];
		let op = await api(page, `editor/staff/items/${key}/`, {
			version: detail.body.version,
			locale: "fa-AF",
			payload,
		});
		const revision = op.body.revision;
		op = await api(page, `editor/staff/items/${key}/actions/`, {
			version: op.body.version,
			revision,
			action: "submit",
			reason: "Synthetic settings review",
		});
		op = await api(page, `editor/staff/items/${key}/actions/`, {
			version: op.body.version,
			revision,
			action: "publish",
			reason: "Synthetic settings publication",
		});
		expect(op.status).toBe(200);
		if (key === "home") {
			const publicPage = await context.newPage();
			await publicPage.goto("/en");
			await expect(publicPage.locator("main article section")).toHaveCount(2);
			await expect(
				publicPage.locator("main article section").first(),
			).toHaveAttribute("id", "stores");
			op = await api(page, `editor/staff/items/${key}/actions/`, {
				version: op.body.version,
				revision,
				action: "unpublish",
				reason: "Synthetic unpublish",
			});
			expect(op.status).toBe(200);
			await publicPage.reload();
			await expect(publicPage.locator("h1")).toHaveText(
				contentCopy.en.unavailable,
			);
			await expect(publicPage.locator("meta[name=robots]")).toHaveAttribute(
				"content",
				/noindex/,
			);
			const restoredPayload = structuredClone(source.payload);
			restoredPayload.blocks.find(
				(block: { id: string }) => block.id === "welcome",
			).title = "Synthetic reviewed hero headline";
			let restore = await api(page, `editor/staff/items/${key}/`, {
				version: op.body.version,
				locale: "fa-AF",
				payload: restoredPayload,
			});
			const restored = restore.body.revision;
			restore = await api(page, `editor/staff/items/${key}/actions/`, {
				version: restore.body.version,
				revision: restored,
				action: "submit",
				reason: "Restore synthetic published baseline",
			});
			restore = await api(page, `editor/staff/items/${key}/actions/`, {
				version: restore.body.version,
				revision: restored,
				action: "publish",
				reason: "Restore synthetic published baseline",
			});
			expect(restore.status).toBe(200);
			await publicPage.reload();
			await expect(publicPage.locator("h1")).toHaveText(
				"Synthetic reviewed hero headline",
			);
		}
	}
	await page.goto("/en/contact");
	await expect(
		page.getByText("Synthetic updated notice", { exact: true }),
	).toBeVisible();
	await expect(
		page.locator("main").getByRole("link", { name: "updated@example.test" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Synthetic updated guide" }),
	).toBeVisible();
	await expect(
		page
			.locator("aside")
			.first()
			.getByText(contentCopy.en.fallback, { exact: true }),
	).toHaveAttribute("dir", "ltr");
	await expect(
		page.locator('footer div[lang="fa-AF"]').first(),
	).toHaveAttribute("dir", "rtl");
	await context.close();
});
test("anonymous and editorial legal access denied; permission revocation applies immediately", async ({
	browser,
}) => {
	const context = await staff(browser, "editor"),
		page = await context.newPage();
	await page.goto("/en/account/staff/content/terms");
	await expect(page.getByText(contentCopy.en.legalHint)).toBeVisible();
	const detail = await api(page, "editor/staff/items/terms/");
	expect(
		(
			await api(page, "editor/staff/items/terms/actions/", {
				version: detail.body.version,
				revision: detail.body.publications["fa-AF"],
				action: "unpublish",
				reason: "Unauthorized policy action",
			})
		).status,
	).toBe(403);
	const anonymous = await browser.newContext(),
		other = await anonymous.newPage();
	await other.goto("/en");
	expect((await api(other, "editor/staff/items/terms/")).status).toBe(403);
	disposablePython(
		"from apps.accounts.models import Account\nimport json,sys\na=Account.objects.get(user__email=json.load(sys.stdin)['email'],context='staff')\na.permission_groups.clear()",
		JSON.stringify({ email: actors.editor }),
	);
	expect((await api(page, "editor/staff/items/terms/")).status).toBe(403);
	await page
		.getByRole("button", { name: contentCopy.en.reload, exact: true })
		.click();
	await expect(page.locator("main").getByRole("alert")).toHaveText(
		contentEditorCopy.en.denied,
	);
	await expect(page.locator("[name=title]")).toHaveCount(0);
	await anonymous.close();
	await context.close();
});
test("owner guarded policy approval with retained validation input", async ({
	page,
}) => {
	test.setTimeout(90000);
	const email = "phase05-owner-browser@example.test";
	disposablePython(
		"import json,sys\nfrom apps.accounts.models import User\nd=json.load(sys.stdin)\nUser.objects.create_user(d['email'],d['password'],display_name='Synthetic content owner',email_verified=True,is_staff=True,is_superuser=True,owner_authority=True)",
		JSON.stringify({ email, password: fixturePassword }),
	);
	await page.goto(`${apiOrigin}/admin/login/?locale=en`);
	await page.locator("[name=email]").fill(email);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page
		.getByRole("button", { name: "Set up authenticator", exact: true })
		.click();
	const code = disposablePython(
		"from apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\nd=Authenticator.objects.get(user__email='phase05-owner-browser@example.test')\nprint(f'{TOTP(d.secret).token():06}')",
	).trim();
	await page.locator("[name=code]").fill(code);
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await page
		.getByRole("link", {
			name: "I saved my codes — continue to administration",
			exact: true,
		})
		.click();
	await page.goto(`${apiOrigin}/admin/content/contentitem/?locale=en`);
	await page
		.getByRole("link", { name: "Create help article", exact: true })
		.click();
	await page.locator("[name=key]").fill("synthetic-owner-guide");
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(page).toHaveURL(/synthetic-owner-guide\/workflow/);
	await page.goto(
		`${apiOrigin}/admin/content/contentitem/privacy/workflow/?locale=en`,
	);
	await expect(
		page.getByText("Saving creates an immutable draft.", { exact: false }),
	).toBeVisible();
	await page.locator("[name=action]").selectOption("save");
	await page.locator("[name=locale]").selectOption("fa-AF");
	await page.locator("[name=payload]").fill(
		JSON.stringify({
			title: "Synthetic exact owner policy",
			blocks: [
				{ id: "policy", type: "text", text: "Synthetic legal test only." },
			],
		}),
	);
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await page.locator("[name=action]").selectOption("submit");
	await page.locator("[name=revision]").selectOption({ index: 1 });
	await page.locator("[name=reason]").fill("Synthetic owner review");
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await page.locator("[name=action]").selectOption("publish");
	await page.locator("[name=revision]").selectOption({ index: 1 });
	await page.locator("[name=reason]").fill("Synthetic exact version approval");
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(
		page.getByText("Action refused.", { exact: false }),
	).toBeVisible();
	await expect(page.locator("[name=reason]")).toHaveValue(
		"Synthetic exact version approval",
	);
	await page.locator("[name=owner_approval]").check();
	await page
		.locator("[name=effective_date]")
		.fill(new Date().toISOString().slice(0, 10));
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(page.getByText("Action refused.", { exact: false })).toHaveCount(
		0,
	);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.screenshot({
		path: `${evidence}/content-owner-policy-1440.png`,
		fullPage: true,
	});
	await page.goto(
		`${apiOrigin}/admin/content/contentitem/privacy/workflow/?locale=fa-AF`,
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator('section[lang="fa-AF"]').first()).toHaveAttribute(
		"dir",
		"rtl",
	);
	await page.screenshot({
		path: `${evidence}/content-owner-policy-fa-AF-390.png`,
		fullPage: true,
	});
	await page.goto("/en/privacy");
	await expect(page.locator("h1")).toHaveText("Synthetic exact owner policy");
	await expect(page.getByTestId("source-fallback")).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page
		.getByLabel(messages.en.theme, { exact: true })
		.selectOption("dark");
	await page.screenshot({
		path: `${evidence}/content-policy-390-dark.png`,
		fullPage: true,
	});
});

test("genuinely empty help, absent policy and unknown article stay distinct from outages", async ({
	page,
}) => {
	const records = disposablePython(
		"from django.core import serializers\nfrom apps.content.models import Publication\nrows=Publication.objects.filter(item__kind__in=['article','legal'])\nencoded=serializers.serialize('json',rows)\nrows.delete()\nprint(encoded)",
	);
	try {
		await page.goto("/en/help");
		await expect(
			page.getByText(contentCopy.en.noArticles, { exact: true }),
		).toBeVisible();
		await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
		expect(
			(await page.goto("/en/help/nonexistent-private-article"))?.status(),
		).toBe(404);
		await page.goto("/en/terms");
		await expect(page.locator("h1")).toHaveText(contentCopy.en.unavailable);
		await expect(page.locator("link[rel=canonical]")).toHaveCount(0);
		expect(await page.content()).not.toContain("Synthetic private policy");
	} finally {
		disposablePython(
			"import sys\nfrom django.core import serializers\nfor item in serializers.deserialize('json',sys.stdin.read()):\n item.save()",
			records,
		);
	}
});

test("long multilingual content reflows at 320px and preserves keyboard/theme controls", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const context = await staff(browser),
		page = await context.newPage();
	await page.goto("/en/account/staff/content/about");
	const detail = await api(page, "editor/staff/items/about/");
	let version = detail.body.version;
	let source: string | null = null;
	for (const locale of locales) {
		const word = { en: "Length", "fa-AF": "خواندن", ps: "لوستل", ar: "قراءة" }[
			locale
		];
		const payload = {
			title: word.repeat(20),
			description: word.repeat(30),
			blocks: [
				{
					id: "long-text",
					type: "text",
					title: word.repeat(10),
					text: word.repeat(250),
				},
			],
		};
		let op = await api(page, "editor/staff/items/about/", {
			version,
			locale,
			source: locale === "fa-AF" ? null : source,
			payload,
		});
		expect(op.status).toBe(200);
		const revision = op.body.revision;
		if (locale === "fa-AF") source = revision;
		op = await api(page, "editor/staff/items/about/actions/", {
			version: op.body.version,
			revision,
			action: "submit",
			reason: "Synthetic long text review",
		});
		op = await api(page, "editor/staff/items/about/actions/", {
			version: op.body.version,
			revision,
			action: "publish",
			reason: "Synthetic long text publication",
		});
		expect(op.status).toBe(200);
		version = op.body.version;
		await page.goto(`/${locale}/about`);
		await page.setViewportSize({ width: 320, height: 844 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page
			.getByRole("combobox", { name: messages[locale].theme, exact: true })
			.selectOption("dark");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await page.locator(".skip-link").focus();
		await page.keyboard.press("Enter");
		await expect(page.locator("#main")).toBeFocused();
		await page.screenshot({
			path: `${evidence}/content-long-${locale}-320-dark.png`,
			fullPage: true,
		});
	}
	await context.close();
});
