import type { Locale } from "./locales";
export const siteCopy: Record<
	Locale,
	{
		home: string;
		help: string;
		signin: string;
		fallback: string;
		noArticles: string;
		contact: string;
		noContact: string;
		navigation: string;
	}
> = {
	en: {
		home: "Home",
		help: "Help centre",
		signin: "Sign in",
		fallback:
			"Dari fallback: this section has no text in your selected language yet.",
		noArticles: "No guides are published yet.",
		contact: "Platform support",
		noContact: "Approved support details are not published yet.",
		navigation: "Navigation",
	},
	"fa-AF": {
		home: "خانه",
		help: "مرکز راهنما",
		signin: "ورود",
		fallback:
			"این بخش به زبان دری نمایش داده می‌شود؛ ترجمهٔ انتخاب‌شده هنوز افزوده نشده است.",
		noArticles: "هنوز راهنمایی نشر نشده است.",
		contact: "پشتیبانی بازار",
		noContact: "راه‌های تأییدشدهٔ پشتیبانی هنوز نشر نشده است.",
		navigation: "راهبری",
	},
	ps: {
		home: "کور",
		help: "د لارښود مرکز",
		signin: "ننوتل",
		fallback:
			"دا برخه په دري ښودل کېږي؛ ستاسو په ژبه یې متن لا نه دی زیات شوی.",
		noArticles: "لا لارښود نه دی خپور شوی.",
		contact: "د بازار ملاتړ",
		noContact: "د ملاتړ تایید شوې لارې لا نه دي خپرې شوې.",
		navigation: "لارموندنه",
	},
	ar: {
		home: "الرئيسية",
		help: "مركز المساعدة",
		signin: "تسجيل الدخول",
		fallback: "نص بديل بالدَرية: لم يُضف نص هذه الفقرة باللغة المختارة بعد.",
		noArticles: "لم تُنشر أدلة بعد.",
		contact: "دعم المنصة",
		noContact: "لم تُنشر معلومات الدعم المعتمدة بعد.",
		navigation: "التنقل",
	},
};
