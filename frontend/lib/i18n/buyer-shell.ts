import type { Locale } from "./locales";

type BuyerShellCopy = {
	workspace: string;
	overview: string;
	navigation: string;
	more: string;
	close: string;
	notifications: string;
	jumpTo: string;
	jumpPlaceholder: string;
	noPages: string;
	accountMenu: string;
	signOutError: string;
	shortcut: string;
	collapseSidebar: string;
	expandSidebar: string;
	recentNotifications: string;
	viewNotifications: string;
	notificationsDenied: string;
	notificationsUnavailable: string;
	shopping: string;
	ordersDelivery: string;
	paymentsAgreements: string;
	business: string;
	settingsSecurity: string;
	profile: string;
	sellerAccess: string;
	printHelp: string;
	signIn: string;
	signInDescription: string;
	welcome: string;
	localeCode: string;
};

export const buyerShellCopy: Record<Locale, BuyerShellCopy> = {
	"fa-AF": {
		workspace: "پنل خریدار",
		overview: "نمای کلی",
		navigation: "راهنمای صفحات",
		more: "بیشتر",
		close: "بستن",
		notifications: "اطلاعیه‌ها",
		jumpTo: "رفتن به صفحه",
		jumpPlaceholder: "جستجوی صفحات…",
		noPages: "صفحه‌ای یافت نشد.",
		accountMenu: "منوی حساب",
		signOutError: "خروج از حساب انجام نشد. دوباره تلاش کنید.",
		shortcut: "Ctrl / ⌘ K",
		collapseSidebar: "کوچک‌کردن نوار کناری",
		expandSidebar: "بازکردن نوار کناری",
		recentNotifications: "اطلاعیه‌های اخیر",
		viewNotifications: "همهٔ اطلاعیه‌ها",
		notificationsDenied: "اطلاعیه‌ها برای این حساب در دسترس نیستند.",
		notificationsUnavailable: "دریافت اطلاعیه‌ها ممکن نشد. دوباره تلاش کنید.",
		shopping: "خرید",
		ordersDelivery: "سفارش‌ها و ارسال",
		paymentsAgreements: "پرداخت‌ها و توافق‌ها",
		business: "کسب‌وکار",
		settingsSecurity: "تنظیمات و امنیت",
		profile: "حساب من",
		sellerAccess: "دسترسی فروشنده",
		printHelp: "برای چاپ یا ذخیره از گفتگوی مرورگر استفاده کنید.",
		signIn: "ورود به حساب",
		signInDescription: "برای دیدن سفارش‌ها، پیام‌ها و اطلاعیه‌ها وارد شوید.",
		welcome: "خوش آمدید",
		localeCode: "FA",
	},
	en: {
		workspace: "Buyer dashboard",
		overview: "Overview",
		navigation: "Navigation",
		more: "More",
		close: "Close",
		notifications: "Notifications",
		jumpTo: "Jump to page",
		jumpPlaceholder: "Search pages…",
		noPages: "No pages found.",
		accountMenu: "Account menu",
		signOutError: "Sign out failed. Try again.",
		shortcut: "Ctrl / ⌘ K",
		collapseSidebar: "Collapse sidebar",
		expandSidebar: "Expand sidebar",
		recentNotifications: "Recent notifications",
		viewNotifications: "All notifications",
		notificationsDenied: "Notifications aren't available for this account.",
		notificationsUnavailable: "Couldn't load notifications. Try again.",
		shopping: "Shopping",
		ordersDelivery: "Orders & delivery",
		paymentsAgreements: "Payments & agreements",
		business: "Business",
		settingsSecurity: "Settings & security",
		profile: "My account",
		sellerAccess: "Seller access",
		printHelp: "Use the browser dialog to print or save this invoice.",
		signIn: "Sign in",
		signInDescription: "Sign in to see your orders, messages and notifications.",
		welcome: "Welcome",
		localeCode: "EN",
	},
	ps: {
		workspace: "د پېرودونکي پینل",
		overview: "عمومي کتنه",
		navigation: "د پاڼو لارښود",
		more: "نور",
		close: "تړل",
		notifications: "خبرتیاوې",
		jumpTo: "پاڼې ته تلل",
		jumpPlaceholder: "پاڼې ولټوئ…",
		noPages: "کومه پاڼه ونه موندل شوه.",
		accountMenu: "د حساب غورنۍ",
		signOutError: "له حسابه وتل ناکام شول. بیا هڅه وکړئ.",
		shortcut: "Ctrl / ⌘ K",
		collapseSidebar: "د غاړې پټه کوچنۍ کړئ",
		expandSidebar: "د غاړې پټه پرانیزئ",
		recentNotifications: "وروستۍ خبرتیاوې",
		viewNotifications: "ټولې خبرتیاوې",
		notificationsDenied: "خبرتیاوې د دې حساب لپاره د لاسرسي وړ نه دي.",
		notificationsUnavailable: "خبرتیاوې ترلاسه نه شوې. بیا هڅه وکړئ.",
		shopping: "پېرود",
		ordersDelivery: "فرمایشونه او لېږد",
		paymentsAgreements: "تادیات او هوکړې",
		business: "سوداګري",
		settingsSecurity: "تنظیمات او امنیت",
		profile: "زما حساب",
		sellerAccess: "د پلورونکي لاسرسی",
		printHelp: "د دې رسید د چاپولو یا ساتلو لپاره د براوزر خبرې اترې وکاروئ.",
		signIn: "ننوتل",
		signInDescription:
			"د خپلو فرمایشونو، پیغامونو او خبرتیاوو د لیدلو لپاره ننوځئ.",
		welcome: "ښه راغلاست",
		localeCode: "PS",
	},
	ar: {
		workspace: "لوحة المشتري",
		overview: "نظرة عامة",
		navigation: "التنقل",
		more: "المزيد",
		close: "إغلاق",
		notifications: "الإشعارات",
		jumpTo: "الانتقال إلى صفحة",
		jumpPlaceholder: "البحث عن صفحات…",
		noPages: "لم يتم العثور على صفحات.",
		accountMenu: "قائمة الحساب",
		signOutError: "تعذّر تسجيل الخروج. حاول مرة أخرى.",
		shortcut: "Ctrl / ⌘ K",
		collapseSidebar: "تصغير الشريط الجانبي",
		expandSidebar: "توسيع الشريط الجانبي",
		recentNotifications: "الإشعارات الأخيرة",
		viewNotifications: "كل الإشعارات",
		notificationsDenied: "الإشعارات غير متاحة لهذا الحساب.",
		notificationsUnavailable: "تعذر تحميل الإشعارات. حاول مرة أخرى.",
		shopping: "التسوق",
		ordersDelivery: "الطلبات والتوصيل",
		paymentsAgreements: "المدفوعات والاتفاقيات",
		business: "الأعمال",
		settingsSecurity: "الإعدادات والأمان",
		profile: "حسابي",
		sellerAccess: "الوصول كبائع",
		printHelp: "استخدم مربع حوار المتصفح لطباعة هذه الفاتورة أو حفظها.",
		signIn: "تسجيل الدخول",
		signInDescription: "سجّل الدخول لعرض طلباتك ورسائلك وإشعاراتك.",
		welcome: "أهلاً",
		localeCode: "AR",
	},
};
