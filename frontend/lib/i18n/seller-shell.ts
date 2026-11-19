import type { Locale } from "./locales";

type SellerShellCopy = {
	stockAlerts: string;
	currentQueue: string;
	stockChartHelp: string;
	overviewLoadFailed: string;
	store: string;
	sales: string;
	buyers: string;
	business: string;
	account: string;
	navigation: string;
	more: string;
	close: string;
	notifications: string;
	jumpTo: string;
	jumpPlaceholder: string;
	noPages: string;
	accountMenu: string;
	signOutError: string;
	localeCode: string;
	shortcut: string;
	settingsSecurity: string;
	workspace: string;
	overviewDescription: string;
	salesUnavailable: string;
	salesUnavailableHint: string;
	ordersUnavailable: string;
	ordersUnavailableHint: string;
	productsUnavailable: string;
	productsUnavailableHint: string;
	messagesUnavailable: string;
	messagesDenied: string;
	attentionCategoriesHint: string;
	collapseSidebar: string;
	expandSidebar: string;
	recentNotifications: string;
	viewNotifications: string;
	notificationsDenied: string;
	notificationsUnavailable: string;
	glanceTotal: string;
	glanceSetup: string;
	glanceInactive: string;
	glanceZero: string;
	glanceLow: string;
	glanceExpired: string;
	glanceExpiring: string;
	glanceHeld: string;
};

export const sellerShellCopy: Record<Locale, SellerShellCopy> = {
	"fa-AF": {
		stockAlerts: "هشدارهای موجودی",
		currentQueue: "در حال حاضر منتظر ارسال",
		stockChartHelp:
			"تعداد گزینه‌های محصول، نه واحدهای کالا. گروه‌ها می‌توانند هم‌پوشانی داشته باشند؛ برای بررسی موجودی یک گروه را انتخاب کنید.",
		overviewLoadFailed:
			"فعالیت سفارش‌ها دریافت نشد. برای بررسی سوابق، صفحهٔ سفارش‌ها را باز کنید.",
		store: "فروشگاه",
		collapseSidebar: "کوچک‌کردن نوار کناری",
		expandSidebar: "بازکردن نوار کناری",
		recentNotifications: "اطلاعیه‌های اخیر",
		viewNotifications: "همهٔ اطلاعیه‌ها",
		notificationsDenied: "اطلاعیه‌ها برای این حساب یا کسب‌وکار در دسترس نیستند.",
		notificationsUnavailable: "دریافت اطلاعیه‌ها ممکن نشد. دوباره تلاش کنید.",
		glanceTotal: "همه",
		glanceSetup: "تنظیم‌نشده",
		glanceInactive: "غیرفعال",
		glanceZero: "تمام‌شده",
		glanceLow: "کم",
		glanceExpired: "تاریخ‌گذشته",
		glanceExpiring: "رو به انقضا",
		glanceHeld: "رزروشده",
		settingsSecurity: "حساب",
		workspace: "پنل فروشنده",
		overviewDescription: "کسب‌وکار، موجودی و گام‌های بعدی شما در یک جا.",
		salesUnavailable: "آمار فروش هنوز متصل نشده است",
		salesUnavailableHint:
			"این نمای کلی تاریخچهٔ فروش را دریافت نمی‌کند. درآمد یا روند فروش تخمین زده نمی‌شود.",
		ordersUnavailable: "خلاصهٔ سفارش‌ها هنوز متصل نشده است",
		ordersUnavailableHint:
			"برای دیدن سوابق قابل دسترس، صفحهٔ سفارش‌ها را باز کنید.",
		productsUnavailable: "رتبه‌بندی محصولات هنوز متصل نشده است",
		productsUnavailableHint:
			"کتالوگ شما در دسترس است؛ رتبه‌بندی فروش به این نمای کلی فرستاده نمی‌شود.",
		messagesUnavailable: "دریافت پیام‌های اخیر ممکن نشد.",
		messagesDenied: "پیام‌ها برای این حساب یا کسب‌وکار در دسترس نیستند.",
		attentionCategoriesHint:
			"گروه‌های صفر، کم و تاریخ‌گذشته می‌توانند هم‌پوشانی داشته باشند.",
		sales: "فروش",
		buyers: "خریداران",
		business: "کسب‌وکار",
		account: "حساب",
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
		localeCode: "FA",
	},
	en: {
		stockAlerts: "Stock alerts",
		currentQueue: "Currently waiting for dispatch",
		stockChartHelp:
			"Counts of product options, not units. Categories can overlap; select one to review its stock.",
		overviewLoadFailed:
			"Order activity could not be loaded. Open Orders to review your records.",
		store: "Store",
		collapseSidebar: "Collapse sidebar",
		expandSidebar: "Expand sidebar",
		recentNotifications: "Recent notifications",
		viewNotifications: "All notifications",
		notificationsDenied:
			"Notifications aren't available for this account or business.",
		notificationsUnavailable: "Couldn't load notifications. Try again.",
		glanceTotal: "Total",
		glanceSetup: "Not set up",
		glanceInactive: "Inactive",
		glanceZero: "Out of stock",
		glanceLow: "Low",
		glanceExpired: "Expired",
		glanceExpiring: "Expiring soon",
		glanceHeld: "Held",
		settingsSecurity: "Account",
		workspace: "Seller workspace",
		overviewDescription: "Your business, stock and next steps in one place.",
		salesUnavailable: "Sales insights aren't connected yet",
		salesUnavailableHint:
			"This Overview doesn't receive sales history. No revenue or trend is estimated.",
		ordersUnavailable: "Order summary isn't connected yet",
		ordersUnavailableHint:
			"Open Orders to review the current records you can access.",
		productsUnavailable: "Product rankings aren't connected yet",
		productsUnavailableHint:
			"Your catalogue is available; sales rankings aren't supplied to this Overview.",
		messagesUnavailable: "Couldn't load recent messages.",
		messagesDenied: "Messages aren't available for this account or business.",
		attentionCategoriesHint: "Zero, low and expired categories can overlap.",
		sales: "Sales",
		buyers: "Buyers",
		business: "Business",
		account: "Account",
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
		localeCode: "EN",
	},
	ps: {
		stockAlerts: "د موجودۍ خبرتیاوې",
		currentQueue: "اوس د لېږلو په تمه",
		stockChartHelp:
			"د محصول د بڼو شمېر، نه د توکو واحدونه. ډلې یو له بل سره ګډېدای شي؛ د موجودۍ کتلو لپاره یوه ډله وټاکئ.",
		overviewLoadFailed:
			"د فرمایشونو فعالیت ترلاسه نه شو. د خپلو ریکارډونو کتلو لپاره فرمایشونه پرانیزئ.",
		store: "پلورنځی",
		collapseSidebar: "د غاړې پټه کوچنۍ کړئ",
		expandSidebar: "د غاړې پټه پرانیزئ",
		recentNotifications: "وروستۍ خبرتیاوې",
		viewNotifications: "ټولې خبرتیاوې",
		notificationsDenied:
			"خبرتیاوې د دې حساب یا سوداګرۍ لپاره د لاسرسي وړ نه دي.",
		notificationsUnavailable: "خبرتیاوې ترلاسه نه شوې. بیا هڅه وکړئ.",
		glanceTotal: "ټول",
		glanceSetup: "نه تنظیم شوي",
		glanceInactive: "غیرفعال",
		glanceZero: "خلاص شوي",
		glanceLow: "کم",
		glanceExpired: "نېټه تېره",
		glanceExpiring: "ژر پای ته رسېږي",
		glanceHeld: "ساتل شوي",
		settingsSecurity: "حساب",
		workspace: "د پلورونکي کاري ځای",
		overviewDescription:
			"ستاسو سوداګري، موجودي او راتلونکي ګامونه په یوه ځای کې.",
		salesUnavailable: "د پلور شمېرې لا نه دي نښلول شوې",
		salesUnavailableHint:
			"دا عمومي کتنه د پلور تاریخچه نه ترلاسه کوي. عاید یا د پلور بهیر نه اټکل کېږي.",
		ordersUnavailable: "د فرمایشونو لنډیز لا نه دی نښلول شوی",
		ordersUnavailableHint:
			"د لاسرسي وړ سوابقو د کتلو لپاره د فرمایشونو پاڼه پرانیزئ.",
		productsUnavailable: "د محصولاتو درجه بندي لا نه ده نښلول شوې",
		productsUnavailableHint:
			"ستاسو کتلاګ شته؛ د پلور درجه بندي دې عمومي کتنې ته نه ورکول کېږي.",
		messagesUnavailable: "وروستي پیغامونه ترلاسه نه شول.",
		messagesDenied: "پیغامونه د دې حساب یا سوداګرۍ لپاره د لاسرسي وړ نه دي.",
		attentionCategoriesHint: "د صفر، کمې او تېرې نېټې ډلې یو پر بل راتلای شي.",
		sales: "پلور",
		buyers: "پېرودونکي",
		business: "سوداګري",
		account: "حساب",
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
		localeCode: "PS",
	},
	ar: {
		stockAlerts: "تنبيهات المخزون",
		currentQueue: "بانتظار الإرسال حاليًا",
		stockChartHelp:
			"أعداد خيارات المنتجات، وليست الوحدات. قد تتداخل الفئات؛ اختر فئة لمراجعة مخزونها.",
		overviewLoadFailed: "تعذّر تحميل نشاط الطلبات. افتح الطلبات لمراجعة سجلاتك.",
		store: "المتجر",
		collapseSidebar: "تصغير الشريط الجانبي",
		expandSidebar: "توسيع الشريط الجانبي",
		recentNotifications: "الإشعارات الأخيرة",
		viewNotifications: "كل الإشعارات",
		notificationsDenied: "الإشعارات غير متاحة لهذا الحساب أو النشاط التجاري.",
		notificationsUnavailable: "تعذر تحميل الإشعارات. حاول مرة أخرى.",
		glanceTotal: "الإجمالي",
		glanceSetup: "غير مهيأ",
		glanceInactive: "غير نشط",
		glanceZero: "نفد المخزون",
		glanceLow: "منخفض",
		glanceExpired: "منتهي",
		glanceExpiring: "قريب الانتهاء",
		glanceHeld: "محجوز",
		settingsSecurity: "الحساب",
		workspace: "مساحة البائع",
		overviewDescription: "أعمالك ومخزونك وخطواتك التالية في مكان واحد.",
		salesUnavailable: "إحصاءات المبيعات غير متصلة بعد",
		salesUnavailableHint:
			"لا تتلقى هذه النظرة العامة سجل المبيعات. لا يتم تقدير الإيرادات أو الاتجاهات.",
		ordersUnavailable: "ملخص الطلبات غير متصل بعد",
		ordersUnavailableHint:
			"افتح الطلبات لمراجعة السجلات التي يمكنك الوصول إليها.",
		productsUnavailable: "ترتيب المنتجات غير متصل بعد",
		productsUnavailableHint:
			"كتالوجك متاح؛ ترتيب المبيعات غير متوفر في هذه النظرة العامة.",
		messagesUnavailable: "تعذر تحميل الرسائل الأخيرة.",
		messagesDenied: "الرسائل غير متاحة لهذا الحساب أو النشاط التجاري.",
		attentionCategoriesHint: "قد تتداخل فئات المخزون الصفري والمنخفض والمنتهي.",
		sales: "المبيعات",
		buyers: "المشترون",
		business: "الأعمال",
		account: "الحساب",
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
		localeCode: "AR",
	},
};
