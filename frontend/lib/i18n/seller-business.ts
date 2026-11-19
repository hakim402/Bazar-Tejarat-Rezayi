import type { Locale } from "./locales";
const en = {
	title: "Business profiles",
	help: "Manage your individual and company business profiles, verification and team access for eligible companies.",
	back: "Back to profiles",
	signInHelp:
		"Sign in with your seller account to manage your business profiles.",
	signIn: "Sign in",
	individualHelp:
		"Individual and company profiles have separate verification requirements. Team access depends on company eligibility and your role.",
	authorityHelp:
		"Business approval and profile management do not grant permission to sell, manage stock or view messages. Each destination checks its own current access.",
	email: "Account email verification",
	verified: "Verified",
	unverified: "Not verified",
	verification: "Verification",
	refreshFailed:
		"Could not refresh the current state. A saved command must not be posted again. Reload before making another change.",
};
type Copy = typeof en;
export const sellerBusinessCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		title: "پروفایل‌های کسب‌وکار",
		help: "پروفایل‌های کسب‌وکار فردی و شرکتی، تأیید آن‌ها و دسترسی تیمی شرکت‌های واجد شرایط را مدیریت کنید.",
		back: "بازگشت به پروفایل‌ها",
		signInHelp: "برای مدیریت پروفایل‌های تجارتی با حساب فروشندهٔ خود وارد شوید.",
		signIn: "ورود",
		individualHelp:
			"پروفایل‌های فردی و شرکتی شرایط تأیید جداگانه دارند. دسترسی تیمی به واجد شرایط بودن شرکت و نقش شما بستگی دارد.",
		authorityHelp:
			"تأیید کسب‌وکار و مدیریت پروفایل، صلاحیت فروش، مدیریت موجودی یا دیدن پیام‌ها را نمی‌دهد. هر بخش دسترسی فعلی خود را بررسی می‌کند.",
		email: "تأیید ایمیل حساب",
		verified: "تأییدشده",
		unverified: "تأیید نشده",
		verification: "تأیید",
		refreshFailed:
			"وضعیت فعلی دوباره بارگیری نشد. دستور ذخیره‌شده را دوباره ارسال نکنید. پیش از تغییر بعدی، دوباره بارگیری کنید.",
	},
	ps: {
		title: "د سوداګرۍ پروفایلونه",
		help: "خپل انفرادي او شرکتي سوداګریز پروفایلونه، تایید او د وړ شرکتونو د ټیم لاسرسی اداره کړئ.",
		back: "پروفایلونو ته ستنېدل",
		signInHelp:
			"د سوداګریزو پروفایلونو د ادارې لپاره خپل پلورونکي حساب ته ننوځئ.",
		signIn: "ننوتل",
		individualHelp:
			"انفرادي او شرکتي پروفایلونه د تایید جلا شرایط لري. د ټیم لاسرسی د شرکت په وړتیا او ستاسو په رول پورې اړه لري.",
		authorityHelp:
			"د سوداګرۍ تایید او د پروفایل اداره د پلور، موجودۍ ادارې یا پیغامونو لیدلو اجازه نه ورکوي. هره برخه خپل اوسنی لاسرسی ګوري.",
		email: "د حساب برېښنالیک تایید",
		verified: "تایید شوی",
		unverified: "تایید نه دی شوی",
		verification: "تایید",
		refreshFailed:
			"اوسنی حالت بیا پورته نه شو. خوندي شوی امر بیا مه لېږئ. د بل بدلون مخکې حالت بیا پورته کړئ.",
	},
	ar: {
		title: "ملفات الأعمال",
		help: "أدر ملفات أعمالك الفردية وملفات الشركات والتحقق منها وصلاحيات فرق الشركات المؤهلة.",
		back: "العودة إلى الملفات",
		signInHelp: "سجّل الدخول بحساب البائع لإدارة ملفات نشاطك التجاري.",
		signIn: "تسجيل الدخول",
		individualHelp:
			"للملفات الفردية وملفات الشركات متطلبات تحقق مختلفة. تعتمد صلاحيات الفريق على أهلية الشركة ودورك.",
		authorityHelp:
			"اعتماد النشاط وإدارة الملف لا يمنحان صلاحية البيع أو إدارة المخزون أو عرض الرسائل. تتحقق كل وجهة من صلاحياتها الحالية.",
		email: "التحقق من بريد الحساب",
		verified: "تم التحقق",
		unverified: "لم يتم التحقق",
		verification: "التحقق",
		refreshFailed:
			"تعذر تحديث الحالة الحالية. لا ترسل الأمر المحفوظ مرة أخرى. أعد تحميل الحالة قبل إجراء تغيير آخر.",
	},
};
