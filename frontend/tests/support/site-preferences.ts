import { expect, type Page } from "@playwright/test";
import { modalScreens } from "../../lib/routes/auth-routes";
import type { AuthScreen } from "../../lib/i18n/auth-screens";

/** Open the real compact-header disclosure before changing a visitor preference. */
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
	const select = page.getByLabel(label, { exact: true });
	const details = page.locator("header details").filter({ has: select });
	if (!(await select.isVisible())) await details.locator("summary").click();
	await select.selectOption(value);
	if ((await details.count()) && (await details.locator("summary").isVisible()))
		await details.locator("summary").press("Escape");
	if (reopen) {
		await page.goto(reopen);
		await expect(page.getByRole("dialog")).toBeVisible();
	}
}
