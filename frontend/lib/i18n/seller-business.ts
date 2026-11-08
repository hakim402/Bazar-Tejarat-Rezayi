import type { Locale } from "./locales";
const en = {
	title: "Business profiles",
	help: "Manage the profiles visible to your seller account. Each profile has its own review, approval and team access.",
	back: "Back to profiles",
	signInHelp:
		"Sign in with your seller account to manage your business profiles.",
	signIn: "Sign in",
	individualHelp:
		"Create an individual seller profile here. Company upgrades remain in Settings and require evidence and review.",
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
		help: "پروفایل‌های قابل دسترس حساب فروشندهٔ خود را مدیریت کنید. هر پروفایل بررسی، تأیید و دسترسی تیمی جداگانه دارد.",
		back: "بازگشت به پروفایل‌ها",
		signInHelp: "برای مدیریت پروفایل‌های تجارتی با حساب فروشندهٔ خود وارد شوید.",
		signIn: "ورود",
		individualHelp:
			"اینجا پروفایل فروشندهٔ فردی ایجاد کنید. ارتقا به شرکت در تنظیمات انجام می‌شود و به اسناد و بررسی نیاز دارد.",
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
		help: "د خپل پلورونکي حساب د لاسرسي وړ پروفایلونه اداره کړئ. هر پروفایل خپله بیاکتنه، تایید او د ټیم لاسرسی لري.",
		back: "پروفایلونو ته ستنېدل",
		signInHelp:
			"د سوداګریزو پروفایلونو د ادارې لپاره خپل پلورونکي حساب ته ننوځئ.",
		signIn: "ننوتل",
		individualHelp:
			"دلته د انفرادي پلورونکي پروفایل جوړ کړئ. شرکت ته لوړول په تنظیماتو کې کېږي او اسنادو او بیاکتنې ته اړتیا لري.",
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
		help: "أدر الملفات المتاحة لحساب البائع. لكل ملف مراجعته واعتماده وصلاحيات فريقه المستقلة.",
		back: "العودة إلى الملفات",
		signInHelp: "سجّل الدخول بحساب البائع لإدارة ملفات نشاطك التجاري.",
		signIn: "تسجيل الدخول",
		individualHelp:
			"أنشئ ملف بائع فردي هنا. تبقى الترقية إلى شركة في الإعدادات وتتطلب أدلة ومراجعة.",
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
