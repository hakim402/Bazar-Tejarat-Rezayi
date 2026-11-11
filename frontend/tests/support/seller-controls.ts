import { expect, type Page } from "@playwright/test";

/** Exercise the current accessible seller control without native-select assumptions. */
export async function selectControl(page: Page, label: string, value: string) {
	const control = page.getByRole("combobox", { name: label, exact: true });
	await expect(control).toBeVisible();
	if (await control.evaluate((element) => element.tagName === "SELECT")) {
		await control.selectOption(value);
	} else {
		await control.click();
		await page.locator(`[role="option"][value="${value}"]`).click();
	}
}
