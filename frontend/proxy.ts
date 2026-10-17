import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "./lib/i18n/locales";
export function proxy(request: NextRequest) {
	const locale = request.nextUrl.pathname.split("/")[1];
	if (!isLocale(locale)) {
		const url = request.nextUrl.clone();
		url.pathname = `/${defaultLocale}${url.pathname === "/" ? "" : url.pathname}`;
		return NextResponse.redirect(url, 307);
	}
	const headers = new Headers(request.headers);
	headers.set("x-rezayi-locale", locale);
	return NextResponse.next({ request: { headers } });
}
export const config = {
	matcher: ["/((?!api|_next|brand|fonts|favicon.ico|.*\\..*).*)"],
};
