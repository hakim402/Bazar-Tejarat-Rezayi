import type { Locale } from "./locales";

const en = {
	subtitle: "Choose a new password for your buyer and seller accounts.",
	formTitle: "Set a new password",
	formHelp: "Enter your current password, then choose a new one.",
	changeAction: "Change password",
	currentDenied: "Your current password could not be verified.",
	weakPassword: "Use a stronger password of at least 12 characters.",
	fieldError: "Check this field.",
	show: "Show password",
	hide: "Hide password",
	recoveryTitle: "Forgot your password?",
	recoveryHelp: "Reset it by email without signing in.",
	recoveryAction: "Reset by email",
	successTitle: "Password changed",
	toast: "Password changed.",
};

type Copy = typeof en;

const fa: Copy = {
	subtitle: "برای حساب‌های خریدار و فروشنده خود رمز تازه انتخاب کنید.",
	formTitle: "رمز عبور تازه",
	formHelp: "رمز فعلی را وارد کنید، سپس رمز تازه انتخاب نمایید.",
	changeAction: "تغییر رمز عبور",
	currentDenied: "رمز فعلی شما تأیید نشد.",
	weakPassword: "از رمز قوی‌تر با دست‌کم ۱۲ نویسه استفاده کنید.",
	fieldError: "این بخش را بررسی کنید.",
	show: "نمایش رمز",
	hide: "پنهان کردن رمز",
	recoveryTitle: "رمز عبور را فراموش کرده‌اید؟",
	recoveryHelp: "بدون ورود، از راه ایمیل بازنشانی کنید.",
	recoveryAction: "بازنشانی از راه ایمیل",
	successTitle: "رمز عبور تغییر کرد",
	toast: "رمز عبور تغییر کرد.",
};

const ps: Copy = {
	subtitle: "د خپل پېرودونکي او پلورونکي حسابونو لپاره نوی پټنوم وټاکئ.",
	formTitle: "نوی پټنوم وټاکئ",
	formHelp: "اوسنی پټنوم ولیکئ، بیا نوی پټنوم وټاکئ.",
	changeAction: "پټنوم بدل کړئ",
	currentDenied: "ستاسو اوسنی پټنوم تایید نه شو.",
	weakPassword: "لږ تر لږه ۱۲ توري پیاوړی پټنوم وکاروئ.",
	fieldError: "دا برخه وګورئ.",
	show: "پټنوم ښکاره کړئ",
	hide: "پټنوم پټ کړئ",
	recoveryTitle: "پټنوم مو هېر شوی؟",
	recoveryHelp: "پرته له ننوتلو، د برېښنالیک له لارې بیا وټاکئ.",
	recoveryAction: "د برېښنالیک له لارې بیا ټاکل",
	successTitle: "پټنوم بدل شو",
	toast: "پټنوم بدل شو.",
};

const ar: Copy = {
	subtitle: "اختر كلمة مرور جديدة لحسابي المشتري والبائع.",
	formTitle: "تعيين كلمة مرور جديدة",
	formHelp: "أدخل كلمة المرور الحالية، ثم اختر كلمة جديدة.",
	changeAction: "تغيير كلمة المرور",
	currentDenied: "تعذّر التحقق من كلمة المرور الحالية.",
	weakPassword: "استخدم كلمة مرور أقوى من 12 حرفاً على الأقل.",
	fieldError: "راجع هذا الحقل.",
	show: "إظهار كلمة المرور",
	hide: "إخفاء كلمة المرور",
	recoveryTitle: "نسيت كلمة المرور؟",
	recoveryHelp: "أعد تعيينها عبر البريد دون تسجيل الدخول.",
	recoveryAction: "إعادة التعيين عبر البريد",
	successTitle: "تم تغيير كلمة المرور",
	toast: "تم تغيير كلمة المرور.",
};

export const buyerPasswordCopy: Record<Locale, Copy> = {
	"fa-AF": fa,
	en,
	ps,
	ar,
};
