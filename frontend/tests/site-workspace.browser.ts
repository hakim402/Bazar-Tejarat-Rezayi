import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
	apiOrigin as api,
	disposablePython,
	fixturePassword as password,
} from "./support/identity-runtime";
test.skip(
	process.env.SITE_BROWSER_TESTS !== "1",
	"Requires maintained isolated harness.",
);
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
async function owner(page: Page) {
	const email = `workspace-${randomBytes(5).toString("hex")}@example.test`;
	disposablePython(
		"import json,sys\nfrom apps.accounts.models import User\nd=json.load(sys.stdin);User.objects.create_superuser(d['email'],d['password'],email_verified=True)",
		JSON.stringify({ email, password }),
	);
	await page.goto(`${api}/admin/login/`);
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page
		.getByRole("button", { name: "Set up authenticator", exact: true })
		.click();
	const otp = disposablePython(
		"import sys,json,time\nfrom apps.accounts.models import Authenticator\nfrom django_otp.oath import TOTP\nd=Authenticator.objects.get(user__email=json.load(sys.stdin)['email']);t=TOTP(d.secret);t.time=time.time();print(f'{t.token():06}')",
		JSON.stringify({ email }),
	).trim();
	await page.getByLabel("Authenticator or recovery code").fill(otp);
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await page
		.getByRole("link", {
			name: "I saved my codes — continue to administration",
		})
		.click();
}
async function containment(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
}

test("Site Setting libraries, private drafts, video publication, selection and deletion", async ({
	page,
}) => {
	test.setTimeout(240000);
	await owner(page);
	for (const section of [
		"general",
		"branding",
		"contacts",
		"hero",
		"promotions",
		"announcement",
		"maintenance",
		"seo",
	]) {
		await page.goto(`${api}/admin/site-setting/${section}/`);
		await expect(
			page.getByRole("button", { name: "Save draft", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Publish", exact: true }),
		).toBeVisible();
		await containment(page);
	}
	await page.goto(`${api}/admin/site-setting/hero/`);
	await expect(page.locator('[name="site-hero_mode"] option')).toHaveCount(2);
	await page.screenshot({
		path: `${evidence}/workspace-hero-desktop.png`,
		fullPage: true,
	});
	const video = disposablePython(
		"import tempfile,subprocess,os\nfrom pathlib import Path\np=Path(os.environ['REZAYI_TEST_ROOT'])/'workspace-demo.mp4'\nsubprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=0x0270d2:s=640x360:d=3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(p)],check=True,capture_output=True)\nprint(str(p))",
	).trim();
	await page.goto(`${api}/admin/site-setting/promotions/new/`);
	await page.locator('[name="post-label"]').fill("DEMO video promotion");
	await page.locator('[name="post-kind"]').selectOption("video");
	await page.locator('[name="post-video_file"]').setInputFiles(video);
	await page.locator('[name="post-source_url"]').fill("/about");
	await page.locator('[name="post-fa-AF_alt"]').fill("ویدیوی آزمایشی");
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await expect(
		page.getByText("Draft saved. The public version is unchanged."),
	).toBeVisible();
	const promotionId = page.url().split("/").filter(Boolean).at(-1);
	if (!promotionId) throw new Error("Published post has no ID");
	let payload = await (
		await page.request.get(`${api}/api/v1/site/public/en/`)
	).json();
	expect(payload.hero.cards).toHaveLength(0);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByText("Published successfully.")).toBeVisible();
	await page.screenshot({
		path: `${evidence}/workspace-video-editor.png`,
		fullPage: true,
	});
	await page.goto(`${api}/admin/site-setting/promotions/`);
	await page.locator('[name="site-promotion_one"]').selectOption(promotionId);
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	payload = await (
		await page.request.get(`${api}/api/v1/site/public/en/`)
	).json();
	expect(payload.hero.cards).toHaveLength(0);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	payload = await (
		await page.request.get(`${api}/api/v1/site/public/en/`)
	).json();
	expect(payload.hero.cards).toHaveLength(1);
	expect(payload.hero.cards[0].kind).toBe("video");
	expect(payload.hero.cards[0].cta_label).toBe("");
	disposablePython(
		"from apps.site.models import HeroSlide,HeroLocale,SiteSettings\nsource=HeroSlide.objects.get(label='DEMO video promotion',draft_of__isnull=True)\nslide=HeroSlide.objects.create(settings_id=1,placement='main',kind='video',enabled=True,label='DEMO main video',video=source.video,poster=source.poster,source_url='/about')\nfor row in source.locales.all(): HeroLocale.objects.create(slide=slide,locale=row.locale,alt=row.alt)\nSiteSettings.objects.filter(pk=1).update(hero_mode='video_carousel')",
	);
	for (const locale of ["fa-AF", "en", "ps", "ar"]) {
		await page.goto(`/${locale}`);
		const mainVideo = page.locator("main section").first();
		await expect(mainVideo.locator("video")).toHaveCount(1);
		await expect(mainVideo.locator("a")).toHaveAttribute(
			"href",
			`/${locale}/about`,
		);
		expect(
			await mainVideo
				.locator("h1")
				.evaluate((element) =>
					element.parentElement?.classList.contains("sr-only"),
				),
		).toBe(true);
		const videoCard = page
			.locator("main article")
			.filter({ has: page.locator("video") });
		await expect(videoCard.locator("video")).toHaveCount(1);
		await expect(videoCard.locator("h2")).toHaveCount(0);
		await expect(videoCard.locator("a")).toHaveAttribute(
			"href",
			`/${locale}/about`,
		);
		await expect
			.poll(() =>
				videoCard
					.locator("video")
					.evaluate((element: HTMLVideoElement) => element.readyState >= 2),
			)
			.toBe(true);
		await videoCard
			.locator("video")
			.evaluate((element: HTMLVideoElement) => element.play());
		await expect
			.poll(() =>
				videoCard
					.locator("video")
					.evaluate((element: HTMLVideoElement) => element.currentTime),
			)
			.toBeGreaterThan(0);
		await videoCard.locator("a").click();
		await expect(page).toHaveURL(new RegExp(`/${locale}/about$`));
	}
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto(`${api}/admin/site-setting/promotions/`);
	await containment(page);
	await page.screenshot({
		path: `${evidence}/workspace-promotions-mobile.png`,
		fullPage: true,
	});
	await page.goto(
		`${api}/admin/site-setting/promotions/${promotionId}/delete/`,
	);
	await page
		.getByRole("button", { name: "Delete permanently", exact: true })
		.click();
	payload = await (
		await page.request.get(`${api}/api/v1/site/public/en/`)
	).json();
	expect(payload.hero.cards).toHaveLength(0);
	disposablePython(
		"from apps.site.models import HeroSlide,SiteSettings\nHeroSlide.objects.filter(placement='main').delete()\nSiteSettings.objects.filter(pk=1).update(hero_mode='video_carousel',promotion_one=None,promotion_two=None)",
	);
	for (const locale of ["fa-AF", "en", "ps", "ar"]) {
		await page.goto(`/${locale}`);
		await expect(
			page.locator("main section").first().locator("img"),
		).toHaveAttribute("src", "/images/marketplace/hero.webp");
		await expect(
			page.locator("main aside").filter({ has: page.locator("article") }),
		).toHaveCount(0);
		await containment(page);
	}
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto("/en");
	await page.screenshot({
		path: `${evidence}/workspace-default-full-width.png`,
		fullPage: true,
	});
});
