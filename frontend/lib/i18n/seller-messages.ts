import type { Locale } from "./locales";

const en = {
	help: "Private product enquiries for your selected business. Messages are not orders or agreed prices.",
	threadHelp:
		"Review the product snapshot and conversation before replying. History uses Kabul time.",
	business: "Selected business",
	businessManagement: "Business profiles",
	settings: "Settings",
	messagingAccess: "Messaging access",
	individual: "Individual",
	company: "Company",
	noBusiness: "No messaging business available",
	noBusinessHelp:
		"No business with messaging permission was returned for this account. Business management does not grant messaging access.",
	empty: "No conversations yet",
	emptyHelp:
		"Product enquiries for this business will appear here when a buyer starts a conversation.",
	noUnread: "No unread conversations on this page",
	noUnreadHelp:
		"View All to see conversations already read, or check another page.",
	emptyPage: "No conversations on this page",
	emptyPageHelp:
		"The inbox may have changed. Return to the first page to check the current list.",
	firstPage: "First page",
	returned: "Returned on this page",
	total: "Matching conversations",
	page: "Page",
	snapshot: "Product snapshot",
	reply: "Reply to this enquiry",
	attachments: "Add images (optional)",
	reportHelp:
		"Report a concern about this message. A report is not a message to the other participant.",
} as const;
type Copy = { [K in keyof typeof en]: string };
const fa: Copy = {
	help: "پرسش‌های خصوصی محصول برای شرکت انتخاب‌شدهٔ شما. پیام‌ها سفارش یا توافق قیمت نیستند.",
	threadHelp:
		"پیش از پاسخ، معلومات ثبت‌شدهٔ محصول و گفت‌وگو را بررسی کنید. سابقه به وقت کابل است.",
	business: "شرکت انتخاب‌شده",
	businessManagement: "پروفایل‌های تجارتی",
	settings: "تنظیمات",
	messagingAccess: "دسترسی پیام‌رسانی",
	individual: "انفرادی",
	company: "شرکت",
	noBusiness: "شرکت دارای دسترسی پیام‌رسانی موجود نیست",
	noBusinessHelp:
		"برای این حساب شرکتی با اجازهٔ پیام‌رسانی برگردانده نشد. مدیریت شرکت اجازهٔ پیام‌رسانی نمی‌دهد.",
	empty: "هنوز گفت‌وگویی نیست",
	emptyHelp:
		"وقتی خریدار گفت‌وگو را آغاز کند، پرسش‌های محصول این شرکت اینجا دیده می‌شوند.",
	noUnread: "در این صفحه گفت‌وگوی خوانده‌نشده نیست",
	noUnreadHelp:
		"برای دیدن گفت‌وگوهای خوانده‌شده، همه را انتخاب کنید یا صفحهٔ دیگری را بررسی کنید.",
	emptyPage: "در این صفحه گفت‌وگویی نیست",
	emptyPageHelp:
		"ممکن است صندوق پیام‌ها تغییر کرده باشد. برای بررسی فهرست فعلی به صفحهٔ نخست برگردید.",
	firstPage: "صفحهٔ نخست",
	returned: "برگردانده‌شده در این صفحه",
	total: "گفت‌وگوهای مطابق فیلتر",
	page: "صفحه",
	snapshot: "معلومات ثبت‌شدهٔ محصول",
	reply: "پاسخ به این پرسش",
	attachments: "افزودن تصویرها (اختیاری)",
	reportHelp:
		"نگرانی دربارهٔ این پیام را گزارش دهید. گزارش، پیام به طرف دیگر گفت‌وگو نیست.",
};
const ps: Copy = {
	help: "ستاسو د ټاکل شوې سوداګرۍ لپاره د محصول شخصي پوښتنې. پیغامونه فرمایشونه یا د بیې تړونونه نه دي.",
	threadHelp:
		"له ځواب مخکې د محصول ثبت شوي معلومات او خبرې وګورئ. مخینه د کابل په وخت ده.",
	business: "ټاکل شوې سوداګري",
	businessManagement: "سوداګریز پروفایلونه",
	settings: "تنظیمات",
	messagingAccess: "پیغامونو ته لاسرسی",
	individual: "انفرادي",
	company: "شرکت",
	noBusiness: "د پیغامونو سوداګري نشته",
	noBusinessHelp:
		"دې حساب ته د پیغامونو اجازه لرونکې سوداګري راونه ګرځول شوه. د سوداګرۍ مدیریت د پیغامونو اجازه نه ورکوي.",
	empty: "تر اوسه خبرې نشته",
	emptyHelp:
		"کله چې پېرودونکی خبرې پیل کړي، د دې سوداګرۍ د محصول پوښتنې به دلته ښکاره شي.",
	noUnread: "په دې پاڼه کې نالوستل شوې خبرې نشته",
	noUnreadHelp: "د لوستل شوو خبرو لپاره ټول وټاکئ یا بله پاڼه وګورئ.",
	emptyPage: "په دې پاڼه کې خبرې نشته",
	emptyPageHelp:
		"ښايي پیغامونه بدل شوي وي. د اوسني لېست د کتلو لپاره لومړۍ پاڼې ته لاړ شئ.",
	firstPage: "لومړۍ پاڼه",
	returned: "په دې پاڼه کې راګرځېدلي",
	total: "له چاڼ سره سمې خبرې",
	page: "پاڼه",
	snapshot: "د محصول ثبت شوي معلومات",
	reply: "دې پوښتنې ته ځواب",
	attachments: "انځورونه ورزیات کړئ (اختیاري)",
	reportHelp:
		"د دې پیغام په اړه اندېښنه راپور کړئ. راپور بل ګډونوال ته پیغام نه دی.",
};
const ar: Copy = {
	help: "استفسارات خاصة عن المنتجات للنشاط المحدد. الرسائل ليست طلبات أو اتفاقاً على السعر.",
	threadHelp: "راجع لقطة المنتج والمحادثة قبل الرد. يُعرض السجل بتوقيت كابل.",
	business: "النشاط المحدد",
	businessManagement: "الملفات التجارية",
	settings: "الإعدادات",
	messagingAccess: "صلاحية المراسلة",
	individual: "فردي",
	company: "شركة",
	noBusiness: "لا يوجد نشاط متاح للمراسلة",
	noBusinessHelp:
		"لم يُرجع أي نشاط بصلاحية المراسلة لهذا الحساب. إدارة النشاط لا تمنح صلاحية المراسلة.",
	empty: "لا توجد محادثات بعد",
	emptyHelp: "تظهر استفسارات منتجات هذا النشاط هنا عندما يبدأ مشترٍ محادثة.",
	noUnread: "لا توجد محادثات غير مقروءة في هذه الصفحة",
	noUnreadHelp: "اختر الكل لعرض المحادثات المقروءة أو راجع صفحة أخرى.",
	emptyPage: "لا توجد محادثات في هذه الصفحة",
	emptyPageHelp:
		"ربما تغير صندوق الرسائل. ارجع إلى الصفحة الأولى لمراجعة القائمة الحالية.",
	firstPage: "الصفحة الأولى",
	returned: "المُرجع في هذه الصفحة",
	total: "المحادثات المطابقة",
	page: "الصفحة",
	snapshot: "لقطة المنتج",
	reply: "الرد على هذا الاستفسار",
	attachments: "إضافة صور (اختياري)",
	reportHelp: "بلّغ عن مشكلة في هذه الرسالة. البلاغ ليس رسالة إلى الطرف الآخر.",
};
export const sellerMessagesCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": fa,
	ps,
	ar,
};
