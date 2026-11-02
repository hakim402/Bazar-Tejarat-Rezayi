import { modalScreens } from "./lib/routes/auth-routes";
import {
	sellerAccountRoute,
	communicationRoute,
	commerceRoute,
	uuidPattern,
} from "./lib/routes/account-routes";
import { NextResponse, type NextRequest } from "next/server";
import { apiOrigin } from "./lib/api/client";
import { defaultLocale, isLocale, type Locale } from "./lib/i18n/locales";
import { pageAtPath } from "./features/pages/registry";
import { authScreens, type AuthScreen } from "./lib/i18n/auth-screens";
import { parseSite, type Site } from "./features/site/contract";
import { marketplaceRoute } from "./lib/routes/marketplace-routes";
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
	if (
		(parts[1] === "account" && parts[2] === "staff") ||
		(parts[1] === "auth" && ["staff-sign-in", "mfa"].includes(parts[2])) ||
		["staff", "owner"].includes(
			request.nextUrl.searchParams.get("context") ?? "",
		) ||
		["staff-sign-in", "mfa"].includes(
			request.nextUrl.searchParams.get("auth") ?? "",
		)
	)
		return statusResponse(request, locale, 404);
	const path = `/${parts.slice(1).join("/")}`,
		key = pageAtPath(path);
	const marketplace = marketplaceRoute(path);
	if (key || marketplace || path === "/cart") {
		const site = await settings(locale);
		if (!site || site.maintenance.enabled)
			return statusResponse(request, locale, 503);
		if (marketplace || key === "home") {
			try {
				const parameters = new URLSearchParams(request.nextUrl.searchParams);
				for (const key of ["auth", "return", "context"]) parameters.delete(key);
				if (parts[1] === "products" && parts.length === 3) {
					for (const key of [
						"variant",
						"cart_attempt",
						"cart_context",
						"cart_scope",
					])
						parameters.delete(key);
				}
				const endpoint = key === "home" ? "home/" : marketplace;
				const scoped =
					parts[1] === "stores" && parts.length === 3 && parameters.size
						? `stores/${parts[2]}/products/`
						: endpoint;
				const query =
					key === "home" || parts.length === 4 ? "" : parameters.toString();
				const upstream = await fetch(
					`${apiOrigin(process.env.API_INTERNAL_URL)}/api/v1/marketplace/public/${locale}/${scoped}${query ? `?${query}` : ""}`,
					{
						cache: "no-store",
						credentials: "omit",
						signal: AbortSignal.timeout(10000),
					},
				);
				if (upstream.status === 404)
					return statusResponse(request, locale, 404);
				if (!upstream.ok && upstream.status !== 400)
					return statusResponse(request, locale, 503);
			} catch {
				return statusResponse(request, locale, 503);
			}
		}
		const response = NextResponse.next({ request: { headers } });
		response.headers.set("Cache-Control", "no-store");
		applyMediaPolicy(response, site);
		if (path === "/cart")
			response.headers.set("X-Robots-Tag", "noindex, nofollow");
		if (
			modalScreens.includes(
				request.nextUrl.searchParams.get("auth") as AuthScreen,
			)
		)
			response.headers.set("X-Robots-Tag", "noindex, nofollow");
		return response;
	}
	if (
		parts[1] === "catalogue-preview" &&
		parts.length === 3 &&
		/^[0-9a-f-]{36}$/.test(parts[2])
	) {
		try {
			const response = await fetch(
				`${apiOrigin(process.env.API_INTERNAL_URL)}/api/v1/marketplace/public/${locale}/products/${encodeURIComponent(parts[2])}/`,
				{
					cache: "no-store",
					credentials: "omit",
					signal: AbortSignal.timeout(10000),
				},
			);
			if (response.status === 404) return statusResponse(request, locale, 404);
			if (!response.ok) return statusResponse(request, locale, 503);
		} catch {
			return statusResponse(request, locale, 503);
		}
		const url = request.nextUrl.clone();
		url.pathname = `/${locale}/products/${parts[2]}`;
		url.search = "";
		return NextResponse.redirect(url, 308);
	}
	const account =
		parts[1] === "account" && ["buyer", "seller"].includes(parts[2]);
	const screen = parts[3] ?? "profile",
		context = parts[2],
		id = parts[4];
	const business = screen === "organizations";
	const ordinary = ["profile", "password", "link", "settings"].includes(screen);
	const validAccount =
		account &&
		(context === "seller"
			? sellerAccountRoute(parts.slice(3))
			: commerceRoute(parts.slice(3)) ||
				communicationRoute(parts.slice(3)) ||
				(ordinary && parts.length <= 4) ||
				(business && parts.length <= 5 && (!id || uuidPattern.test(id))));

	const privateRoute =
		(parts[1] === "invitation" && parts.length === 2) ||
		(parts[1] === "auth" &&
			parts.length === 3 &&
			authScreens.includes(parts[2] as AuthScreen)) ||
		validAccount;

	if (!privateRoute) return statusResponse(request, locale, 404);
	const response = NextResponse.next({ request: { headers } });
	response.headers.set("Cache-Control", "no-store");
	response.headers.set("X-Robots-Tag", "noindex, nofollow");
	return response;
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
	if (
		status === 404 ||
		!modalScreens.includes(
			request.nextUrl.searchParams.get("auth") as AuthScreen,
		)
	)
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
		"/((?!api(?:/|$)|_next(?:/|$)|brand(?:/|$)|fonts(?:/|$)|images(?:/|$)|marketplace-sitemap(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$).*)",
	],
};
