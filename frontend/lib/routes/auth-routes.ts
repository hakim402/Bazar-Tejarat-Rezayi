import type { AuthScreen } from "../i18n/auth-screens";
export const modalScreens: readonly AuthScreen[] = [
	"buyer-sign-in",
	"seller-sign-in",
	"buyer-registration",
	"seller-registration",
	"forgot-password",
	"policy-draft",
	"verify-email",
	"reset-password",
	"google-result",
];
export function authHref(
	locale: string,
	screen: AuthScreen,
	parameters?: URLSearchParams,
) {
	if (!modalScreens.includes(screen)) return `/${locale}/auth/${screen}`;
	const query = new URLSearchParams(parameters);
	query.set("auth", screen);
	return `/${locale}${screen.startsWith("seller") || query.get("context") === "seller" ? "/sell" : ""}?${query}`;
}

export const AUTH_NAVIGATION_CHANGED = "rezayi:auth-navigation";

export type AuthAudience = "buyer" | "seller";

export function authAudience(
	screen: AuthScreen,
	parameters: URLSearchParams,
	fallback: AuthAudience = "buyer",
): AuthAudience {
	if (screen.startsWith("seller")) return "seller";
	if (screen.startsWith("buyer")) return "buyer";
	const requested = parameters.get("context");
	return requested === "buyer" || requested === "seller" ? requested : fallback;
}

/** Carry only parameters used by the selected public authentication screen. */
export function authParameters(
	screen: AuthScreen,
	parameters: URLSearchParams,
	audience: AuthAudience,
) {
	const query = new URLSearchParams();
	query.set("auth", screen);
	query.set("context", authAudience(screen, parameters, audience));
	const destination = parameters.get("return");
	if (destination && destination.length <= 2048)
		query.set("return", destination);
	if (screen === "google-result") {
		const result = parameters.get("google");
		const attempt = parameters.get("attempt");
		const action = parameters.get("action");
		if (result && /^[a-z_]{1,40}$/.test(result)) query.set("google", result);
		if (attempt && /^[0-9a-f-]{36}$/i.test(attempt))
			query.set("attempt", attempt);
		if (action && ["signin", "register", "link", "add-role"].includes(action))
			query.set("action", action);
	}
	return query;
}

export function clearAuthToken() {
	const url = new URL(window.location.href);
	const hash = new URLSearchParams(url.hash.slice(1));
	hash.delete("token");
	url.hash = hash.toString();
	window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
