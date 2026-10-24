import type { Page } from "@playwright/test";

/** Open the real compact-header disclosure before changing a visitor preference. */
export async function choosePreference(
	page: Page,
	label: string,
	value: string,
) {
	const select = page.getByLabel(label, { exact: true });
	const details = page.locator("header details").filter({ has: select });
	if (!(await select.isVisible())) await details.locator("summary").click();
	await select.selectOption(value);
	if ((await details.count()) && (await details.locator("summary").isVisible()))
		await details.locator("summary").press("Escape");
}
