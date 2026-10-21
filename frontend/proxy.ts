import { NextResponse, type NextRequest } from "next/server";
import {
	publicCall,
	validContent,
	contentPath,
} from "./features/content/api/public";
import { defaultLocale, isLocale } from "./lib/i18n/locales";
export async function proxy(request: NextRequest) {
	const locale = request.nextUrl.pathname.split("/")[1];
	if (!isLocale(locale)) {
		const url = request.nextUrl.clone();
		url.pathname = `/${defaultLocale}${url.pathname === "/" ? "" : url.pathname}`;
		return NextResponse.redirect(url, 307);
	}
	const headers = new Headers(request.headers);
	headers.set("x-rezayi-locale", locale);
	const parts = request.nextUrl.pathname.split("/").filter(Boolean);
	// Decide article absence before React can stream a 200 response with a not-found body.
	if (
		parts.length === 3 &&
		parts[1] === "help" &&
		["GET", "HEAD"].includes(request.method)
	) {
		try {
			const article = await publicCall(
				process.env.API_INTERNAL_URL,
				contentPath(locale, encodeURIComponent(parts[2])),
				validContent,
			);
			if (article?.kind !== "article") {
				const destination = request.nextUrl.clone();
				destination.pathname = `/${locale}/_unavailable/article`;
				destination.search = "";
				const response = NextResponse.rewrite(destination, {
					status: 404,
					request: { headers },
				});
				response.headers.set("Cache-Control", "no-store");
				return response;
			}
		} catch {
			/* Dependency errors render the page's retry state, never a false 404. */
		}
	}
	return NextResponse.next({ request: { headers } });
}
export const config = {
	matcher: ["/((?!api|_next|brand|fonts|favicon.ico|.*\\..*).*)"],
};
