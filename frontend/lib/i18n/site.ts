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
		onThisPage: string;
		keepReading: string;
		pageGroups: { company: string; help: string; legal: string };
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
		onThisPage: "On this page",
		keepReading: "Keep reading",
		pageGroups: {
			company: "Company",
			help: "Help centre",
			legal: "Legal",
		},
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
		onThisPage: "در این صفحه",
		keepReading: "بخوانید",
		pageGroups: {
			company: "شرکت",
			help: "مرکز راهنما",
			legal: "حقوقی",
		},
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
		onThisPage: "په دې پاڼه کې",
		keepReading: "لولئ",
		pageGroups: {
			company: "شرکت",
			help: "د لارښود مرکز",
			legal: "حقوقي",
		},
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
		onThisPage: "في هذه الصفحة",
		keepReading: "اقرأ أيضاً",
		pageGroups: {
			company: "الشركة",
			help: "مركز المساعدة",
			legal: "قانوني",
		},
	},
};
