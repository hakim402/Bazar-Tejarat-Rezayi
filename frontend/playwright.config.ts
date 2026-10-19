import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests",
	testMatch: "*.browser.ts",
	fullyParallel: false,
	workers: 1,
	timeout: 30000,
	outputDir: "../doc/progress/phase-02-foundation/browser-results",
	reporter: [["list"]],
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
		browserName: "chromium",
		channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
		headless: true,
	},
});
