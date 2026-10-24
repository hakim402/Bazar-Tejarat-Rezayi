import { NextResponse, type NextRequest } from "next/server";
import { apiOrigin } from "./lib/api/client";
import { defaultLocale, isLocale, type Locale } from "./lib/i18n/locales";
import { pageAtPath } from "./features/pages/registry";
import { authScreens, type AuthScreen } from "./lib/i18n/auth-screens";
import { parseSite, type Site } from "./features/site/contract";
async function settings(locale: Locale) {
	try {
		const response = await fetch(
			`${apiOrigin(process.env.API_INTERNAL_URL)}/api/v1/site/public/${locale}/`,
			{
				cache: "no-store",
				credentials: "omit",
				signal: AbortSignal.timeout(5000),
			},
		);
		return response.ok
			? parseSite(
					await response.json(),
					locale,
					apiOrigin(process.env.NEXT_PUBLIC_API_URL),
				)
			: null;
	} catch {
		return null;
	}
}
export async function proxy(request: NextRequest) {
	const parts = request.nextUrl.pathname.split("/").filter(Boolean);
	let locale = parts[0];
	if (!isLocale(locale)) {
		const preference = request.cookies.get("rezayi-locale")?.value,
			site = await settings(defaultLocale);
		locale = isLocale(preference)
			? preference
			: (site?.default_locale ?? defaultLocale);
		if (!site && request.nextUrl.pathname === "/")
			return statusResponse(request, locale as Locale, 503);
		const url = request.nextUrl.clone();
		url.pathname = `/${locale}${url.pathname === "/" ? "" : url.pathname}`;
		return NextResponse.redirect(url, 307);
	}
	const headers = new Headers(request.headers);
	headers.set("x-rezayi-locale", locale);
	// Reserved status renderers must terminate a rewrite, including Next's
	// normalized-origin self-proxy path. They only render errors, never a bypass.
	if (
		parts.length === 2 &&
		["site-unavailable", "site-not-found"].includes(parts[1])
	) {
		const status = parts[1] === "site-unavailable" ? 503 : 404;
		const response = NextResponse.next({ status, request: { headers } });
		response.headers.set("Cache-Control", "no-store");
		response.headers.set("X-Robots-Tag", "noindex, nofollow");
		if (status === 503) response.headers.set("Retry-After", "300");
		return response;
	}
	const path = `/${parts.slice(1).join("/")}`,
		key = pageAtPath(path);
	if (key) {
		const site = await settings(locale);
		if (!site || site.maintenance.enabled)
			return statusResponse(request, locale, 503);
		const response = NextResponse.next({ request: { headers } });
		response.headers.set("Cache-Control", "no-store");
		applyMediaPolicy(response, site);
		return response;
	}
	if (
		parts[1] === "catalogue-preview" &&
		parts.length === 3 &&
		/^[0-9a-f-]{36}$/.test(parts[2])
	) {
		try {
			const response = await fetch(
				`${apiOrigin(process.env.API_INTERNAL_URL)}/api/v1/catalogue/published/${locale}/${encodeURIComponent(parts[2])}/`,
				{
					cache: "no-store",
					credentials: "omit",
					signal: AbortSignal.timeout(10000),
				},
			);
			if (response.status === 404) return statusResponse(request, locale, 404);
		} catch {
			/* Preview retains its distinct upstream-failure state. */
		}
		return NextResponse.next({ request: { headers } });
	}
	const account =
		parts[1] === "account" && ["buyer", "seller", "staff"].includes(parts[2]);
	const screen = parts[3] ?? "profile",
		context = parts[2],
		id = parts[4];
	const business = screen === "organizations" && context !== "staff";
	const review =
		["verification", "transfers"].includes(screen) && context === "staff";
	const catalogue = screen === "catalogue" && context !== "buyer";
	const ordinary =
		["profile", "password", "link", "mfa-reset"].includes(screen) &&
		!(context === "staff" && screen === "link") &&
		!(context !== "staff" && screen === "mfa-reset");
	const validAccount =
		account &&
		((ordinary && parts.length <= 4) ||
			((business || review || catalogue) &&
				parts.length <= 5 &&
				(!id || /^[0-9a-f-]{36}$/.test(id))));
	const privateRoute =
		(parts[1] === "invitation" && parts.length === 2) ||
		(parts[1] === "auth" &&
			parts.length === 3 &&
			authScreens.includes(parts[2] as AuthScreen)) ||
		validAccount;

	if (!privateRoute) return statusResponse(request, locale, 404);
	return NextResponse.next({ request: { headers } });
}
function statusResponse(
	request: NextRequest,
	locale: Locale,
	status: 404 | 503,
) {
	const headers = new Headers(request.headers);
	headers.set("x-rezayi-locale", locale);
	const url = request.nextUrl.clone();
	url.pathname = `/${locale}/${status === 503 ? "site-unavailable" : "site-not-found"}`;
	url.search = "";
	const response = NextResponse.rewrite(url, { status, request: { headers } });
	response.headers.set("Cache-Control", "no-store");
	response.headers.set("X-Robots-Tag", "noindex, nofollow");
	if (status === 503) response.headers.set("Retry-After", "300");
	return response;
}
function applyMediaPolicy(response: NextResponse, site: Site) {
	let origin = "";
	try {
		origin = apiOrigin(process.env.NEXT_PUBLIC_API_URL);
	} catch {}
	const hosts = site.media_hosts.map((host) => `https://${host}`).join(" ");
	response.headers.set(
		"Content-Security-Policy",
		`object-src 'none'; frame-src 'none'; base-uri 'self'; img-src 'self' data: ${origin} ${hosts}; media-src 'self' ${origin} ${hosts}`,
	);
}
export const config = {
	matcher: [
		"/((?!api(?:/|$)|_next(?:/|$)|brand(?:/|$)|fonts(?:/|$)|images(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$).*)",
	],
};
