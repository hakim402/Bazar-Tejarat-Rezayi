import { test, expect, type Browser, type Page } from "@playwright/test";
import {
	disposablePython,
	fixturePassword,
	apiOrigin,
} from "./support/identity-runtime";
import { clearCart, addLine, noOverflow } from "./support/commerce-runtime";
import { negotiationCopy } from "../features/negotiations/copy";
import { loadRenderedImages } from "./support/rendered-images";
import type { Locale } from "../lib/i18n/locales";
test.skip(
	process.env.COMMERCE_BROWSER_TESTS !== "1",
	"Use owned Phase11 native harness.",
);
test.setTimeout(90000);
test.beforeEach(() =>
	disposablePython(
		"from apps.accounts.models import RateBucket\nRateBucket.objects.all().delete()",
	),
);
function fixture() {
	return JSON.parse(
		disposablePython(`import json
from apps.catalogue.models import Variant
rows=list(Variant.objects.filter(sku__startswith='P11-').order_by('sku'))
print(json.dumps([{'variant':str(v.pk),'seller':str(v.product.seller_id),'product':str(v.product_id)} for v in rows]))`),
	) as { variant: string; seller: string; product: string }[];
}
async function login(browser: Browser, role = "buyer") {
	const context = await browser.newContext(),
		page = await context.newPage(),
		kind = role === "buyer" ? "buyer" : "seller";
	await page.goto(`/en/auth/${kind}-sign-in`);
	await page.locator("[name=email]").fill(`phase11-${role}@example.test`);
	await page.locator("[name=password]").fill(fixturePassword);
	await page.locator(".account-card > form button[type=submit]").click();
	await expect(page).toHaveURL(new RegExp(`/account/${kind}$`));
	return { context, page };
}
async function builder(page: Page, lines = fixture()) {
	await clearCart(page);
	for (const l of lines) await addLine(page, l.variant, "2.000");
	await page.goto("/en/account/buyer/negotiations/new?currency=AFN");
	for (const l of lines) {
		const seller = page.locator(`section[data-seller="${l.seller}"]`);
		await seller
			.getByLabel("Offered unit price · AFN", { exact: true })
			.fill("10.00");
		await seller
			.getByLabel("Maximum unit price · AFN", { exact: true })
			.fill("15.00");
		await seller.getByLabel("Maximum quantity", { exact: true }).fill("4.000");
		await seller
			.getByRole("combobox", { name: "Country", exact: true })
			.selectOption("AF");
		await seller.getByLabel("City", { exact: true }).fill("Kabul");
		await seller
			.getByRole("combobox", { name: "Payment method", exact: true })
			.selectOption("advance");
	}
	await page.getByLabel(negotiationCopy.en.ack).check();
}
async function submit(page: Page) {
	const response = page.waitForResponse(
		(r) =>
			r.url().endsWith("/orders/buyer/negotiation-submissions/") &&
			r.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: "Submit requests", exact: true })
		.click();
	const result = await response;
	expect(result.status()).toBe(201);
	return result.json();
}
async function final(page: Page, id: string, seller: string) {
	await page.goto(`/en/account/seller/negotiations/${id}?seller=${seller}`);
	await page
		.getByLabel("Reason", { exact: true })
		.fill("Synthetic full-line seller finalization");
	const reviewed = page.waitForRequest(
		(r) =>
			r.url().endsWith(`/negotiations/${id}/finalize/review/`) &&
			r.method() === "POST",
	);
	await page
		.getByRole("button", {
			name: "Finalize and create accepted order",
			exact: true,
		})
		.click();
	const packet = (await reviewed).postDataJSON();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("finalization-total")).toContainText(
		"20.00 AFN",
	);
	const written = page.waitForRequest(
		(r) =>
			r.url().endsWith(`/negotiations/${id}/finalize/`) &&
			r.method() === "POST",
	);
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: negotiationCopy.en.finalize, exact: true })
		.click();
	expect((await written).postDataJSON()).toEqual(packet);
	await expect(
		page.getByText("Accepted", { exact: true }).first(),
	).toBeVisible();
}

test("P11 buyer multi-seller submit then seller finalizes accepted order and protected invoice", async ({
	browser,
}) => {
	const buyer = await login(browser),
		seller = await login(browser, "owner-a");
	try {
		await builder(buyer.page);
		const result = await submit(buyer.page);
		expect(result.outcomes).toHaveLength(2);
		expect(
			result.outcomes.every((x: { state: string }) => x.state === "submitted"),
		).toBe(true);
		const a = fixture()[0],
			outcome = result.outcomes.find(
				(x: { seller: string }) => x.seller === a.seller,
			);
		await final(seller.page, outcome.request, a.seller);
		const request = await (
			await buyer.page.request.get(
				`${apiOrigin}/api/v1/orders/buyer/negotiations/${outcome.request}/`,
			)
		).json();
		expect(request.state).toBe("accepted");
		expect(request.invoice).toBeTruthy();
		await buyer.page.goto(`/en/account/buyer/orders/${request.order}`);
		await expect(
			buyer.page.getByText(negotiationCopy.en.acceptedNotice, { exact: true }),
		).toBeVisible();
		await capture(buyer.page, "negotiation-accepted-order-en");
		await buyer.page.goto("/en/account/buyer/notifications");
		const notice = buyer.page.locator(
			`a[href*="/negotiations/${outcome.request}"]`,
		);
		await expect(notice).toContainText(negotiationCopy.en.accepted);
		await notice.click();
		await expect(buyer.page).toHaveURL(
			new RegExp(`/negotiations/${outcome.request}`),
		);

		const pdf = await buyer.page.request.get(
			`${apiOrigin}/api/v1/orders/buyer/invoices/${request.invoice}/pdf/?locale=fa-AF`,
		);
		expect(pdf.status()).toBe(200);
		expect(pdf.headers()["cache-control"]).toContain("no-store");
		expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
		expect(
			disposablePython(
				`from apps.orders.models import SellerOrder\nprint(SellerOrder.objects.filter(negotiation_id='${outcome.request}').count())`,
			).trim(),
		).toBe("1");
	} finally {
		await buyer.context.close();
		await seller.context.close();
	}
});

test("P11 correction, buyer lower maxima, over-limit rejection and deliberate withdrawal", async ({
	browser,
}) => {
	const buyer = await login(browser),
		seller = await login(browser, "owner-a"),
		a = fixture()[0];
	try {
		await builder(buyer.page, [a]);
		const result = await submit(buyer.page),
			id = result.outcomes[0].request;
		await seller.page.goto(
			`/en/account/seller/negotiations/${id}?seller=${a.seller}`,
		);
		await seller.page
			.getByRole("button", { name: "Request correction", exact: true })
			.click();
		await seller.page
			.getByRole("alertdialog")
			.getByLabel("Reason")
			.fill("Please revise the proposed binding limits");
		await seller.page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Confirm", exact: true })
			.click();
		await expect(
			seller.page.getByText("Correction requested", { exact: true }).first(),
		).toBeVisible();
		await buyer.page.goto(`/en/account/buyer/negotiations/${id}`);
		await buyer.page
			.getByLabel("Offered unit price · AFN", { exact: true })
			.fill("5.00");
		await buyer.page
			.getByLabel("Maximum unit price · AFN", { exact: true })
			.fill("6.00");
		await buyer.page
			.getByLabel("Reason", { exact: true })
			.fill("Buyer reduced the maximum price");
		await buyer.page.getByLabel(negotiationCopy.en.ack).check();
		await buyer.page
			.getByRole("button", { name: "Resubmit corrected request", exact: true })
			.click();
		await expect(
			buyer.page.getByText("Submitted", { exact: true }).first(),
		).toBeVisible();
		await buyer.page
			.getByRole("button", { name: "Withdraw request", exact: true })
			.click();
		await buyer.page
			.getByRole("alertdialog")
			.getByLabel("Reason")
			.fill("Buyer withdraws the unaccepted proposal");
		await buyer.page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Confirm", exact: true })
			.click();
		await expect(
			buyer.page.getByText("Withdrawn", { exact: true }).first(),
		).toBeVisible();
	} finally {
		await buyer.context.close();
		await seller.context.close();
	}
});

test("P11 lost finalization acknowledgement retains original UUID and reconciles once", async ({
	browser,
}) => {
	const buyer = await login(browser),
		seller = await login(browser, "owner-a"),
		a = fixture()[0];
	let key = "";
	try {
		await builder(buyer.page, [a]);
		const result = await submit(buyer.page),
			id = result.outcomes[0].request;
		await seller.page.route(
			`**/negotiations/${id}/finalize/`,
			async (route) => {
				key = route.request().postDataJSON().command_id;
				const response = await route.fetch();
				await route.fulfill({
					response,
					status: 429,
					contentType: "application/json",
					body: JSON.stringify({ error: { code: "synthetic_lost_ack" } }),
				});
			},
		);
		await seller.page.goto(
			`/en/account/seller/negotiations/${id}?seller=${a.seller}`,
		);
		await seller.page
			.getByLabel("Reason", { exact: true })
			.fill("Synthetic finalization acknowledgement loss");
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.finalize, exact: true })
			.click();
		await seller.page
			.getByRole("alertdialog")
			.getByRole("button", { name: negotiationCopy.en.finalize, exact: true })
			.click();
		await expect(
			seller.page.getByRole("button", {
				name: negotiationCopy.en.recover,
				exact: true,
			}),
		).toBeVisible();
		await expect(seller.page.getByRole("alertdialog")).toHaveCount(0);
		await expect(
			seller.page.getByRole("button", {
				name: negotiationCopy.en.recover,
				exact: true,
			}),
		).toBeEnabled();
		await expect(
			seller.page
				.getByRole("alert")
				.filter({ hasText: negotiationCopy.en.error }),
		).toBeFocused();
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.recover, exact: true })
			.focus();
		await expect(
			seller.page.getByRole("button", {
				name: negotiationCopy.en.recover,
				exact: true,
			}),
		).toBeFocused();
		await capture(seller.page, "negotiation-uncertain-en");
		seller.page.once("dialog", (d) => void d.accept());
		await seller.page.reload();
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.recover, exact: true })
			.click();
		await expect(
			seller.page.getByText("Accepted", { exact: true }).first(),
		).toBeVisible();
		expect(key).toBeTruthy();
		expect(
			disposablePython(
				`from apps.orders.models import NegotiationCommand,Invoice\nprint(NegotiationCommand.objects.filter(key='${key}').count(),Invoice.objects.filter(order__negotiation_id='${id}').count())`,
			).trim(),
		).toBe("1 1");
	} finally {
		await buyer.context.close();
		await seller.context.close();
	}
});

for (const locale of ["fa-AF", "ps", "ar", "en"] as Locale[])
	test(`P11 ${locale} builder mobile/desktop light/dark keyboard and editable limits`, async ({
		browser,
	}) => {
		const buyer = await login(browser),
			t = negotiationCopy[locale];
		try {
			await clearCart(buyer.page);
			await addLine(buyer.page, fixture()[0].variant, "2.000");
			await buyer.page.goto(
				`/${locale}/account/buyer/negotiations/new?currency=AFN`,
			);
			await expect(
				buyer.page.getByText(t.explanation, { exact: true }),
			).toBeVisible();
			for (const width of [390, 1440])
				for (const theme of ["light", "dark"]) {
					await buyer.page.setViewportSize({ width, height: 900 });
					await buyer.page.evaluate((t) => {
						document.documentElement.dataset.theme = t;
					}, theme);
					await buyer.page
						.getByLabel(`${t.maxPrice} · AFN`, { exact: true })
						.focus();
					await expect(
						buyer.page.getByLabel(`${t.maxPrice} · AFN`, { exact: true }),
					).toBeFocused();
					await noOverflow(buyer.page);
					await loadRenderedImages(buyer.page);
					if (process.env.PLAYWRIGHT_EVIDENCE_DIR)
						await buyer.page.screenshot({
							path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/negotiation-builder-${locale}-${width}-${theme}.png`,
							fullPage: true,
						});
				}
		} finally {
			await buyer.context.close();
		}
	});

async function capture(page: Page, name: string) {
	await noOverflow(page);
	await loadRenderedImages(page);
	if (process.env.PLAYWRIGHT_EVIDENCE_DIR)
		await page.screenshot({
			path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/${name}.png`,
			fullPage: true,
		});
}
for (const locale of ["fa-AF", "ps", "ar", "en"] as Locale[])
	test(`P11 ${locale} seller limits, confirmation focus and buyer terminal history`, async ({
		browser,
	}) => {
		const buyer = await login(browser),
			seller = await login(browser, "owner-a"),
			a = fixture()[0],
			t = negotiationCopy[locale];
		try {
			await builder(buyer.page, [a]);
			const result = await submit(buyer.page),
				id = result.outcomes[0].request;
			await seller.page.goto(
				`/${locale}/account/seller/negotiations/${id}?seller=${a.seller}`,
			);
			await expect(
				seller.page.getByLabel(`${t.offer} · AFN`, { exact: true }),
			).toBeVisible();
			const offer = seller.page.getByLabel(`${t.offer} · AFN`, { exact: true });
			await offer.fill("15.00");
			await offer.fill("16.00");
			await expect(
				seller.page.getByText(t.limits, { exact: false }).last(),
			).toContainText("15.00 AFN");
			await capture(seller.page, `negotiation-limits-error-${locale}`);
			await offer.fill("10.00");
			await expect(
				seller.page.getByText(t.limits, { exact: false }).last(),
			).toContainText("15.00 AFN");

			for (const [width, theme] of [
				[390, "light"],
				[1440, "dark"],
			] as const) {
				await seller.page.setViewportSize({ width, height: 900 });
				await seller.page.evaluate((t) => {
					document.documentElement.dataset.theme = t;
				}, theme);
				await capture(
					seller.page,
					`negotiation-seller-${locale}-${width}-${theme}`,
				);
			}
			await offer.fill("12.00");
			await seller.page.getByLabel(t.quantity, { exact: true }).fill("3.000");
			await seller.page.getByLabel(t.city, { exact: true }).fill("Herat");
			await seller.page
				.getByRole("combobox", { name: t.method, exact: true })
				.selectOption("cod");
			await seller.page
				.getByLabel(t.reason, { exact: true })
				.fill("Review exact final terms");
			await seller.page
				.getByRole("button", { name: t.finalize, exact: true })
				.click();
			const review = seller.page.getByRole("alertdialog", {
				name: t.finalize,
				exact: true,
			});
			await expect(review).toBeVisible();
			const original = review.getByRole("region", {
				name: t.original,
				exact: true,
			});
			const finalTerms = review.getByRole("region", {
				name: t.final,
				exact: true,
			});
			await expect(original).toContainText("2.000");
			await expect(original).toContainText("10.00 AFN");
			await expect(finalTerms).toContainText("3.000");
			await expect(finalTerms).toContainText("12.00 AFN");
			await expect(finalTerms).toContainText("4.000");
			await expect(finalTerms).toContainText("15.00 AFN");
			await expect(finalTerms).toContainText(/herat/i);
			await expect(finalTerms).toContainText(t.cod);
			await expect(review.getByTestId("finalization-total")).toContainText(
				"36.00 AFN",
			);
			for (const [width, theme] of [
				[390, "light"],
				[1440, "dark"],
			] as const) {
				await seller.page.setViewportSize({ width, height: 900 });
				await seller.page.evaluate((theme) => {
					document.documentElement.dataset.theme = theme;
				}, theme);
				await capture(
					seller.page,
					`negotiation-final-review-${locale}-${width}-${theme}`,
				);
			}
			await review.getByRole("button", { name: t.cancel, exact: true }).focus();
			await seller.page.keyboard.press("Tab");
			expect(
				await seller.page.evaluate(
					() => document.activeElement?.closest("dialog") !== null,
				),
			).toBe(true);
			await seller.page.keyboard.press("Escape");
			await expect(review).not.toBeVisible();
			await expect(
				seller.page.getByRole("button", { name: t.finalize, exact: true }),
			).toBeFocused();
			await expect(offer).toHaveValue("12.00");
			await seller.page
				.getByRole("button", { name: t.reject, exact: true })
				.click();
			const dialog = seller.page.getByRole("alertdialog");
			await expect(dialog).toBeVisible();
			await expect(dialog).toBeVisible();
			await expect(dialog.getByLabel(t.reason, { exact: true })).toBeVisible();
			await dialog
				.getByLabel(t.reason, { exact: true })
				.fill("Synthetic seller rejection, preserved history");
			await capture(seller.page, `negotiation-confirmation-${locale}`);
			await dialog.getByRole("button", { name: t.cancel, exact: true }).focus();
			await seller.page.keyboard.press("Tab");
			expect(
				await seller.page.evaluate(
					() => document.activeElement?.closest("dialog") !== null,
				),
			).toBe(true);
			await seller.page.keyboard.press("Escape");
			await expect(dialog).not.toBeVisible();
			await expect(
				seller.page.getByRole("button", { name: t.reject, exact: true }),
			).toBeFocused();
			await seller.page
				.getByRole("button", { name: t.reject, exact: true })
				.click();
			await expect(dialog).toBeVisible();
			await expect(dialog.getByLabel(t.reason, { exact: true })).toBeVisible();
			await dialog
				.getByLabel(t.reason, { exact: true })
				.fill("Synthetic seller rejection, preserved history");
			await dialog
				.getByRole("button", { name: t.confirm, exact: true })
				.click();
			await expect(
				seller.page.getByText(t.rejected, { exact: true }).first(),
			).toBeVisible();
			await buyer.page.goto(`/${locale}/account/buyer/negotiations/${id}`);
			await expect(
				buyer.page.getByText(t.readonly, { exact: true }),
			).toBeVisible();
			const history = buyer.page
				.locator("section")
				.filter({
					has: buyer.page.getByRole("heading", {
						name: t.history,
						exact: true,
					}),
				})
				.last();
			await history.locator("summary").first().click();
			for (const [width, theme] of [
				[390, "dark"],
				[1440, "light"],
			] as const) {
				await buyer.page.setViewportSize({ width, height: 900 });
				await buyer.page.evaluate((t) => {
					document.documentElement.dataset.theme = t;
				}, theme);
				await capture(
					buyer.page,
					`negotiation-terminal-${locale}-${width}-${theme}`,
				);
			}
		} catch (error) {
			await seller.page
				.screenshot({
					path: `${process.env.PLAYWRIGHT_EVIDENCE_DIR}/negotiation-failed-seller-${locale}.png`,
					fullPage: true,
				})
				.catch(() => {});
			await test
				.info()
				.attach("seller-dialog-state", {
					body: JSON.stringify(
						await seller.page.evaluate(() => ({
							url: location.href,
							focus: document.activeElement?.tagName,
							dialogs: [...document.querySelectorAll("dialog")].map((d) => ({
								open: d.open,
								text: d.textContent?.slice(0, 500),
							})),
						})),
					),
					contentType: "application/json",
				})
				.catch(() => {});
			throw error;
		} finally {
			await buyer.context.close();
			await seller.context.close();
		}
	});

test("P11 A-to-B-to-A business switch fences delayed old preview failure and dirty draft", async ({
	browser,
}) => {
	const buyer = await login(browser),
		seller = await login(browser, "owner-a"),
		all = fixture(),
		a = all[0],
		b = all[1];
	let release: () => void = () => {},
		arrived: () => void = () => {};
	const held = new Promise<void>((r) => {
			release = r;
		}),
		started = new Promise<void>((r) => {
			arrived = r;
		});
	try {
		disposablePython(
			`from apps.organizations.models import Membership\nfrom apps.accounts.models import Account\na=Account.objects.get(user__email='phase11-owner-a@example.test',context='seller')\nMembership.objects.get_or_create(company_id='${b.seller}',account=a,defaults={'bundles':['orders_negotiation']})`,
		);
		await builder(buyer.page);
		const result = await submit(buyer.page),
			id = result.outcomes.find(
				(x: { seller: string }) => x.seller === a.seller,
			).request;
		await seller.page.goto(
			`/en/account/seller/negotiations/${id}?seller=${a.seller}`,
		);
		await seller.page
			.getByLabel("Reason", { exact: true })
			.fill("Draft owned by business A");
		await seller.page.route(
			`**/negotiations/${id}/finalize/review/`,
			async (route) => {
				arrived();
				await held;
				await route
					.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ error: { code: "synthetic_old_failure" } }),
					})
					.catch(() => {});
			},
			{ times: 1 },
		);
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.finalize, exact: true })
			.click();
		await started;
		await seller.page
			.getByRole("combobox", { name: /Seller business/ })
			.selectOption(b.seller);
		await seller.page.getByRole("alert").getByRole("button").first().click();
		await expect(seller.page).toHaveURL(new RegExp(`seller=${b.seller}`));
		await seller.page
			.getByRole("combobox", { name: /Seller business/ })
			.selectOption(a.seller);
		await seller.page.locator(`a[href*="/negotiations/${id}"]`).first().click();
		await expect(seller.page.getByLabel("Reason", { exact: true })).toHaveValue(
			"",
		);
		release();
		await expect(
			seller.page.getByRole("button", {
				name: negotiationCopy.en.finalize,
				exact: true,
			}),
		).toBeEnabled();
		await expect(
			seller.page.getByTestId("negotiation-workspace").getByRole("alert"),
		).toHaveCount(0);
		await seller.page
			.getByLabel("Reason", { exact: true })
			.fill("Fresh A instance remains writable");
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.finalize, exact: true })
			.click();
		await expect(seller.page.getByRole("alertdialog")).toBeVisible();
	} finally {
		release();
		await buyer.context.close();
		await seller.context.close();
	}
});

test("P11 partial seller submission survives refresh and resumes only its pending sibling", async ({
	browser,
}) => {
	const buyer = await login(browser),
		a = fixture()[0];
	let parent = "",
		key = "";
	try {
		await builder(buyer.page);
		await buyer.page.route(
			"**/orders/buyer/negotiation-submissions/",
			async (route) => {
				const body = route.request().postDataJSON();
				key = body.command_id;
				const result = JSON.parse(
					disposablePython(
						`import json\nfrom apps.accounts.models import User\nfrom apps.messaging.management.commands.seed_messaging_examples import actor\nfrom apps.orders import negotiations as n\nfrom apps.orders.negotiation_contracts import SubmissionCommand\np=SubmissionCommand(data=json.loads(${JSON.stringify(JSON.stringify(body))}))\np.is_valid(raise_exception=True)\nbuyer=actor(User.objects.get(email='phase11-buyer@example.test'),'buyer')\nsub=n.create_submission(buyer,p.validated_data)\no=sub.outcomes.get(seller_id='${a.seller}')\nn.create_seller(buyer,sub,o.pk)\nprint(json.dumps(n.submission_data(sub)))`,
					),
				);
				parent = result.id;
				await route.fulfill({
					status: 202,
					contentType: "application/json",
					body: JSON.stringify(result),
				});
			},
			{ times: 1 },
		);
		const response = buyer.page.waitForResponse(
			(r) =>
				r.url().endsWith("/orders/buyer/negotiation-submissions/") &&
				r.request().method() === "POST",
		);
		await buyer.page
			.getByRole("button", { name: negotiationCopy.en.submit, exact: true })
			.click();
		expect((await response).status()).toBe(202);
		await expect(buyer.page).toHaveURL(/negotiation_command=/);
		await expect(
			buyer.page.getByRole("button", {
				name: "Resume pending sellers",
				exact: true,
			}),
		).toBeVisible();
		buyer.page.once("dialog", (d) => void d.accept());
		await buyer.page.reload();
		await buyer.page
			.getByRole("button", { name: negotiationCopy.en.recover, exact: true })
			.click();
		await expect(
			buyer.page.getByRole("button", {
				name: "Resume pending sellers",
				exact: true,
			}),
		).toBeVisible();
		await buyer.page
			.getByRole("button", { name: "Resume pending sellers", exact: true })
			.click();
		await expect(
			buyer.page.getByRole("button", {
				name: "Resume pending sellers",
				exact: true,
			}),
		).toHaveCount(0);
		await expect(buyer.page).not.toHaveURL(/negotiation_command=/);
		expect(
			disposablePython(
				`from apps.orders.models import NegotiationSubmission,Negotiation\nprint(NegotiationSubmission.objects.filter(key='${key}').count(),Negotiation.objects.filter(outcome__submission_id='${parent}').count())`,
			).trim(),
		).toBe("1 2");
	} finally {
		await buyer.context.close();
	}
});

test("P11 stale seller preview preserves entered terms, reports conflict and reloads terminal history", async ({
	browser,
}) => {
	const buyer = await login(browser),
		seller = await login(browser, "owner-a"),
		a = fixture()[0];
	try {
		await builder(buyer.page, [a]);
		const price = buyer.page.getByLabel("Offered unit price · AFN", {
				exact: true,
			}),
			cap = buyer.page.getByLabel("Maximum unit price · AFN", { exact: true });
		await price.fill("15.00");
		await price.fill("16.00");
		await expect(cap).toHaveValue("15.00");
		await price.fill("10.00");
		await buyer.page.getByLabel(negotiationCopy.en.ack).check();
		const result = await submit(buyer.page),
			id = result.outcomes[0].request;
		await seller.page.goto(
			`/en/account/seller/negotiations/${id}?seller=${a.seller}`,
		);
		await seller.page
			.getByLabel("Offered unit price · AFN", { exact: true })
			.fill("9.00");
		await seller.page
			.getByLabel("Reason", { exact: true })
			.fill("Synthetic stale seller draft");
		await buyer.page.goto(`/en/account/buyer/negotiations/${id}`);
		await buyer.page
			.getByRole("button", { name: negotiationCopy.en.withdraw, exact: true })
			.click();
		await buyer.page
			.getByRole("alertdialog")
			.getByLabel("Reason", { exact: true })
			.fill("Buyer withdraws before stale seller preview");
		await buyer.page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Confirm", exact: true })
			.click();
		await expect(
			buyer.page.getByText("Withdrawn", { exact: true }).first(),
		).toBeVisible();
		const response = seller.page.waitForResponse((r) =>
			r.url().endsWith(`/negotiations/${id}/finalize/review/`),
		);
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.finalize, exact: true })
			.click();
		expect((await response).status()).toBe(409);
		await expect(
			seller.page.getByTestId("negotiation-workspace").getByRole("alert"),
		).toContainText("409");
		await expect(
			seller.page.getByLabel("Offered unit price · AFN", { exact: true }),
		).toHaveValue("9.00");
		await capture(seller.page, "negotiation-conflict-en");
		await seller.page
			.getByRole("button", { name: negotiationCopy.en.reload, exact: true })
			.click();
		await seller.page.getByRole("alert").getByRole("button").first().click();
		await expect(
			seller.page.getByText(negotiationCopy.en.readonly, { exact: true }),
		).toBeVisible();
		expect(
			disposablePython(
				`from apps.orders.models import Invoice\nprint(Invoice.objects.filter(order__negotiation_id='${id}').count())`,
			).trim(),
		).toBe("0");
	} finally {
		await buyer.context.close();
		await seller.context.close();
	}
});
