import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSite, bundledSite } from "../features/site/contract.ts";
import {
	pages,
	pageKeys,
	pageAtPath,
	destinationAllowed,
} from "../features/pages/registry.ts";
import { pageCopy } from "../features/pages/copy.ts";
import { locales } from "../lib/i18n/locales.ts";
const origin = "http://127.0.0.1:8100";
test("hero targets preserve published previews and only fixed demo product hashes", () => {
	for (const path of [
		"/catalogue-preview/00000000-0000-0000-0000-000000000001",
		...["dried-fruit", "clothing", "beauty", "furniture"].map(
			(name) => `/#demo-product-${name}`,
		),
	])
		assert.equal(destinationAllowed(path), true, path);
	for (const path of [
		"/#unknown",
		"/#demo-product-script",
		"/catalogue-preview/nope",
		"/catalogue-preview/00000000-0000-0000-0000-000000000001?redirect=/admin/",
		"/en/#demo-product-beauty",
		"/products/beauty",
	])
		assert.equal(destinationAllowed(path), false, path);
});
test("maintenance authority fails closed, presentation defaults remain safe", () => {
	for (const data of [
		null,
		{},
		{ maintenance: { enabled: "false" } },
		{ maintenance: { enabled: true, title: "", text: "" } },
	])
		assert.equal(parseSite(data, "en", origin), null);
	const site = parseSite(
		{
			maintenance: { enabled: false },
			identity: { name: "<script>bad</script>" },
		},
		"en",
		origin,
	);
	assert.equal(site?.identity.name, bundledSite("en").identity.name);
	assert.equal(site?.maintenance.enabled, false);
	assert.equal(site?.indexing, false);
});
test("registry and four complete static editions preserve existing boundary", () => {
	assert.equal(pageKeys.length, 12);
	for (const locale of locales)
		for (const key of pageKeys) {
			assert.ok(pageCopy[locale][key].title);
			assert.ok(pageCopy[locale][key].intro);
			assert.equal(pageAtPath(pages[key].path || "/"), key);
		}
	for (const path of [
		"/products",
		"/stores/example",
		"/help/future",
		"/checkout",
		"/account/staff/content",
	])
		assert.equal(pageAtPath(path), undefined);
	assert.match(pageCopy.en.terms.title, /development sample/);
	assert.match(pageCopy.en.privacy.intro, /testing/);
});
test("unsafe targets and media are never inherited into presentation", () => {
	for (const href of [
		"javascript:alert(1)",
		"//evil.com",
		"/products",
		"https://a:secret@media.example.com/a",
		"https://127.0.0.1/a",
		"https://foo.local/a",
	])
		assert.equal(destinationAllowed(href), false, href);
	const data = bundledSite("en");
	data.identity.logo_light = {
		url: "https://arbitrary.example.com/a.png",
		width: 80,
		height: 60,
		content_type: "image/png",
	};
	data.announcement = {
		...data.announcement,
		url: "javascript:bad()",
		label: "Go",
	};
	const site = parseSite(data, "en", origin);
	assert.equal(site?.identity.logo_light, null);
	assert.equal(site?.announcement.url, "");
});
test("exact media hosts, uploaded assets, dimensions and fixed SEO overrides", () => {
	const data = bundledSite("en");
	data.media_hosts = ["media.example.com"];
	data.identity.logo_dark = {
		url: "/api/v1/site/media/00000000-0000-0000-0000-000000000001/",
		width: 80,
		height: 60,
		content_type: "image/webp",
	};
	data.og_image = {
		url: "https://media.example.com/image.png",
		width: 1200,
		height: 630,
		content_type: "image/png",
	};
	data.seo = [
		{ page: "about", title: "About", description: "Safe", image: null },
	];
	const site = parseSite(
		{
			...data,
			seo: [
				{ page: "products", title: "Invalid", description: "", image: null },
				...data.seo,
			],
		},
		"en",
		origin,
	);
	assert.equal(
		site?.identity.logo_dark?.url,
		origin + data.identity.logo_dark.url,
	);
	assert.equal(site?.og_image?.width, 1200);
	assert.equal(site?.seo.length, 1);
	data.og_image.url = "https://sub.media.example.com/image.png";
	assert.equal(parseSite(data, "en", origin)?.og_image, null);
});

test("informative video keeps an allowed long transcript", () => {
	const data = bundledSite("en"),
		url = "/api/v1/site/media/00000000-0000-0000-0000-000000000001/",
		transcript = "Detailed transcript. ".repeat(250);
	data.hero.mode = "video_carousel";
	data.hero.slides = [
		{
			id: "demo",
			kind: "video",
			image: null,
			video: { url, width: 640, height: 360, content_type: "video/mp4" },
			poster: { url, width: 640, height: 360, content_type: "image/webp" },
			title: "Video",
			description: "",
			alt: "Video",
			cta_label: "",
			cta_url: "",
			transcript,
			source_url: "/about",
			content_locale: "en",
			fallback: false,
		},
	];
	assert.equal(
		parseSite(data, "en", origin)?.hero.slides[0].transcript,
		transcript,
	);
});
