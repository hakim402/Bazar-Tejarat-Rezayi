import type { Locale } from "../../lib/i18n/locales";
export type BodySection = { id: string; text: string };
const MEDIA_SRC =
	/^\/api\/v1\/site\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/;
const COMMENTS = /<!--[\s\S]*?-->/g;
const DROP_BLOCKS =
	/<(script|style|iframe|object|embed|form|noscript|template|svg|math|video|audio|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_TAGS =
	/<\/?(?:script|style|iframe|object|embed|form|input|button|textarea|select|option|noscript|template|svg|math|link|meta|title|head|video|audio|source|canvas|map|area|base)\b[^>]*>/gi;
const decode = (value: string): string =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
const ESCAPED_BLOCK =
	/&lt;\/?(?:h[1-6]|p|div|ul|ol|li|blockquote|figure|figcaption|pre|hr)\b/gi;
/**
 * Trix stores HTML pasted as plain text as escaped markup wrapped in <p>/<br>
 * scaffolding. When escaped block tags appear repeatedly, decode once and drop
 * the scaffolding so the rebuild below treats the markup as real structure.
 * Anything decoded still passes the full drop/rebuild passes that follow.
 */
function rescueEscaped(source: string): string {
	if ((source.match(ESCAPED_BLOCK) ?? []).length < 2) return source;
	return decode(
		source
			.replace(/<br\s*\/?>/gi, "\uE000br\uE001")
			.replace(/<\/?p>/gi, "\uE000p\uE001"),
	).replace(/\uE000(?:br|p)\uE001/g, "");
}
/**
 * Defense-in-depth pass over the already-sanitized CMS body: re-checks link and
 * image boundaries, prefixes internal destinations with the active locale,
 * rewrites media to the API origin and numbers h2 sections for the anchor nav.
 */
export function prepareBody(
	html: string,
	locale: Locale,
	mediaOrigin: string,
): { html: string; sections: BodySection[] } {
	let source = rescueEscaped(html || "")
		.replace(COMMENTS, "")
		.replace(DROP_BLOCKS, "")
		.replace(DROP_TAGS, "");
	source = source.replace(
		/<(a|img)\b([^>]*)>/gi,
		(_match, tag: string, attrs: string) => {
			const get = (name: string) => {
				const found = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
				return found ? found[1] : "";
			};
			if (tag.toLowerCase() === "img") {
				const src = get("src");
				if (!MEDIA_SRC.test(src)) return "";
				const size = ["width", "height"]
					.map((name) =>
						/^\d{1,4}$/.test(get(name)) ? ` ${name}="${get(name)}"` : "",
					)
					.join("");
				return `<img src="${mediaOrigin}${src}" alt="${get("alt")}"${size} loading="lazy" decoding="async">`;
			}
			const href = get("href");
			if (/[\s\\]/u.test(href)) return "";
			if (href.startsWith("/") && !href.startsWith("//"))
				return `<a href="${href.startsWith("/#") ? `/${locale}${href.slice(1)}` : `/${locale}${href === "/" ? "" : href}`}">`;
			if (/^https:\/\//i.test(href))
				return `<a href="${href}" target="_blank" rel="nofollow noopener">`;
			if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(href))
				return `<a href="${href}">`;
			return "";
		},
	);
	// Any other tag keeps no attributes (ids, styles, handlers never survive).
	source = source.replace(
		/<([a-z][a-z0-9]*)\b([^>]*)>/gi,
		(match, tag: string, attrs: string) =>
			/^(a|img)$/i.test(tag) || !attrs.trim() ? match : `<${tag}>`,
	);
	const sections: BodySection[] = [];
	source = source.replace(/<h2>/gi, () => {
		sections.push({ id: `section-${sections.length + 1}`, text: "" });
		return `<h2 id="${sections[sections.length - 1].id}">`;
	});
	let index = 0;
	source = source.replace(
		/<h2 id="section-(\d+)">([\s\S]*?)<\/h2>/gi,
		(match, _id: string, inner: string) => {
			const text = decode(inner.replace(/<[^>]*>/g, ""))
				.replace(/\s+/g, " ")
				.trim();
			if (sections[index]) sections[index].text = text;
			index += 1;
			return match;
		},
	);
	return {
		html: source,
		sections: sections.filter((section) => section.text),
	};
}
