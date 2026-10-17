export const locales = ["fa-AF", "en", "ps", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fa-AF";
export function isLocale(value: string): value is Locale {
	return locales.some((locale) => locale === value);
}
export function direction(locale: Locale) {
	return locale === "en" ? "ltr" : "rtl";
}
export const languageNames: Record<Locale, string> = {
	"fa-AF": "دری",
	en: "English",
	ps: "پښتو",
	ar: "العربية",
};
export function localizePath(path: string, locale: Locale) {
	const parts = path.split("/");
	if (isLocale(parts[1])) parts[1] = locale;
	else parts.splice(1, 0, locale);
	return parts.join("/");
}
