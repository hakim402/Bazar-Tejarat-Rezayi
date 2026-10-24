import { isLocale, type Locale } from "../../lib/i18n/locales.ts";
import { messages } from "../../lib/i18n/messages.ts";
import { destinationAllowed, pageKeys } from "../pages/registry.ts";
import type { components } from "../../lib/api/schema";
export type Site = components["schemas"]["PublicSite"];
export type Media = components["schemas"]["Media"];
export type Notice = components["schemas"]["Notice"];
export type Slide = components["schemas"]["Slide"];
const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const text = (value: unknown, max = 4000): string =>
	typeof value === "string" &&
	value.length <= max &&
	!/[<>]/u.test(value) &&
	![...value].some((char) => {
		const code = char.charCodeAt(0);
		return code < 9 || (code > 10 && code < 32) || code === 127;
	})
		? value
		: "";
const localeOf = (value: unknown, fallback: Locale) =>
	isLocale(value) ? value : fallback;
export function bundledSite(locale: Locale): Site {
	const notice: Notice = {
		enabled: false,
		title: "",
		text: "",
		label: "",
		url: "",
		content_locale: locale,
		fallback: false,
	};
	return {
		default_locale: "fa-AF",
		default_theme: "system",
		indexing: false,
		identity: {
			name: messages[locale].brand,
			tagline: "",
			title_template: "{page} · {site}",
			description: "",
			address: "",
			hours: "",
			logo_light: null,
			logo_dark: null,
			content_locale: locale,
			fallback: false,
		},
		contacts: {
			email: "",
			phone: "",
			website: "",
			facebook: "",
			instagram: "",
			linkedin: "",
			youtube: "",
		},
		favicon: null,
		og_image: null,
		announcement: { ...notice },
		maintenance: { ...notice },
		hero: {
			mode: "image_carousel",
			autoplay: false,
			rotate: false,
			interval: 8,
			slides: [],
			cards: [],
		},
		seo: [],
		media_hosts: [],
	};
}
/** Strict authority, bounded presentation defaults. Never interprets CMS payloads. */
export function parseSite(
	value: unknown,
	locale: Locale,
	mediaOrigin: string,
): Site | null {
	const data = record(value),
		maintenance = record(data.maintenance);
	if (typeof maintenance.enabled !== "boolean") return null;
	if (
		maintenance.enabled &&
		(!text(maintenance.title) || !text(maintenance.text))
	)
		return null;
	const result = bundledSite(locale);
	result.media_hosts = Array.isArray(data.media_hosts)
		? data.media_hosts
				.filter(
					(h): h is string =>
						typeof h === "string" &&
						/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) &&
						!/\.(?:local|localhost|internal|test|invalid)$/.test(h),
				)
				.slice(0, 16)
		: [];
	function media(value: unknown): Media | null {
		const item = record(value);
		let url = text(item.url, 2048);
		try {
			if (/^\/api\/v1\/site\/media\/[0-9a-f-]+\/$/.test(url))
				url = mediaOrigin + url;
			const parsed = new URL(url);
			const local =
				parsed.origin === mediaOrigin &&
				/^\/api\/v1\/site\/media\/[0-9a-f-]+\/$/.test(parsed.pathname);
			const bundled =
				parsed.pathname === "/images/marketplace/hero.webp" &&
				["http:", "https:"].includes(parsed.protocol) &&
				!parsed.search;
			const external =
				parsed.protocol === "https:" &&
				result.media_hosts.includes(parsed.hostname) &&
				!parsed.port &&
				!parsed.search &&
				!parsed.hash;
			if (
				parsed.username ||
				parsed.password ||
				(!local && !bundled && !external)
			)
				return null;
			if (bundled) url = "/images/marketplace/hero.webp";
			if (
				!["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(
					String(item.content_type),
				)
			)
				return null;
			return {
				url,
				width:
					Number.isInteger(item.width) &&
					Number(item.width) > 0 &&
					Number(item.width) <= 20000
						? Number(item.width)
						: 1536,
				height:
					Number.isInteger(item.height) &&
					Number(item.height) > 0 &&
					Number(item.height) <= 20000
						? Number(item.height)
						: 1024,
				content_type: String(item.content_type),
			};
		} catch {
			return null;
		}
	}
	function notice(value: unknown): Notice {
		const item = record(value),
			target = text(item.url, 2048),
			label = text(item.label, 160);
		return {
			enabled: item.enabled === true,
			title: text(item.title, 300),
			text: text(item.text),
			label: destinationAllowed(target) && label ? label : "",
			url: destinationAllowed(target) && label ? target : "",
			content_locale: localeOf(item.content_locale, locale),
			fallback: item.fallback === true,
		};
	}
	result.maintenance = notice(maintenance);
	result.announcement = notice(data.announcement);
	result.default_locale = localeOf(data.default_locale, "fa-AF");
	if (data.default_theme === "light" || data.default_theme === "dark")
		result.default_theme = data.default_theme;
	result.indexing = data.indexing === true;
	const identity = record(data.identity);
	for (const key of [
		"name",
		"tagline",
		"title_template",
		"description",
		"address",
		"hours",
	] as const)
		result.identity[key] = text(identity[key]) || result.identity[key];
	if (
		!/^.*\{page\}.*$/.test(result.identity.title_template) ||
		/\{(?!page\}|site\})/.test(result.identity.title_template)
	)
		result.identity.title_template = "{page} · {site}";
	result.identity.content_locale = localeOf(identity.content_locale, locale);
	result.identity.fallback = identity.fallback === true;
	result.identity.logo_light = media(identity.logo_light);
	result.identity.logo_dark = media(identity.logo_dark);
	const contacts = record(data.contacts);
	for (const key of [
		"website",
		"facebook",
		"instagram",
		"linkedin",
		"youtube",
	] as const) {
		const url = text(contacts[key], 2048);
		if (url.startsWith("https:") && destinationAllowed(url))
			result.contacts[key] = url;
	}
	if (
		typeof contacts.email === "string" &&
		/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contacts.email)
	)
		result.contacts.email = contacts.email;
	if (
		typeof contacts.phone === "string" &&
		/^\+[0-9][0-9 ()-]{6,22}$/.test(contacts.phone)
	)
		result.contacts.phone = contacts.phone;
	result.favicon = media(data.favicon);
	result.og_image = media(data.og_image);
	const hero = record(data.hero);
	if (["image_carousel", "video_carousel"].includes(String(hero.mode)))
		result.hero.mode = hero.mode as Site["hero"]["mode"];
	result.hero.autoplay = hero.autoplay === true;
	result.hero.rotate = hero.rotate === true;
	result.hero.interval =
		typeof hero.interval === "number" &&
		hero.interval >= 5 &&
		hero.interval <= 60
			? hero.interval
			: 8;
	for (const value of Array.isArray(hero.slides)
		? hero.slides.slice(0, 8)
		: []) {
		const s = record(value),
			kind = s.kind === "video" ? "video" : "image",
			target = text(s.cta_url, 2048);
		const image = media(s.image),
			video = media(s.video),
			poster = media(s.poster);
		if (
			!text(s.title, 300) ||
			(result.hero.mode.includes("video")
				? kind !== "video" || !video || !poster
				: kind !== "image" || !image)
		)
			continue;
		result.hero.slides.push({
			id: text(s.id, 80),
			kind,
			image,
			video,
			poster,
			title: text(s.title, 300),
			description: text(s.description),
			alt: text(s.alt),
			cta_label: destinationAllowed(target) ? text(s.cta_label, 160) : "",
			cta_url: destinationAllowed(target) ? target : "",
			transcript: text(s.transcript, 6000),
			source_url: destinationAllowed(text(s.source_url, 2048))
				? text(s.source_url, 2048)
				: "",
			content_locale: localeOf(s.content_locale, locale),
			fallback: s.fallback === true,
		});
	}
	for (const slot of ["promo_1", "promo_2"] as const) {
		const candidate = (Array.isArray(hero.cards) ? hero.cards : []).find(
			(value) => record(value).slot === slot,
		);
		const card = record(candidate),
			kind = card.kind === "video" ? "video" : "image";
		const image = media(card.image),
			video = media(card.video),
			poster = media(card.poster);
		const target = text(
			kind === "video" ? card.source_url : card.cta_url,
			2048,
		);
		if (
			!destinationAllowed(target) ||
			(kind === "video"
				? video?.content_type !== "video/mp4" ||
					!poster?.content_type.startsWith("image/")
				: !image?.content_type.startsWith("image/") ||
					!text(card.title, 300) ||
					!text(card.cta_label, 160))
		)
			continue;
		result.hero.cards.push({
			slot,
			id: text(card.id, 80),
			kind,
			image,
			video,
			poster,
			title: text(card.title, 300),
			description: "",
			alt: text(card.alt),
			cta_label: kind === "image" ? text(card.cta_label, 160) : "",
			cta_url: kind === "image" ? target : "",
			source_url: kind === "video" ? target : "",
			transcript: text(card.transcript, 6000),
			content_locale: localeOf(card.content_locale, locale),
			fallback: card.fallback === true,
		});
	}
	for (const value of Array.isArray(data.seo) ? data.seo.slice(0, 12) : []) {
		const row = record(value);
		if (pageKeys.includes(row.page as (typeof pageKeys)[number]))
			result.seo.push({
				page: row.page as (typeof pageKeys)[number],
				title: text(row.title, 300),
				description: text(row.description),
				image: media(row.image),
			});
	}
	return result;
}
