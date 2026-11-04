import { paymentCopy } from "../features/payments/copy";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { communicationCopy } from "../features/messaging/copy";
import { messages } from "../lib/i18n/messages";
import { locales } from "../lib/i18n/locales";
import { choosePreference } from "./support/site-preferences";
import { adminLogin, adminAppearance } from "./support/admin-runtime";
import {
	apiOrigin,
	disposablePython,
	fixturePassword,
} from "./support/identity-runtime";
import {
	messageFixture,
	messageLogin,
	privatePost,
	syntheticImage,
	historyCount,
	personalRead,
} from "./support/messaging-runtime";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	process.env.MESSAGING_BROWSER_TESTS !== "1",
	"Use the maintained disposable Phase 9 runner.",
);
test.beforeEach(() => {
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	);
});
const composer = (page: Page) => page.getByTestId("message-composer");
const field = (page: Page) => composer(page).locator("textarea[name=message]");
const send = (page: Page) => composer(page).locator("button[type=submit]");
async function primaryContrast(button: Locator) {
	const ratio = await button.evaluate((node) => {
		const style = getComputedStyle(node);
		const luminance = (color: string) => {
			if (!/^rgba?\(/.test(color))
				throw new Error("Expected resolved RGB color");
			const values = (color.match(/[\d.]+/g) ?? [])
				.slice(0, 3)
				.map(Number)
				.map((x) => x / 255)
				.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
			return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
		};
		const a = luminance(style.color),
			b = luminance(style.backgroundColor);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	});
	expect(ratio).toBeGreaterThanOrEqual(4.5);
}
async function thread(
	page: Page,
	context: "buyer" | "seller",
	id: string,
	seller?: string,
	locale = "en",
) {
	await page.goto(
		`/${locale}/account/${context}/messages/${id}${seller ? `?seller=${seller}` : ""}`,
	);
	await expect(page.getByTestId("message-history")).toBeVisible();
	await expect(field(page)).toBeEnabled();
}
async function switchBusiness(
	page: Page,
	seller: string,
	conversation: string,
	dirty = false,
) {
	if (dirty) page.once("dialog", (dialog) => dialog.accept());
	await page
		.getByRole("combobox", { name: communicationCopy.en.business, exact: true })
		.selectOption(seller);
	await expect(page).toHaveURL(new RegExp(`/messages\\?seller=${seller}$`));
	await page
		.locator(
			`a[href="/en/account/seller/messages/${conversation}?seller=${seller}"]`,
		)
		.click();
	await expect(page.getByTestId("message-history")).toBeVisible();
	await expect(field(page)).toBeEnabled();
}
for (const locale of locales)
	for (const role of ["buyer", "seller"] as const)
		test(`${locale} ${role}: inherited inbox/thread/notices/settings at desktop and mobile, native direction and themes`, async ({
			browser,
		}) => {
			test.setTimeout(240000);
			const f = messageFixture(),
				{ session, page } = await messageLogin(browser, role),
				t = communicationCopy[locale];
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			for (const [width, theme] of [
				[1440, "light"],
				[390, "dark"],
				[320, "light"],
			] as const) {
				await page.setViewportSize({ width, height: 1000 });
				await page.goto(
					`/${locale}/account/${role}/messages${role === "seller" ? `?seller=${f.companyA}` : ""}`,
				);
				await choosePreference(page, messages[locale].theme, theme);
				for (const [name, path] of [
					["inbox", "messages"],
					["thread", `messages/${f.threadA}`],
					["notifications", "notifications"],
					["settings", "settings"],
				] as const) {
					const response = await page.goto(
						`/${locale}/account/${role}/${path}${role === "seller" ? `?seller=${f.companyA}` : ""}`,
					);
					expect(response?.status()).toBe(200);
					expect(response?.headers()["x-robots-tag"]).toContain("noindex");
					await expect(page.locator("html")).toHaveAttribute(
						"dir",
						locale === "en" ? "ltr" : "rtl",
					);
					await expect(page.locator("main#main")).toBeVisible();
					if (name === "thread") {
						await expect(field(page)).toBeEnabled();
						await primaryContrast(send(page));
						await expect(
							page.getByText(t.privacy, { exact: true }),
						).toBeVisible();
						await page.getByTestId("message-history").scrollIntoViewIfNeeded();
					} else if (name === "settings")
						await expect(
							page
								.getByTestId("message-email-preference")
								.getByRole("checkbox", { name: t.emailEnabled, exact: true }),
						).toBeVisible();
					else
						await expect(
							page.getByTestId("communication-workspace"),
						).not.toContainText(t.loading, { timeout: 20000 });
					await page.evaluate(() => document.fonts.ready);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
						`${name} ${locale} ${role} ${width}`,
					).toBeLessThanOrEqual(width);
					if (name === "thread" && (width === 1440 || width === 390)) {
						const image = page
							.getByTestId("message-history")
							.locator("img")
							.first();
						await image.scrollIntoViewIfNeeded();
						await expect
							.poll(() =>
								image.evaluate(
									(node) =>
										(node as HTMLImageElement).complete &&
										(node as HTMLImageElement).naturalWidth > 0,
								),
							)
							.toBe(true);
						await page.screenshot({
							path: `${evidence}/p09-${locale}-${role}-${width}-${theme}.png`,
							fullPage: false,
						});
					}
				}
			}
			expect(errors).toEqual([]);
			await session.close();
		});
test("guest enquiry modal return never sends; deliberate first message is saved once", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const f = messageFixture(),
		session = await browser.newContext(),
		page = await session.newPage();
	const before = Number(
		disposablePython(
			"from apps.messaging.models import Conversation\nprint(Conversation.objects.count())",
		).trim(),
	);
	await page.goto(`/en/products/${f.product}`);
	const enquire = page.getByRole("button", {
		name: communicationCopy.en.enquire,
		exact: true,
	});
	await primaryContrast(enquire);
	await enquire.hover();
	await primaryContrast(enquire);
	await enquire.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	expect(
		Number(
			disposablePython(
				"from apps.messaging.models import Conversation\nprint(Conversation.objects.count())",
			).trim(),
		),
	).toBe(before);
	await page.locator("[name=email]").fill("phase09-dual@example.test");
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(
		new RegExp(`/en/account/buyer/messages\\?product=${f.product}`),
	);
	await expect(field(page)).toBeEnabled();
	expect(
		Number(
			disposablePython(
				"from apps.messaging.models import Conversation\nprint(Conversation.objects.count())",
			).trim(),
		),
	).toBe(before);
	await field(page).fill(
		'I choose to share +93700000000 and synthetic@example.test. <img onerror="window.bad=true">',
	);
	const responses: unknown[] = [];
	page.on("request", (request) => {
		if (
			request.url().endsWith("/buyer/enquiries/") &&
			request.method() === "POST"
		)
			responses.push(request.postDataJSON());
	});
	await composer(page)
		.locator("form")
		.evaluate((form) => {
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});
	await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
	await expect(page.getByTestId("message-history")).toContainText(
		"I choose to share",
	);
	expect(responses).toHaveLength(1);
	expect(await page.evaluate(() => "bad" in window)).toBe(false);
	await session.close();
});
test("buyer and messaging-only seller reply, controlled image, personal reads and participant report", async ({
	browser,
}) => {
	test.setTimeout(150000);
	const f = messageFixture(),
		buyer = await messageLogin(browser, "buyer"),
		seller = await messageLogin(browser, "seller");
	await thread(buyer.page, "buyer", f.threadA);
	await buyer.page.bringToFront();
	await buyer.page.getByTestId("message-history").scrollIntoViewIfNeeded();
	await expect
		.poll(() => personalRead("phase09-buyer@example.test", f.threadA))
		.toBeGreaterThan(0);
	const text = `Synthetic browser buyer reply ${Date.now()}`;
	await field(buyer.page).fill(text);
	await send(buyer.page).click();
	await expect(field(buyer.page)).toHaveValue("");
	await thread(seller.page, "seller", f.threadA, f.companyA);
	await seller.page.bringToFront();
	await expect(seller.page.getByTestId("message-history")).toContainText(text);
	await composer(seller.page)
		.locator("input[type=file]")
		.setInputFiles(syntheticImage());
	await expect(composer(seller.page)).not.toContainText(
		communicationCopy.en.prepare,
	);
	await expect(send(seller.page)).toBeEnabled();
	await field(seller.page).fill("Synthetic image reply");
	await send(seller.page).click();
	await expect(field(seller.page)).toHaveValue("");
	const id = disposablePython(
		`from apps.messaging.models import Attachment\nprint(Attachment.objects.filter(conversation_id='${f.threadA}',message__body='Synthetic image reply').latest('created_at').pk)`,
	).trim();
	const bytes = await buyer.page.request.get(
		`${apiOrigin}/api/v1/messaging/buyer/attachments/${id}/`,
	);
	expect(bytes.status()).toBe(200);
	expect(bytes.headers()["cache-control"]).toContain("no-store");
	await buyer.page.reload();
	await expect(buyer.page.getByTestId("message-history")).toContainText(
		"Synthetic image reply",
	);
	const row = buyer.page
		.getByTestId("message-history")
		.locator("article")
		.filter({ hasText: "Synthetic image reply" });
	const enlarge = row.getByRole("button", {
		name: communicationCopy.en.enlarge,
		exact: true,
	});
	await enlarge.click();
	await expect(
		buyer.page.getByRole("dialog", { name: communicationCopy.en.enlarge }),
	).toBeVisible();
	await buyer.page.keyboard.press("Escape");
	await expect(
		buyer.page.getByRole("dialog", { name: communicationCopy.en.enlarge }),
	).not.toBeVisible();
	await expect(enlarge).toBeFocused();
	const message = disposablePython(
		`from apps.messaging.models import Attachment\nprint(Attachment.objects.get(pk='${id}').message_id)`,
	).trim();
	const reportCounts = () =>
		JSON.parse(
			disposablePython(
				`import json\nfrom apps.messaging.models import Report,CaseEvent\nr=Report.objects.filter(message_id='${message}',reporter__user__email='phase09-buyer@example.test')\nprint(json.dumps([r.count(),CaseEvent.objects.filter(report__in=r,action='reported').count()]))`,
			),
		) as number[];
	expect(reportCounts()).toEqual([0, 0]);
	await row.locator("summary").click();
	const reason = row.getByRole("textbox", {
		name: communicationCopy.en.reason,
		exact: true,
	});
	const category = row.getByRole("combobox", {
		name: communicationCopy.en.category,
		exact: true,
	});
	const submit = () =>
		row.locator("details form").evaluate((form: HTMLFormElement) => {
			// Two synchronous submit events must still own only one request.
			form.requestSubmit();
			form.requestSubmit();
		});
	const packets: Array<{
		command_id: string;
		category: string;
		reason: string;
	}> = [];
	let attempt = 0;
	await buyer.page.route(
		`**/api/v1/messaging/buyer/messages/${message}/reports/`,
		async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			packets.push(route.request().postDataJSON());
			const mine = attempt++;
			if (mine === 0)
				return route.fulfill({
					status: 400,
					contentType: "application/json",
					body: '{"error":{"code":"invalid"}}',
				});
			if (mine === 1) {
				await route.fetch(); // Commit a real synthetic report, then lose its acknowledgement.
				return route.abort("timedout");
			}
			if (mine >= 2 && mine <= 4)
				return route.fulfill({
					status: [429, 400, 409][mine - 2],
					contentType: "application/json",
					body: '{"error":{"code":"retry_failed"}}',
				});
			return route.continue();
		},
	);
	await reason.fill("First definite invalid report");
	await submit();
	await expect(row.getByRole("alert")).toBeVisible();
	await expect(reason).toBeEnabled();
	await expect(category).toBeEnabled();
	expect(reportCounts()).toEqual([0, 0]);
	await category.selectOption("privacy");
	await reason.fill("Synthetic report from browser with lost acknowledgement");
	await submit();
	await expect(
		row.getByRole("button", { name: communicationCopy.en.retry, exact: true }),
	).toBeEnabled();
	expect(reportCounts()).toEqual([1, 1]);
	for (const _status of [429, 400, 409]) {
		await submit();
		await expect(row.getByRole("alert")).toBeVisible();
		await expect(
			row.getByRole("button", {
				name: communicationCopy.en.retry,
				exact: true,
			}),
		).toBeEnabled();
		await expect(reason).toBeDisabled();
		await expect(category).toBeDisabled();
		await expect(reason).toHaveValue(
			"Synthetic report from browser with lost acknowledgement",
		);
		await expect(category).toHaveValue("privacy");
		expect(reportCounts()).toEqual([1, 1]);
	}
	await submit();
	await expect(row).toContainText(communicationCopy.en.reportSaved);
	await expect(row.getByRole("alert")).toHaveCount(0);
	expect(reportCounts()).toEqual([1, 1]);
	expect(packets).toHaveLength(6);
	expect(packets[0].command_id).not.toBe(packets[1].command_id);
	for (const packet of packets.slice(1)) expect(packet).toEqual(packets[1]);

	await buyer.session.close();
	await seller.session.close();
});
test("late participant report completion cannot unlock or overwrite a new business report", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "seller", "multi-member");
	await thread(page, "seller", f.threadA, f.companyA);
	const reportRow = () =>
		page.getByTestId("message-history").locator("article").last();
	const reason = () =>
		reportRow().getByRole("textbox", {
			name: communicationCopy.en.reason,
			exact: true,
		});
	const held: Array<() => void> = [];
	const starts: Array<() => void> = [];
	const arrivals = [0, 1].map(
		(i) =>
			new Promise<void>((resolve) => {
				starts[i] = resolve;
			}),
	);
	let index = 0;
	await page.route(
		"**/api/v1/messaging/seller/messages/*/reports/",
		async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			const mine = index++,
				response = await route.fetch();
			const wait = new Promise<void>((resolve) => {
				held[mine] = resolve;
			});
			starts[mine]();
			await wait;
			await route.fulfill({ response }).catch(() => {});
		},
	);
	await reportRow().locator("summary").click();
	await reason().fill("Synthetic old A participant report");
	await reportRow()
		.getByRole("button", {
			name: communicationCopy.en.submitReport,
			exact: true,
		})
		.click();
	await arrivals[0];
	await switchBusiness(page, f.companyB, f.threadB);
	await reportRow().locator("summary").click();
	await reason().fill("Synthetic current B participant report");
	await reportRow()
		.getByRole("button", {
			name: communicationCopy.en.submitReport,
			exact: true,
		})
		.click();
	await arrivals[1];
	const oldCompleted = page.waitForResponse(
		(r) => r.url().includes("/reports/") && r.request().method() === "POST",
	);
	held[0]();
	await oldCompleted;
	await expect(reason()).toBeDisabled();
	await expect(reason()).toHaveValue("Synthetic current B participant report");
	await expect(
		reportRow().getByRole("button", {
			name: communicationCopy.en.sending,
			exact: true,
		}),
	).toBeDisabled();
	await expect(reportRow()).not.toContainText(communicationCopy.en.reportSaved);
	held[1]();
	await expect(reportRow()).toContainText(communicationCopy.en.reportSaved);
	expect(index).toBe(2);
	await session.close();
});
test("existing enquiry conflict opens its thread while retaining unsent input for deliberate send", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "buyer");
	const product = disposablePython(
		`from apps.messaging.models import Conversation\nprint(Conversation.objects.get(pk='${f.threadA}').product_id)`,
	).trim();
	const before = historyCount(f.threadA);
	await page.goto(`/en/account/buyer/messages?product=${product}`);
	await expect(field(page)).toBeEnabled();
	await field(page).fill("Existing conversation must not auto-repost");
	await send(page).click();
	await expect(page).toHaveURL(new RegExp(`/messages/${f.threadA}$`));
	await expect(field(page)).toHaveValue(
		"Existing conversation must not auto-repost",
	);
	expect(historyCount(f.threadA)).toBe(before);
	await send(page).click();
	await expect(field(page)).toHaveValue("");
	expect(historyCount(f.threadA)).toBe(before + 1);
	await session.close();
});
test("earlier history paging, escaped voluntary contacts, strict routes and personal email opt-out", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "buyer");
	await thread(page, "buyer", f.threadA);
	await page
		.getByRole("button", { name: communicationCopy.en.older, exact: true })
		.click();
	await expect(page.getByTestId("message-history")).toContainText(
		"I choose to share +93700000000",
	);
	expect(
		await page.getByTestId("message-history").locator("script").count(),
	).toBe(0);
	for (const path of [
		`/en/account/buyer/messages/bad`,
		`/en/account/seller/notifications/${f.threadA}`,
		`/en/account/staff/messages/${f.threadA}`,
	])
		expect((await page.request.get(path)).status()).toBe(404);
	const html = await page.request.get(
		`/en/account/buyer/messages/${f.threadA}`,
	);
	expect(await html.text()).not.toContain("I choose to share +93700000000");
	expect(html.headers()["x-robots-tag"]).toContain("noindex");
	expect(html.headers()["cache-control"]).toContain("no-store");
	await page.goto("/en/account/buyer/settings");
	const pref = page.getByTestId("message-email-preference");
	const messageEmail = pref.getByRole("checkbox", {
		name: communicationCopy.en.emailEnabled,
		exact: true,
	});
	const paymentEmail = pref.getByRole("checkbox", {
		name: paymentCopy.en.email,
		exact: true,
	});
	await expect(messageEmail).toBeVisible();
	await expect(paymentEmail).toBeChecked();
	await messageEmail.uncheck();
	await pref
		.getByRole("button", { name: communicationCopy.en.savePreference })
		.click();
	await expect(pref).toContainText(communicationCopy.en.preferenceSaved);
	await expect(paymentEmail).toBeChecked();
	expect(
		disposablePython(
			"from apps.notifications.models import Preference\np=Preference.objects.get(account__user__email='phase09-buyer@example.test');print((p.message_email,p.payment_email))",
		).trim(),
	).toBe("(False, True)");
	await page.goto("/en/account/buyer/notifications");
	await expect(page.getByTestId("communication-workspace")).not.toContainText(
		communicationCopy.en.loading,
	);
	const mark = page
		.getByRole("button", { name: communicationCopy.en.markRead, exact: true })
		.first();
	if (await mark.count()) {
		await mark.click();
		await expect(mark).toBeEnabled();
	}
	await session.close();
});
for (const target of ["B", "A"] as const)
	for (const operation of ["send", "upload"] as const)
		test(`late ${operation} completion cannot overwrite or unlock ${target === "A" ? "a returned A" : "business B"}`, async ({
			browser,
		}) => {
			test.setTimeout(100000);
			const f = messageFixture(),
				{ session, page } = await messageLogin(
					browser,
					"seller",
					"multi-member",
				);
			await thread(page, "seller", f.threadA, f.companyA);
			let release: () => void = () => {},
				started: () => void = () => {};
			const pending = new Promise<void>((r) => {
					release = r;
				}),
				began = new Promise<void>((r) => {
					started = r;
				});
			const path = `**/api/v1/messaging/seller/conversations/${f.threadA}/${operation === "send" ? "messages/" : "uploads/"}`;
			await page.route(
				path,
				async (route) => {
					if (route.request().method() !== "POST") return route.continue();
					const response = await route.fetch();
					started();
					await pending;
					await route.fulfill({ response }).catch(() => {});
				},
				{ times: 1 },
			);
			await field(page).fill("Old A uncertain command");
			if (operation === "send") await send(page).click();
			else
				await composer(page)
					.locator("input[type=file]")
					.setInputFiles(syntheticImage());
			await began;
			await switchBusiness(page, f.companyB, f.threadB, true);
			await field(page).fill("B independent draft");
			if (target === "A") {
				await switchBusiness(page, f.companyA, f.threadA, true);
				await field(page).fill("New A independent draft");
			}
			release();
			await expect(field(page)).toHaveValue(
				target === "B" ? "B independent draft" : "New A independent draft",
			);
			await expect(send(page))
				.not.toBeDisabled({ timeout: 20000 })
				.catch(async () => {
					if (operation === "upload" && target === "A")
						await expect(
							composer(page).getByRole("button", {
								name: communicationCopy.en.retry,
								exact: true,
							}),
						).toBeEnabled();
					else throw new Error("New scope remained locked");
				});
			await session.close();
		});
test("uncertain committed send reconciles with its original command without duplicates, including offline retry", async ({
	browser,
}) => {
	test.setTimeout(100000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "buyer");
	await thread(page, "buyer", f.threadA);
	const before = historyCount(f.threadA),
		commands: string[] = [];
	await page.route(
		`**/api/v1/messaging/buyer/conversations/${f.threadA}/messages/`,
		async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			commands.push(route.request().postDataJSON().command_id);
			await route.fetch();
			await route.abort("timedout");
		},
		{ times: 1 },
	);
	await field(page).fill("A durable uncertain browser send");
	await send(page).click();
	await expect(composer(page)).toContainText(communicationCopy.en.uncertain);
	await expect(field(page)).toHaveValue("A durable uncertain browser send");
	expect(historyCount(f.threadA)).toBe(before + 1);
	page.on("request", (request) => {
		if (
			request.url().endsWith(`/conversations/${f.threadA}/messages/`) &&
			request.method() === "POST"
		)
			commands.push(request.postDataJSON().command_id);
	});
	// A throttle on reconciliation says nothing about the earlier unknown
	// attempt. Retain its exact packet instead of silently minting a new key.
	await page.route(
		`**/api/v1/messaging/buyer/conversations/${f.threadA}/messages/`,
		(route) => {
			if (route.request().method() !== "POST") return route.continue();
			return route.fulfill({
				status: 429,
				contentType: "application/json",
				body: '{"error":{"code":"throttled"}}',
			});
		},
		{ times: 1 },
	);
	await send(page).click();
	await expect(composer(page)).toContainText(communicationCopy.en.throttled);
	await expect(field(page)).toBeDisabled();
	await expect(field(page)).toHaveValue("A durable uncertain browser send");
	await expect(send(page)).toBeEnabled();
	expect(historyCount(f.threadA)).toBe(before + 1);
	await send(page).click();
	await expect(field(page)).toHaveValue("");
	expect(historyCount(f.threadA)).toBe(before + 1);
	expect(new Set(commands).size).toBe(1);
	await session.setOffline(true);
	await expect(
		page.getByText(communicationCopy.en.offline, { exact: true }),
	).toBeVisible();
	await field(page).fill("Offline draft is retained");
	await send(page).click();
	await expect(composer(page)).toContainText(communicationCopy.en.uncertain);
	await expect(field(page)).toHaveValue("Offline draft is retained");
	await session.setOffline(false);
	await send(page).click();
	await expect(field(page)).toHaveValue("");
	await session.close();
});
for (const status of [400, 409, 429, 503])
	test(`send ${status} preserves unsent text and upload failure remains recoverable`, async ({
		browser,
	}) => {
		test.setTimeout(65000);
		const f = messageFixture(),
			{ session, page } = await messageLogin(browser, "buyer");
		await thread(page, "buyer", f.threadA);
		await page.route(
			`**/api/v1/messaging/buyer/conversations/${f.threadA}/messages/`,
			async (route) =>
				route.request().method() === "POST"
					? route.fulfill({
							status,
							contentType: "application/json",
							body: '{"error":{"code":"request_failed"}}',
						})
					: route.continue(),
			{ times: 1 },
		);
		await field(page).fill(`Unsent browser draft ${status}`);
		await send(page).click();
		await expect(composer(page).getByRole("alert")).toBeVisible();
		await expect(field(page)).toHaveValue(`Unsent browser draft ${status}`);
		if (status === 503)
			await expect(composer(page)).toContainText(
				communicationCopy.en.uncertain,
			);
		else await expect(field(page)).toBeEnabled();
		await session.close();
	});
test("late poll and active company revocation clear the next prohibited action; no fabricated outage counts", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "seller", "multi-member");
	await thread(page, "seller", f.threadA, f.companyA);
	let release: () => void = () => {},
		started: () => void = () => {};
	const pending = new Promise<void>((r) => {
			release = r;
		}),
		began = new Promise<void>((r) => {
			started = r;
		});
	await page.route(
		`**/api/v1/messaging/seller/conversations/${f.threadA}/messages/?after=*`,
		async (route) => {
			const response = await route.fetch();
			started();
			await pending;
			await route.fulfill({ response }).catch(() => {});
		},
		{ times: 1 },
	);
	await page.evaluate(() =>
		document.dispatchEvent(new Event("visibilitychange")),
	);
	await began;
	await switchBusiness(page, f.companyB, f.threadB);
	release();
	await expect(page.getByTestId("message-history")).toContainText(
		"Independent company B thread",
	);
	await expect(page.getByTestId("message-history")).not.toContainText(
		"I choose to share",
	);
	disposablePython(
		`from apps.organizations.models import Membership\nMembership.objects.filter(company_id='${f.companyB}',account__user__email='phase09-multi-member@example.test').update(active=False)`,
	);
	await field(page).fill("Must not send after revocation");
	await send(page).click();
	await expect(
		page.getByTestId("communication-workspace").getByRole("alert"),
	).toBeVisible();
	await expect(page.getByTestId("message-history")).toHaveCount(0);
	disposablePython(
		`from apps.organizations.models import Membership\nMembership.objects.filter(company_id='${f.companyB}',account__user__email='phase09-multi-member@example.test').update(active=True)`,
	);
	await session.close();
});
test("native case workflow audits content, denies unassigned access and preserves participant reads", async ({
	browser,
}) => {
	test.setTimeout(160000);
	const f = messageFixture(),
		assigned = await browser.newContext(),
		page = await assigned.newPage();
	await adminLogin(page, "phase09-support@example.test");
	const before = personalRead("phase09-buyer@example.test", f.threadA);
	await page.goto(`${apiOrigin}/admin/messaging/report/${f.report}/case/`);
	await expect(page.locator("#content")).toContainText("Reported message");
	await expect(page.locator("#content")).toContainText("I choose to share");
	expect(personalRead("phase09-buyer@example.test", f.threadA)).toBe(before);
	for (const [width, theme] of [
		[1440, "light"],
		[390, "dark"],
	] as const) {
		await adminAppearance(page, width, theme);
		await page.screenshot({
			path: `${evidence}/p09-native-case-${width}-${theme}.png`,
			fullPage: false,
		});
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(width);
	}
	const image = await page.request.get(
		`${apiOrigin}/admin/messaging/report/${f.report}/images/${f.image}/download/`,
	);
	expect(image.status()).toBe(200);
	expect(image.headers()["cache-control"]).toContain("no-store");
	const other = await browser.newContext(),
		otherPage = await other.newPage();
	await adminLogin(otherPage, "phase09-unassigned@example.test");
	expect(
		(
			await otherPage.request.get(
				`${apiOrigin}/admin/messaging/report/${f.report}/case/`,
			)
		).status(),
	).toBe(404);
	expect(
		(
			await otherPage.request.get(
				`${apiOrigin}/admin/messaging/report/${f.report}/images/${f.image}/download/`,
			)
		).status(),
	).toBe(404);
	expect(
		Number(
			disposablePython(
				`from apps.messaging.models import CaseAccess\nprint(CaseAccess.objects.filter(report_id='${f.report}').count())`,
			).trim(),
		),
	).toBeGreaterThanOrEqual(2);
	await assigned.close();
	await other.close();
});

test("failed and timed-out uploads retain the original command and staged input for safe retry", async ({
	browser,
}) => {
	test.setTimeout(100000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "buyer");
	await thread(page, "buyer", f.threadA);
	await field(page).fill("Upload failure keeps this draft");
	await page.route(
		`**/api/v1/messaging/buyer/conversations/${f.threadA}/uploads/`,
		(route) =>
			route.fulfill({
				status: 503,
				contentType: "application/json",
				body: '{"error":{"code":"unavailable"}}',
			}),
		{ times: 1 },
	);
	await composer(page)
		.locator("input[type=file]")
		.setInputFiles(syntheticImage());
	await expect(composer(page).getByRole("alert")).toBeVisible();
	await expect(field(page)).toHaveValue("Upload failure keeps this draft");
	await composer(page)
		.getByRole("button", { name: communicationCopy.en.retry, exact: true })
		.click();
	await expect(send(page)).toBeEnabled();
	await composer(page)
		.getByRole("button", { name: communicationCopy.en.remove, exact: true })
		.click();
	const before = Number(
		disposablePython(
			`from apps.messaging.models import Attachment\nprint(Attachment.objects.filter(conversation_id='${f.threadA}').count())`,
		).trim(),
	);
	await page.route(
		`**/api/v1/messaging/buyer/conversations/${f.threadA}/uploads/`,
		async (route) => {
			const response = await route.fetch();
			await new Promise((resolve) => setTimeout(resolve, 31000));
			await route.fulfill({ response }).catch(() => {});
		},
		{ times: 1 },
	);
	await composer(page)
		.locator("input[type=file]")
		.setInputFiles(syntheticImage());
	await expect(
		composer(page).getByRole("button", {
			name: communicationCopy.en.retry,
			exact: true,
		}),
	).toBeEnabled({ timeout: 36000 });
	await composer(page)
		.getByRole("button", { name: communicationCopy.en.retry, exact: true })
		.click();
	await expect(send(page)).toBeEnabled();
	expect(
		Number(
			disposablePython(
				`from apps.messaging.models import Attachment\nprint(Attachment.objects.filter(conversation_id='${f.threadA}').count())`,
			).trim(),
		),
	).toBe(before + 1);
	await session.close();
});
test("actual send timeout retains a durable outcome and reconciles without a second message", async ({
	browser,
}) => {
	test.setTimeout(70000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "buyer");
	await thread(page, "buyer", f.threadA);
	const before = historyCount(f.threadA);
	await page.route(
		`**/api/v1/messaging/buyer/conversations/${f.threadA}/messages/`,
		async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			const response = await route.fetch();
			await new Promise((resolve) => setTimeout(resolve, 11000));
			await route.fulfill({ response }).catch(() => {});
		},
		{ times: 1 },
	);
	await field(page).fill("Timeout with an already committed result");
	await send(page).click();
	await expect(composer(page)).toContainText(communicationCopy.en.uncertain, {
		timeout: 15000,
	});
	await expect(send(page)).toBeEnabled();
	await send(page).click();
	await expect(field(page)).toHaveValue("");
	expect(historyCount(f.threadA)).toBe(before + 1);
	await session.close();
});
test("old A completion cannot unlock a newer A write", async ({ browser }) => {
	test.setTimeout(100000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "seller", "multi-member");
	await thread(page, "seller", f.threadA, f.companyA);
	const releases: (() => void)[] = [],
		began: (() => void)[] = [],
		starts = [0, 1].map(
			() => new Promise<void>((resolve) => began.push(resolve)),
		),
		waits = [0, 1].map(
			() => new Promise<void>((resolve) => releases.push(resolve)),
		);
	let index = 0;
	const path = `**/api/v1/messaging/seller/conversations/${f.threadA}/messages/`;
	await page.route(path, async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		const current = index++,
			response = await route.fetch();
		began[current]();
		await waits[current];
		await route.fulfill({ response }).catch(() => {});
	});
	await field(page).fill("Original A request remains owned");
	await send(page).click();
	await starts[0];
	await switchBusiness(page, f.companyB, f.threadB, true);
	await switchBusiness(page, f.companyA, f.threadA);
	await field(page).fill("New A write remains owned");
	await send(page).click();
	await starts[1];
	releases[0]();
	await expect(send(page)).toBeDisabled();
	await expect(field(page)).toHaveValue("New A write remains owned");
	releases[1]();
	await expect(field(page)).toHaveValue("");
	await session.close();
});
test("unsaved navigation is deliberate, logout clears memory and inaccessible pages show no private history", async ({
	browser,
}) => {
	test.setTimeout(100000);
	const f = messageFixture(),
		{ session, page } = await messageLogin(browser, "buyer");
	await thread(page, "buyer", f.threadA);
	await field(page).fill("Private draft must clear on logout");
	page.once("dialog", (dialog) => dialog.dismiss());
	await page
		.getByRole("link", { name: communicationCopy.en.back, exact: true })
		.click();
	await expect(field(page)).toHaveValue("Private draft must clear on logout");
	expect((await privatePost(page, "auth/buyer/logout/", {})).status()).toBe(
		200,
	);
	await page.evaluate(() =>
		window.dispatchEvent(new Event("rezayi:account-session-changed")),
	);
	await expect(page.getByTestId("message-history")).toHaveCount(0);
	await expect(page.getByRole("alert")).toBeVisible();
	expect(
		(
			await page.request.get(
				`${apiOrigin}/api/v1/messaging/buyer/conversations/${f.threadA}/messages/`,
			)
		).status(),
	).toBe(403);
	await page.goto("/en/auth/buyer-sign-in");
	await page.locator("[name=email]").fill("phase09-buyer@example.test");
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(/\/account\/buyer$/);
	await thread(page, "buyer", f.threadA);
	await expect(field(page)).toHaveValue("");
	await session.close();
});
test("private API outage has a visible unavailable state, never fabricated empty history or zero counters", async ({
	browser,
}) => {
	test.setTimeout(80000);
	const { session, page } = await messageLogin(browser, "buyer");
	await page.route("**/api/v1/messaging/buyer/conversations/?*", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: '{"error":{"code":"unavailable"}}',
		}),
	);
	await page.route("**/api/v1/notifications/buyer/unread/**", (route) =>
		route.fulfill({
			status: 503,
			contentType: "application/json",
			body: '{"error":{"code":"unavailable"}}',
		}),
	);
	await page.goto("/en/account/buyer/messages");
	await expect(
		page.getByTestId("communication-workspace").getByRole("alert"),
	).toContainText(communicationCopy.en.failed);
	await expect(page.getByTestId("communication-workspace")).not.toContainText(
		communicationCopy.en.empty,
	);
	await expect(page.getByTestId("communication-workspace")).not.toContainText(
		`${communicationCopy.en.threadCount}: 0`,
	);
	const counts = page.getByRole("region", {
		name: communicationCopy.en.unread,
		exact: true,
	});
	await expect(counts).toContainText(communicationCopy.en.failed);
	await expect(counts).not.toContainText(communicationCopy.en.noAccess);
	await session.close();
});

test("empty communication state, keyboard-only send, protected image failure and read-only retained history", async ({
	browser,
}) => {
	test.setTimeout(160000);
	const f = messageFixture();
	disposablePython(
		`from apps.accounts.models import User,Account\nimport os\nu,created=User.objects.get_or_create(email='phase09-empty@example.test',defaults={'display_name':'Synthetic empty buyer','email_verified':True})\nif created:\n u.set_password(os.environ['REZAYI_TEST_FIXTURE_PASSWORD']);u.save()\nAccount.objects.get_or_create(user=u,context='buyer')`,
	);
	const empty = await messageLogin(browser, "buyer", "empty");
	await empty.page.goto("/en/account/buyer/messages");
	await expect(empty.page.getByTestId("communication-workspace")).toContainText(
		communicationCopy.en.empty,
	);
	await empty.page.goto("/en/account/buyer/notifications");
	await expect(empty.page.getByTestId("communication-workspace")).toContainText(
		communicationCopy.en.emptyNotices,
	);
	await empty.session.close();
	const { session, page } = await messageLogin(browser, "buyer");
	await thread(page, "buyer", f.threadA);
	await field(page).focus();
	await page.keyboard.type("Keyboard-only synthetic message");
	await primaryContrast(send(page));
	await send(page).hover();
	await primaryContrast(send(page));
	await page.mouse.move(0, 0);
	await page.keyboard.press("Tab");
	await expect(composer(page).locator("input[type=file]")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(send(page)).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(field(page)).toHaveValue("");
	await page.setViewportSize({ width: 390, height: 844 });
	await composer(page).scrollIntoViewIfNeeded();
	await page.screenshot({
		path: `${evidence}/p09-en-buyer-mobile-composer.png`,
		fullPage: false,
	});
	await page.route(
		`**/api/v1/messaging/buyer/attachments/${f.image}/`,
		(route) => route.fulfill({ status: 503, body: "" }),
	);
	await page.reload();
	await expect(field(page)).toBeEnabled();
	await page
		.getByTestId("message-history")
		.evaluate(
			(element, id) =>
				element
					.querySelector<HTMLImageElement>(`img[src$="/attachments/${id}/"]`)
					?.scrollIntoView(),
			f.image,
		);
	await expect(
		page.getByTestId("message-history").getByRole("alert"),
	).toContainText(communicationCopy.en.failed);
	const saved = disposablePython(
		`from apps.catalogue.models import Product\nfrom apps.messaging.models import Conversation\np=Conversation.objects.get(pk='${f.threadA}').product\nprint(p.published_id)\nProduct.objects.filter(pk=p.pk).update(published=None)`,
	).trim();
	try {
		await page.reload();
		await expect(
			page.getByText(communicationCopy.en.readonly, { exact: true }),
		).toBeVisible();
		await expect(field(page)).toBeDisabled();
		await expect(page.getByTestId("message-history")).toContainText(
			"Keyboard-only synthetic message",
		);
	} finally {
		disposablePython(
			`from apps.catalogue.models import Product\nfrom apps.messaging.models import Conversation\nProduct.objects.filter(pk=Conversation.objects.get(pk='${f.threadA}').product_id).update(published_id='${saved}')`,
		);
	}
	await session.close();
});

for (const change of ["locale", "role"] as const)
	test(`late send across ${change} navigation cannot disclose or overwrite a new scope`, async ({
		browser,
	}) => {
		test.setTimeout(100000);
		const f = messageFixture(),
			{ session, page } = await messageLogin(browser, "buyer", "dual");
		const response = await privatePost(page, "messaging/buyer/enquiries/", {
			command_id: crypto.randomUUID(),
			product: f.product,
			body: "Synthetic role and locale enquiry",
			images: [],
			locale: "en",
		});
		const result = await response.json(),
			id = result.conversation;
		expect([201, 409]).toContain(response.status());
		await thread(page, "buyer", id);
		let release: () => void = () => {},
			started: () => void = () => {};
		const pending = new Promise<void>((r) => {
				release = r;
			}),
			began = new Promise<void>((r) => {
				started = r;
			});
		await page.route(
			`**/api/v1/messaging/buyer/conversations/${id}/messages/`,
			async (route) => {
				if (route.request().method() !== "POST") return route.continue();
				const saved = await route.fetch();
				started();
				await pending;
				await route.fulfill({ response: saved }).catch(() => {});
			},
			{ times: 1 },
		);
		await field(page).fill("Old locale and role command");
		await send(page).click();
		await began;
		page.once("dialog", (dialog) => dialog.accept());
		if (change === "locale") {
			await choosePreference(page, messages.en.language, "fa-AF");
			await expect(page).toHaveURL(
				new RegExp(`/fa-AF/account/buyer/messages/${id}$`),
			);
			await expect(field(page)).toBeEnabled();
			await field(page).fill("متن تازهٔ حساب");
			release();
			await expect(field(page)).toHaveValue("متن تازهٔ حساب");
			await expect(send(page)).toBeEnabled();
		} else {
			await page.goto("/en/auth/seller-sign-in");
			await page.locator("[name=email]").fill("phase09-dual@example.test");
			await page.locator("[name=password]").fill(fixturePassword);
			await page.locator(".account-card > form button[type=submit]").click();
			await expect(page).toHaveURL(/\/account\/seller$/);
			await page.goto("/en/account/seller/messages");
			await expect(page.getByTestId("communication-workspace")).toContainText(
				communicationCopy.en.noBusiness,
			);
			release();
			await expect(page.getByTestId("message-history")).toHaveCount(0);
			await expect(
				page.getByTestId("communication-workspace"),
			).not.toContainText("Old locale and role command");
		}
		await session.close();
	});

test("failed displayed-message acknowledgement retries after a fresh visible poll without needing a new message", async ({
	browser,
}) => {
	test.setTimeout(100000);
	const f = messageFixture(),
		seller = await messageLogin(browser, "seller");
	const sent = await privatePost(
		seller.page,
		`messaging/seller/conversations/${f.threadA}/messages/`,
		{
			command_id: crypto.randomUUID(),
			body: "Synthetic incoming acknowledgement recovery",
			images: [],
		},
	);
	expect(sent.status()).toBe(201);
	const sequence = (await sent.json()).sequence;
	await seller.session.close();
	const before = personalRead("phase09-buyer@example.test", f.threadA),
		{ session, page } = await messageLogin(browser, "buyer");
	await page.setViewportSize({ width: 1440, height: 2000 });
	let allowAcknowledgement = false;
	const attempts: number[] = [];
	await page.route(
		`**/api/v1/messaging/buyer/conversations/${f.threadA}/read/`,
		(route) => {
			attempts.push(route.request().postDataJSON().sequence);
			return allowAcknowledgement
				? route.continue()
				: route.fulfill({
						status: 503,
						contentType: "application/json",
						body: '{"error":{"code":"unavailable"}}',
					});
		},
	);
	// A read failure may temporarily disable the composer; that is the stimulus,
	// so wait on displayed history rather than an unrelated enabled input.
	await page.goto(`/en/account/buyer/messages/${f.threadA}`);
	await expect(page.getByTestId("message-history")).toBeVisible();
	await page
		.getByTestId("message-history")
		.locator("article")
		.last()
		.scrollIntoViewIfNeeded();
	await expect.poll(() => attempts.includes(sequence)).toBe(true);
	await expect(
		page.getByTestId("communication-workspace").getByRole("alert"),
	).toContainText(communicationCopy.en.failed);
	expect(personalRead("phase09-buyer@example.test", f.threadA)).toBe(before);
	allowAcknowledgement = true;
	await page.evaluate(() =>
		document.dispatchEvent(new Event("visibilitychange")),
	);
	await expect
		.poll(() => personalRead("phase09-buyer@example.test", f.threadA), {
			timeout: 15000,
		})
		.toBe(sequence);
	expect(
		attempts.filter((value) => value === sequence).length,
	).toBeGreaterThanOrEqual(2);
	await session.close();
});
