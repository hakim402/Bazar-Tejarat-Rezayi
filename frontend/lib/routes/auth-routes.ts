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
