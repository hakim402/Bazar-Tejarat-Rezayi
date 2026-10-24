import { choosePreference } from "./support/site-preferences";
import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
	apiOrigin as api,
	disposablePython,
	fixturePassword as password,
} from "./support/identity-runtime";
import { pageKeys, pages } from "../features/pages/registry";
import { pageCopy } from "../features/pages/copy";
import { messages } from "../lib/i18n/messages";
import { heroUI } from "../features/site/ui";
import { storefrontCopy } from "../features/storefront/copy";
import { categories, demoProducts } from "../features/storefront/data";
const evidence = process.env.PLAYWRIGHT_EVIDENCE_DIR;
test.skip(
	process.env.SITE_BROWSER_TESTS !== "1",
	"Requires maintained isolated native harness.",
);
function configure(options: Record<string, unknown> = {}) {
	disposablePython(
		`import sys,json
from apps.site.models import SiteSettings,HeroSlide,HeroLocale,SiteLocale
from apps.site.defaults import TEXT
from apps.foundation.contracts import BRAND_NAMES
from pathlib import Path
import os
d=json.load(sys.stdin)
s=SiteSettings.objects.get(pk=1)
s.default_locale=d.get('locale','fa-AF');s.default_theme=d.get('theme','system');s.maintenance_enabled=d.get('maintenance',False);s.announcement_enabled=d.get('announcement',False);s.hero_mode=d.get('mode','image_carousel');s.hero_rotate=d.get('rotate',False);s.hero_autoplay=d.get('autoplay',False);s.hero_interval=5;s.promotion_one=None;s.promotion_two=None;s.save()
for code,values in TEXT.items():
 SiteLocale.objects.filter(locale=code).update(name=BRAND_NAMES[code],description=values[1],announcement='DEMO announcement' if code=='en' else 'اعلان آزمایشی',maintenance_title=values[4],maintenance_message=values[5])
HeroSlide.objects.update(enabled=False)
original=HeroSlide.objects.filter(bundled_image=True,kind='image',placement='main',is_draft=False).first()
if original is None: original=HeroSlide.objects.create(settings=s,bundled_image=True)
original.enabled=True;original.position=0;original.save()
for code,values in TEXT.items():
 HeroLocale.objects.update_or_create(slide=original,locale=code,defaults=dict(title=values[0],description=values[1],alt=values[3],cta_label=values[2],cta_url='/how-it-works'))
if 'carousel' in s.hero_mode:
 second=HeroSlide.objects.create(settings=s,enabled=True,bundled_image=True,position=1)
 for code,values in TEXT.items(): HeroLocale.objects.create(slide=second,locale=code,title=values[0]+' · 2',description=values[1],alt=values[3],cta_label=values[2],cta_url='/help')
if 'video' in s.hero_mode:
 import tempfile,subprocess,io
 from django.core.files.uploadedfile import SimpleUploadedFile
 from apps.site.media import store_upload
 from PIL import Image
 with tempfile.TemporaryDirectory(prefix='site-browser-') as tmp:
  video=Path(tmp)/'demo.mp4'
  subprocess.run(['ffmpeg','-y','-f','lavfi','-i','color=c=0x0270d2:s=640x360:d=3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True,capture_output=True)
  media=store_upload(SimpleUploadedFile('DEMO.mp4',video.read_bytes()),'video',[])
 output=io.BytesIO();Image.new('RGB',(640,360),'#0270d2').save(output,'PNG');poster=store_upload(SimpleUploadedFile('DEMO.png',output.getvalue()),'image',[])
 for slide in HeroSlide.objects.filter(enabled=True):
  slide.kind='video';slide.bundled_image=False;slide.video=media;slide.poster=poster;slide.source_url='/about';slide.save()
if d.get('fallback'): HeroLocale.objects.filter(slide__enabled=True,locale='en').update(title='')
path=Path(os.environ['REZAYI_TEST_ROOT'])/'site-fault'
if d.get('fault'): path.write_text(d['fault'])
elif path.exists(): path.unlink()
`,
		JSON.stringify(options),
	);
}
test.beforeEach(() => configure());
test.afterEach(() => configure());
async function containment(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
}
for (const locale of ["fa-AF", "en", "ps", "ar"] as const)
	test(`${locale}: every fixed page, legal notice, help and metadata`, async ({
		page,
	}) => {
		test.setTimeout(120000);
		for (const key of pageKeys) {
			const response = await page.goto(`/${locale}${pages[key].path}`);
			expect(response?.status(), key).toBe(200);
			await expect(page.locator("h1")).toHaveCount(1);
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
				"href",
				`https://bazartejaratrezayi.com/${locale}${pages[key].path}`,
			);
			await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(
				4,
			);
			await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
				"content",
				/noindex/,
			);
		}
		await page.goto(`/${locale}/terms`);
		await expect(page.locator("h1")).toHaveText(pageCopy[locale].terms.title);
		await expect(page.locator("#development-sample")).toBeVisible();
		await containment(page);
		await page.screenshot({
			path: `${evidence}/site-terms-${locale}.png`,
			fullPage: true,
		});
		for (const width of [320, 390, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`/${locale}`);
			await containment(page);
			for (const theme of ["light", "dark"]) {
				await choosePreference(page, messages[locale].theme, theme);
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
				await page.screenshot({
					path: `${evidence}/site-home-${locale}-${width}-${theme}.png`,
					fullPage: true,
				});
			}
		}
	});
test("real 404 retirement boundaries, empty commerce, guide-only search and robots", async ({
	page,
}) => {
	for (const path of [
		"/en/products",
		"/en/future.svg",
		"/en/help/future.topic",
		"/en/auth/unknown",
		"/en/account/buyer/unknown",
		"/en/catalogue-preview/invalid",
		"/en/checkout",
		"/en/stores/example",
		"/en/help/future",
		"/en/account/staff/content/about",
	])
		expect((await page.goto(path))?.status()).toBe(404);
	expect(
		(await page.request.get(`${api}/api/v1/content/public/en/home/`)).status(),
	).toBe(404);
	await page.goto("/en");
	await expect(page.locator("main")).toContainText(
		"Public shopping is not available yet",
	);
	await page.goto("/en/help");
	const search = page.locator("main input[type=search]");
	await search.fill("verification");
	await expect(page.locator("main article")).toHaveCount(1);
	await search.fill("zzzzz");
	await expect(page.locator("main article")).toHaveCount(0);
	expect(await (await page.request.get("/robots.txt")).text()).toContain(
		"Disallow: /",
	);
	expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(
		"/en/products",
	);
});
test("private account, authentication, invitation and preview stay noindex in every locale", async ({
	request,
}) => {
	for (const locale of ["fa-AF", "en", "ps", "ar"]) {
		for (const path of [
			"/account/buyer",
			"/account/seller",
			"/account/staff",
			"/auth/buyer-sign-in",
			"/invitation",
		]) {
			const response = await request.get(`/${locale}${path}`);
			expect(response.status()).toBe(200);
			expect(await response.text()).toMatch(
				/name="robots" content="noindex, nofollow"/,
			);
		}
		expect(
			(
				await request.get(
					`/${locale}/catalogue-preview/00000000-0000-0000-0000-000000000000`,
				)
			).status(),
		).toBe(404);
	}
});
test("default locale/theme, visitor precedence, explicit URLs and fallback", async ({
	page,
}) => {
	configure({ locale: "ar", theme: "dark", fallback: true });
	await page.goto("/");
	await expect(page).toHaveURL("/ar");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.goto("/en");
	await expect(page.locator("main")).toContainText("Dari fallback");
	await choosePreference(page, messages.en.theme, "light");
	await page.emulateMedia({ colorScheme: "dark" });
	expect(
		await page
			.locator("body")
			.evaluate((el) => getComputedStyle(el).backgroundColor),
	).toBe("rgb(244, 247, 250)");
	await choosePreference(page, messages.en.language, "ps");
	await expect(page).toHaveURL("/ps");
	await page.goto("/");
	await expect(page).toHaveURL("/ps");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.goto(`${api}/admin/login/`);
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
for (const mode of ["image_carousel", "video_carousel"])
	test(`${mode}: media order, manual controls, seek and reduced motion`, async ({
		page,
	}) => {
		test.setTimeout(90000);
		configure({ mode, rotate: true, autoplay: true });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/en");
		await expect(page.locator("h1")).toBeVisible();
		if (mode.includes("video")) {
			const video = page.locator("video");
			await expect(video).toHaveCount(1);
			expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(
				true,
			);
			await expect
				.poll(() =>
					video.evaluate((el: HTMLVideoElement) =>
						Number.isFinite(el.duration),
					),
				)
				.toBe(true);
			await video.evaluate((el: HTMLVideoElement) => {
				el.currentTime = 1;
			});
			await expect
				.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
				.toBeGreaterThanOrEqual(1);
			const url = await video.getAttribute("src");
			const range = await page.request.get(url ?? "", {
				headers: { Range: "bytes=0-31" },
			});
			expect(range.status()).toBe(206);
			expect(range.headers()["content-type"]).toContain("video/mp4");
			expect((await range.body()).length).toBe(32);
			expect(
				(await page.request.head(url ?? "")).headers()["accept-ranges"],
			).toBe("bytes");
		}
		if (mode.includes("carousel")) {
			await page
				.getByRole("button", { name: heroUI.en.next, exact: true })
				.focus();
			await page.keyboard.press("Enter");
			await expect(page.locator("main fieldset button").nth(1)).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(
				await page
					.locator("main a")
					.filter({ hasText: "How it works" })
					.count(),
			).toBeLessThan(4);
			if (mode.includes("video"))
				await expect(page.locator("video")).toHaveCount(1);
		}
		await containment(page);
		await page.screenshot({
			path: `${evidence}/site-${mode}.png`,
			fullPage: true,
		});
	});
test("native video pauses outside its media viewport and on visibility changes", async ({
	page,
}) => {
	configure({ mode: "video_carousel", autoplay: true });
	await page.goto("/en");
	const video = page.locator("video");
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
		.toBe(false);
	await page.locator("footer").scrollIntoViewIfNeeded();
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
		.toBe(true);
	await video.scrollIntoViewIfNeeded();
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
		.toBe(false);
	// Deterministic hidden-document signal; native playback itself runs in Chromium.
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => true,
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
		.toBe(true);
});
test("rotation pauses on focus, refuses autoplay safely, and broken image keeps heading", async ({
	page,
}) => {
	configure({ mode: "image_carousel", rotate: true });
	await page.goto("/en");
	await page.getByRole("button", { name: heroUI.en.next, exact: true }).focus();
	await expect(
		page.getByRole("button", { name: heroUI.en.play, exact: true }),
	).toBeVisible();
	await page.waitForTimeout(5200);
	await expect(page.locator("h1")).not.toContainText("2");
	await page.route("**/images/marketplace/hero.webp", (route) => route.abort());
	await page.reload();
	await expect(page.locator("h1")).toBeVisible();
	await expect(
		page
			.locator("main")
			.getByRole("link", { name: "How it works", exact: true })
			.first(),
	).toBeVisible();
	await page.unrouteAll();
	configure({ mode: "video_carousel", autoplay: true });
	await page.addInitScript(() => {
		HTMLMediaElement.prototype.play = () =>
			Promise.reject(new DOMException("Synthetic refusal", "NotAllowedError"));
	});
	await page.goto("/en");
	await expect(page.locator("video")).toHaveAttribute("controls", "");
	await expect(page.locator("h1")).toBeVisible();
});
test("maintenance, malformed/unavailable authority, recovery and unaffected auth/health", async ({
	page,
}) => {
	test.setTimeout(90000);
	for (const state of [
		{ maintenance: true },
		{ fault: "invalid" },
		{ fault: "unavailable" },
	]) {
		configure(state);
		const response = await page.goto("/en/about");
		expect(response?.status()).toBe(503);
		expect(response?.headers()["retry-after"]).toBe("300");
		expect(response?.headers()["x-robots-tag"]).toContain("noindex");
		await expect(page.locator("h1")).toBeVisible();
		expect(
			(await page.request.get(`${api}/api/v1/health/live/`)).status(),
		).toBe(200);
		expect((await page.goto("/en/auth/buyer-sign-in"))?.status()).toBe(200);
	}
	configure({ maintenance: true });
	await page.goto("/fa-AF");
	await page.screenshot({
		path: `${evidence}/site-maintenance.png`,
		fullPage: true,
	});
	configure();
	expect((await page.goto("/en/about"))?.status()).toBe(200);
});
test("owner full-width Settings sections preserve scope, conflicts, uploads and navigation", async ({
	page,
}) => {
	test.setTimeout(240000);
	configure();
	const email = `site-owner-${randomBytes(5).toString("hex")}@example.test`;
	disposablePython(
		"import json,sys\nfrom apps.accounts.models import User\nd=json.load(sys.stdin);User.objects.create_superuser(d['email'],d['password'],email_verified=True,display_name='DEMO Site Owner')",
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
	const admin = (section = "") =>
		`${api}/admin/site-setting/${section ? `${section}/` : ""}`;
	const editor = () => page.getByTestId("site-settings-editor");
	const save = async (_name: string) => {
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await expect(
			page.getByText("Published. Changes apply to the next public request."),
		).toBeVisible();
	};
	const publicSettings = async () =>
		(await page.request.get(`${api}/api/v1/site/public/en/`)).json();
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto(admin());
	await expect(page).toHaveURL(admin("general"));
	await expect(editor()).toBeVisible();
	await expect(page.getByTestId("settings-overview")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "All settings", exact: true }),
	).toHaveCount(0);
	await expect(editor().getByRole("navigation")).toHaveCount(0);
	const sidebar = page.locator("#nav-sidebar-apps");
	await expect(sidebar.getByRole("heading").last()).toHaveAccessibleName(
		"Site Setting",
	);
	await expect(
		sidebar.getByRole("link").filter({ hasText: "All settings" }),
	).toHaveCount(0);
	expect(
		await editor().evaluate((element) => getComputedStyle(element).maxWidth),
	).toBe("none");
	expect(
		await page
			.locator("#site-settings-form")
			.evaluate((element) =>
				Math.abs(
					element.getBoundingClientRect().width -
						(element.parentElement?.getBoundingClientRect().width ?? 0),
				),
			),
	).toBeLessThan(2);
	const settingsToggle = page
		.locator("#nav-sidebar-apps")
		.getByRole("button", { name: "Site Setting", exact: true });
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
	await settingsToggle.focus();
	await page.keyboard.press("Enter");
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
	await page.keyboard.press("Space");
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
	for (const width of [1440, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		await containment(page);
		await page.screenshot({
			path: `${evidence}/settings-general-entry-${width}-light.png`,
			fullPage: true,
		});
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await sidebar.getByRole("link", { name: "General", exact: true }).click();
	await expect(page).toHaveURL(admin("general"));
	await expect(
		editor().locator(
			"[name=site-phone], [name=site-hero_mode], [name=site-maintenance_enabled]",
		),
	).toHaveCount(0);
	await page
		.locator("#languages")
		.getByRole("tab", { name: "English", exact: true })
		.click();
	await page.locator("[name=site-en_name]").fill("DEMO Immediate Name");
	const oldVersion = await page.locator("[name=site-version]").inputValue();
	await save("General");
	expect((await publicSettings()).identity.name).toBe("DEMO Immediate Name");
	await page.locator("[name=site-version]").evaluate((element, value) => {
		(element as HTMLInputElement).value = value;
	}, oldVersion);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByText("Settings changed in another session.", { exact: false }),
	).toBeVisible();
	await page.goto(admin("general"));
	await containment(page);
	await page.screenshot({
		path: `${evidence}/settings-general-1440-light.png`,
		fullPage: true,
	});

	await page.goto(admin("branding"));
	await expect(page.locator("#languages img")).toHaveCount(8);
	await expect
		.poll(() =>
			page
				.locator("#languages img")
				.evaluateAll((images) =>
					images.every(
						(image) =>
							(image as HTMLImageElement).complete &&
							(image as HTMLImageElement).naturalWidth > 0,
					),
				),
		)
		.toBe(true);
	await page
		.locator("#languages")
		.getByRole("tab", { name: "English", exact: true })
		.click();
	await expect(page.locator("#panel-site-fa-AF")).not.toBeVisible();
	const beforeBranding = await publicSettings();
	await page
		.locator("[name=site-favicon_file]")
		.setInputFiles("tests/fixtures/images/headphones.webp");
	await page
		.locator("[name=site-en_logo_light_file]")
		.setInputFiles("tests/fixtures/images/headphones.webp");
	await save("Branding");
	const uploaded = await publicSettings();
	expect(uploaded.favicon.url).toMatch(/^\/api\/v1\/site\/media\//);
	expect(uploaded.og_image).toEqual(beforeBranding.og_image);
	expect(
		(
			await page.request.head(`${api}${uploaded.identity.logo_light.url}`)
		).headers()["content-type"],
	).toBe("image/webp");
	await page.goto("/en");
	await expect(page.locator("header img").first()).toHaveAttribute(
		"src",
		`${api}${uploaded.identity.logo_light.url}`,
	);
	await expect
		.poll(() =>
			page
				.locator("header img")
				.first()
				.evaluate((image: HTMLImageElement) => image.naturalWidth),
		)
		.toBeGreaterThan(0);
	await page.goto(admin("branding"));
	await page
		.locator("#languages")
		.getByRole("tab", { name: "English", exact: true })
		.click();
	await page.locator("[name=site-en_logo_light_clear]").check();
	await save("Branding");
	expect((await publicSettings()).identity.logo_light).toBeNull();
	await page.screenshot({
		path: `${evidence}/settings-branding-1440-light.png`,
		fullPage: true,
	});

	await page.goto(admin("contacts"));
	await page.getByLabel("Support phone", { exact: true }).fill("invalid");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.locator("#id_site-phone_error")).toHaveCount(1);
	await expect(
		page.getByLabel("Support phone", { exact: true }),
	).toHaveAttribute("aria-describedby", /id_site-phone_error/);
	await expect(page.getByLabel("Support phone", { exact: true })).toHaveValue(
		"invalid",
	);
	await page.screenshot({
		path: `${evidence}/settings-validation-1440-light.png`,
		fullPage: true,
	});
	await page.getByLabel("Support phone", { exact: true }).fill("+1234567890");
	await save("Contact information");
	const afterContact = await publicSettings();
	expect(afterContact.contacts.phone).toBe("+1234567890");
	expect(afterContact.identity.name).toBe("DEMO Immediate Name");
	expect(afterContact.favicon).toEqual(uploaded.favicon);
	await page.getByLabel("Support phone", { exact: true }).fill("+1234567891");
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.goto(admin()).catch(() => {});
	await expect(editor()).toBeVisible();
	page.once("dialog", (dialog) => dialog.accept());
	await page.goto(admin("announcement"));
	await page.locator("[name=site-announcement_enabled]").check();
	await page.locator("[name='site-fa-AF_announcement']").fill("اعلان آزمایشی");
	await save("Announcement");
	expect((await publicSettings()).announcement.enabled).toBe(true);
	await expect(editor().locator("[name=site-maintenance_enabled]")).toHaveCount(
		0,
	);

	await page.goto(admin("maintenance"));
	await page.getByLabel("Turn on maintenance mode").check();
	await save("Maintenance");
	expect((await page.request.get("/en/about")).status()).toBe(503);
	await page.getByLabel("Turn on maintenance mode").uncheck();
	await save("Maintenance");
	expect((await page.request.get("/en/about")).status()).toBe(200);

	await page.goto(admin("seo"));
	await page.locator("#seo-forms details summary").first().click();
	await page.locator("[name=seo-0-page]").selectOption("about");
	await page.locator("[name=seo-0-locale]").selectOption("en");
	await page.locator("[name=seo-0-title]").fill("DEMO About override");
	await save("Search & sharing");
	expect((await publicSettings()).seo).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ page: "about", title: "DEMO About override" }),
		]),
	);
	expect(await (await page.request.get("/en/about")).text()).toContain(
		"DEMO About override",
	);

	await page.goto(admin("hero"));
	await expect(
		page.getByRole("heading", { name: "Hero slide library", exact: true }),
	).toBeVisible();
	await page.getByRole("link", { name: "Add post", exact: true }).click();
	await page.locator('[name="post-label"]').fill("DEMO clean slide editor");
	await page.locator('[name="post-kind"]').selectOption("video");
	await expect(
		page.getByLabel("Upload MP4 video", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByLabel("Upload image", { exact: true }),
	).not.toBeVisible();
	await page.locator('[name="post-kind"]').selectOption("image");
	await expect(page.locator('[name="post-fa-AF_cta_url"]')).toHaveAttribute(
		"dir",
		"ltr",
	);
	await page.getByRole("button", { name: "Save draft", exact: true }).click();
	await expect(
		page.getByText("Draft saved. The public version is unchanged."),
	).toBeVisible();
	await page.screenshot({
		path: `${evidence}/settings-hero-editor-1440-light.png`,
		fullPage: true,
	});

	for (const section of [
		"hero",
		"contacts",
		"announcement",
		"maintenance",
		"seo",
	]) {
		await page.goto(admin(section));
		await containment(page);
		await page.screenshot({
			path: `${evidence}/settings-${section}-1440-light.png`,
			fullPage: true,
		});
	}
	await page
		.getByRole("button", { name: "DEMO Site Owner Super admin / Owner" })
		.click();
	await page.getByRole("button", { name: "Dark", exact: true }).click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page
		.getByRole("button", { name: "DEMO Site Owner Super admin / Owner" })
		.click();
	for (const [section, width] of [
		["branding", 390],
		["hero", 390],
		["general", 320],
	] as const) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(admin(section));
		await containment(page);
		await page.screenshot({
			path: `${evidence}/settings-${section}-${width}-dark.png`,
			fullPage: true,
		});
	}
	await page.getByRole("button", { name: "Toggle navigation" }).click();
	await expect(
		page.getByRole("button", { name: "Close navigation" }),
	).toBeFocused();
	await expect(
		page
			.locator("#nav-sidebar-apps")
			.getByRole("link", { name: "General", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Toggle navigation" }),
	).toBeFocused();
	await page.getByRole("button", { name: "Toggle navigation" }).click();
	await page
		.locator("#nav-sidebar-apps")
		.getByRole("link", { name: "General", exact: true })
		.focus();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Toggle navigation" }),
	).toBeFocused();
});

for (const locale of ["fa-AF", "en", "ps", "ar"] as const)
	test(`${locale}: reference homepage, independent promotional cards and demo previews`, async ({
		page,
	}) => {
		test.setTimeout(180000);
		const t = storefrontCopy[locale];
		disposablePython(
			`import sys,json
from pathlib import Path
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.site.models import SiteSettings,HeroSlide,HeroLocale
from apps.site.media import store_upload
values=json.load(sys.stdin)
site=SiteSettings.objects.get(pk=1);site.hero_mode='image_carousel';site.hero_rotate=False;site.save(update_fields=['hero_mode','hero_rotate'])
HeroSlide.objects.update(enabled=False)
for position,name in enumerate(['dried-fruit','clothing','beauty']):
 slide,created=HeroSlide.objects.get_or_create(settings=site,label='DEMO reference '+name)
 if slide.image_id is None:
  image=Path(settings.BASE_DIR).parent/'frontend/public/images/storefront'/(name+'.webp')
  slide.image=store_upload(SimpleUploadedFile(image.name,image.read_bytes()),'image',[])
 slide.enabled=True;slide.kind='image';slide.position=position;slide.bundled_image=False;slide.save()
 for code,copy in values.items():
  body=copy['products'][name]
  HeroLocale.objects.update_or_create(slide=slide,locale=code,defaults=dict(title=body['title'],description=body['description'],alt=body['alt'],cta_label=copy['preview'],cta_url='/#demo-product-'+name))
 if position in [1,2]:
  card,_=HeroSlide.objects.get_or_create(settings=site,placement='promotion',label='DEMO independent card '+name,defaults=dict(enabled=True))
  card.image=slide.image;card.image_url='';card.bundled_image=False;card.enabled=True;card.kind='image';card.save()
  setattr(site,'promotion_one' if position==1 else 'promotion_two',card);site.save(update_fields=['promotion_one' if position==1 else 'promotion_two'])
  for code,copy in values.items():
   body=copy['products'][name]
   HeroLocale.objects.update_or_create(slide=card,locale=code,defaults=dict(title=body['title'],alt=body['alt'],cta_label=copy['preview'],cta_url='/#demo-product-'+name))
`,
			JSON.stringify(storefrontCopy),
		);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		for (const width of [320, 390, 1440]) {
			await page.setViewportSize({ width, height: 960 });
			await page.goto(`/${locale}`);
			await expect(page.locator("html")).toHaveAttribute(
				"dir",
				locale === "en" ? "ltr" : "rtl",
			);
			const hero = page.getByRole("region", {
				name: heroUI[locale].slides,
				exact: true,
			});
			for (const summary of await page.locator("header summary").all()) {
				await summary.click();
				await containment(page);
				await summary.press("Escape");
			}
			const featured = page.getByRole("complementary", {
				name: t.recommended,
				exact: true,
			});
			await expect(featured.locator("article")).toHaveCount(2);
			await expect(featured.locator("h2").first()).toHaveText(
				t.products.clothing.title,
			);
			await expect(featured.locator("h2").last()).toHaveText(
				t.products.beauty.title,
			);
			if (width === 1440) {
				const footerGroups = page.locator("footer > div:first-child > div > *");
				await expect(footerGroups).toHaveCount(5);
				const groupRows = await footerGroups.evaluateAll((elements) =>
					elements.map((element) =>
						Math.round(element.getBoundingClientRect().top),
					),
				);
				expect(new Set(groupRows).size).toBe(1);
				const category = page.getByRole("navigation", {
					name: t.categories,
					exact: true,
				});
				await expect(category.getByRole("link")).toHaveCount(categories.length);
				const categoryBox = await category.boundingBox(),
					heroBox = await hero.boundingBox(),
					featuredBox = await featured.boundingBox();
				expect(categoryBox && heroBox && featuredBox).toBeTruthy();
				if (categoryBox && heroBox && featuredBox)
					expect(
						locale === "en"
							? categoryBox.x < heroBox.x && heroBox.x < featuredBox.x
							: featuredBox.x < heroBox.x && heroBox.x < categoryBox.x,
					).toBe(true);
			}
			for (const theme of ["light", "dark"]) {
				await choosePreference(page, messages[locale].theme, theme);
				await containment(page);
				await expect
					.poll(() =>
						page.evaluate(() =>
							[...document.images]
								.filter((img) => img.getBoundingClientRect().width > 0)
								.every((img) => img.complete && img.naturalWidth > 0),
						),
					)
					.toBe(true);
				if (width !== 320)
					await page.screenshot({
						path: `${evidence}/reference-home-${locale}-${width}-${theme}.png`,
						fullPage: true,
					});
			}
			for (const [index, id] of (
				["dried-fruit", "clothing", "beauty"] as const
			).entries()) {
				await expect(hero.locator("h1")).toHaveText(t.products[id].title);
				await hero.getByRole("link", { name: t.preview, exact: true }).click();
				const dialog = page.getByRole("dialog");
				await expect(dialog).toBeVisible();
				await expect(
					dialog.getByRole("heading", {
						name: t.products[id].title,
						exact: true,
					}),
				).toBeVisible();
				await expect(dialog).toContainText(t.demoNotice);
				await dialog
					.getByRole("button", { name: t.close, exact: true })
					.focus();
				await page.keyboard.press("Shift+Tab");
				expect(
					await dialog.evaluate((element) =>
						element.contains(document.activeElement),
					),
				).toBe(true);
				await page.keyboard.press("Escape");
				await expect(dialog).not.toBeVisible();
				await expect(
					hero.getByRole("link", { name: t.preview, exact: true }),
				).toBeFocused();
				await hero
					.getByRole("button", { name: heroUI[locale].next, exact: true })
					.click();
				if (index === 2)
					await expect(hero.locator("h1")).toHaveText(
						t.products["dried-fruit"].title,
					);
			}
			await featured.getByRole("link").first().click();
			await expect(
				page.getByRole("dialog").getByRole("heading", {
					name: t.products.clothing.title,
					exact: true,
				}),
			).toBeVisible();
			await page.keyboard.press("Escape");
			const search = page.getByRole("searchbox", {
				name: t.search,
				exact: true,
			});
			await search.fill(t.categoryNames.furniture);
			await page
				.locator("header")
				.getByRole("link", { name: t.categoryNames.furniture, exact: true })
				.last()
				.click();
			await expect(page.getByRole("dialog")).toContainText(
				t.products.furniture.title,
			);
			await page.keyboard.press("Escape");
			await page.getByRole("link", { name: t.viewAll, exact: true }).click();
			await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(
				categories.length,
			);
			await page.keyboard.press("Escape");
			await expect(page.locator('footer input[type="email"]')).toBeDisabled();
			await expect(
				page
					.locator("footer")
					.getByRole("button", { name: t.subscribe, exact: true }),
			).toBeDisabled();
			for (const key of Object.keys(pages) as (keyof typeof pages)[])
				if (key !== "home")
					await expect(
						page.locator(`footer a[href="/${locale}${pages[key].path}"]`),
					).toHaveCount(1);
			for (const id of demoProducts)
				await expect(
					page.locator(`main a[href="/${locale}#category-${id}"]`).first(),
				).toBeAttached();
		}
		expect(errors).toEqual([]);
	});
