import { expect, type Page } from "@playwright/test";
import { modalScreens } from "../../lib/routes/auth-routes";
import type { AuthScreen } from "../../lib/i18n/auth-screens";

/** Change a visitor preference through whichever real control the page offers. */
export async function choosePreference(
	page: Page,
	label: string,
	value: string,
) {
	// Visual checks may arrive through a legacy auth URL. Change background
	// preferences through its real UI, then reopen the same modal entry.
	const modal = page.getByRole("dialog");
	const url = new URL(page.url());
	const entry = url.searchParams.get("auth") ?? url.pathname.split("/auth/")[1];
	if (modalScreens.includes(entry as AuthScreen))
		await expect(modal).toBeVisible();
	const reopen = (await modal.isVisible()) ? page.url() : null;
	if (reopen) {
		await page.keyboard.press("Escape");
		await expect(modal).toHaveCount(0);
	}
	// A closed seller drawer keeps a hidden copy of the same selects, so the
	// header instance is addressed explicitly instead of page-wide.
	const header = page.locator("header");
	const select = header.getByLabel(label, { exact: true });
	const details = header.locator("details").filter({ has: select });
	const drawer = page.locator('nav button[aria-haspopup="dialog"]');
	const choose = async (control: typeof select) => {
		if (await control.evaluate((element) => element.tagName === "SELECT"))
			await control.selectOption(value);
		else {
			await control.click();
			await page
				.getByRole("option")
				.and(page.locator(`button[value="${value}"]`))
				.click();
		}
	};
	if (await select.isVisible()) await choose(select);
	else if (await details.count()) {
		await details.locator("summary").click();
		await select.selectOption(value);
	} else {
		// Below the seller desktop breakpoint the header controls move to the drawer.
		await drawer.click();
		await choose(page.getByRole("dialog").getByLabel(label, { exact: true }));
		await page.keyboard.press("Escape");
	}
	if ((await details.count()) && (await details.locator("summary").isVisible()))
		await details.locator("summary").press("Escape");
	if (reopen) {
		await page.goto(reopen);
		await expect(page.getByRole("dialog")).toBeVisible();
	}
}
