import { authCopy } from "./auth";
import type { Locale } from "./locales";
export const authScreens = [
	"buyer-registration",
	"seller-registration",
	"buyer-sign-in",
	"seller-sign-in",
	"staff-sign-in",
	"verify-email",
	"forgot-password",
	"reset-password",
	"mfa",
	"google-result",
	"policy-draft",
] as const;
export type AuthScreen = (typeof authScreens)[number];

export function screenTitle(locale: Locale, screen: AuthScreen) {
	const t = authCopy[locale];
	return {
		"buyer-registration": t.buyerRegister,
		"seller-registration": t.sellerRegister,
		"buyer-sign-in": t.buyerSignin,
		"seller-sign-in": t.sellerSignin,
		"staff-sign-in": t.staffSignin,
		"verify-email": t.verify,
		"forgot-password": t.recovery,
		"reset-password": t.reset,
		mfa: t.mfa,
		"policy-draft": t.policyTitle,
		"google-result": t.authLinks,
	}[screen];
}
