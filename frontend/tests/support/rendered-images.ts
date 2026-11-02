import { expect, type Page } from "@playwright/test";
export async function loadRenderedImages(page: Page) {
	const position = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
	try {
		// A native modal makes the background inert and locks body scrolling.
		// Its background images were inspected before opening the overlay.
		const modal = page.getByRole("dialog");
		const surface = (await modal.isVisible()) ? modal : page.locator("body");
		for (const image of await surface.locator("img").all()) {
			if (!(await image.isVisible())) continue;
			await image.scrollIntoViewIfNeeded();
			await expect
				.poll(
					() =>
						image.evaluate(
							(node) =>
								(node as HTMLImageElement).complete &&
								(node as HTMLImageElement).naturalWidth > 0,
						),
					{
						message: "Rendered image must decode after entering the viewport",
						timeout: 10000,
					},
				)
				.toBe(true);
		}
	} finally {
		await page.evaluate(({ x, y }) => window.scrollTo(x, y), position);
	}
}
