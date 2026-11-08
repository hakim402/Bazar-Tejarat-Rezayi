import type { Locale } from "./locales";

type BuyerOverviewCopy = {
	title: string;
	description: string;
	profileCard: string;
	email: string;
	verified: string;
	unverified: string;
	accountStatus: string;
	statusIndividual: string;
	statusCompany: string;
	statusPending: string;
	statusBasic: string;
	kpiOrders: string;
	kpiDeliveries: string;
	kpiPayments: string;
	kpiUnread: string;
	kpiUnavailable: string;
	kpiUnavailableHint: string;
	recentOrders: string;
	recentOrdersEmpty: string;
	viewAllOrders: string;
	recentNotifications: string;
	recentNotificationsEmpty: string;
	viewAllNotifications: string;
	quickActions: string;
	browseMarketplace: string;
	viewCart: string;
	viewMessages: string;
	viewSettings: string;
	signInTitle: string;
	signInDescription: string;
	signInAction: string;
	loading: string;
	retry: string;
};

export const buyerOverviewCopy: Record<Locale, BuyerOverviewCopy> = {
	"fa-AF": {
		title: "نمای کلی خریدار",
		description: "سفارش‌ها، پیام‌ها و اطلاعیه‌های شما در یک نگاه.",
		profileCard: "حساب من",
		email: "ایمیل",
		verified: "تأییدشده",
		unverified: "تأییدنشده",
		accountStatus: "وضعیت حساب",
		statusIndividual: "شخصی",
		statusCompany: "شرکتی",
		statusPending: "در انتظار بررسی",
		statusBasic: "پایه",
		kpiOrders: "سفارش‌ها",
		kpiDeliveries: "ارسال‌ها",
		kpiPayments: "پرداخت‌ها",
		kpiUnread: "پیام‌های خوانده‌نشده",
		kpiUnavailable: "در دسترس نیست",
		kpiUnavailableHint: "این آمار اکنون در دسترس نیست.",
		recentOrders: "سفارش‌های اخیر",
		recentOrdersEmpty: "هنوز سفارشی ثبت نشده است.",
		viewAllOrders: "همهٔ سفارش‌ها",
		recentNotifications: "اطلاعیه‌های اخیر",
		recentNotificationsEmpty: "اطلاعیه‌ای نیست.",
		viewAllNotifications: "همهٔ اطلاعیه‌ها",
		quickActions: "دسترسی سریع",
		browseMarketplace: "بازار را ببینید",
		viewCart: "سبد خرید",
		viewMessages: "پیام‌ها",
		viewSettings: "تنظیمات",
		signInTitle: "برای ادامه وارد شوید",
		signInDescription:
			"برای دیدن سفارش‌ها، پیام‌ها و اطلاعیه‌های خود وارد حساب خریدار شوید.",
		signInAction: "ورود به حساب خریدار",
		loading: "در حال بارگذاری…",
		retry: "تلاش دوباره",
	},
	en: {
		title: "Buyer overview",
		description: "Your orders, messages and notifications at a glance.",
		profileCard: "My account",
		email: "Email",
		verified: "Verified",
		unverified: "Not verified",
		accountStatus: "Account status",
		statusIndividual: "Individual",
		statusCompany: "Company",
		statusPending: "Under review",
		statusBasic: "Basic",
		kpiOrders: "Orders",
		kpiDeliveries: "Deliveries",
		kpiPayments: "Payments",
		kpiUnread: "Unread messages",
		kpiUnavailable: "Unavailable",
		kpiUnavailableHint: "This insight isn't available right now.",
		recentOrders: "Recent orders",
		recentOrdersEmpty: "No orders yet.",
		viewAllOrders: "All orders",
		recentNotifications: "Recent notifications",
		recentNotificationsEmpty: "No notifications.",
		viewAllNotifications: "All notifications",
		quickActions: "Quick actions",
		browseMarketplace: "Browse marketplace",
		viewCart: "Shopping cart",
		viewMessages: "Messages",
		viewSettings: "Settings",
		signInTitle: "Sign in to continue",
		signInDescription:
			"Sign in to your buyer account to see your orders, messages and notifications.",
		signInAction: "Sign in as buyer",
		loading: "Loading…",
		retry: "Try again",
	},
	ps: {
		title: "د پېرودونکي عمومي کتنه",
		description: "ستاسو فرمایشونه، پیغامونه او خبرتیاوې په یوه کتنه کې.",
		profileCard: "زما حساب",
		email: "بریښنالیک",
		verified: "تأیید شوی",
		unverified: "نه دی تأیید شوی",
		accountStatus: "د حساب حالت",
		statusIndividual: "شخصي",
		statusCompany: "شرکت",
		statusPending: "تر بیاکتنې لاندې",
		statusBasic: "اساسي",
		kpiOrders: "فرمایشونه",
		kpiDeliveries: "لېږدونه",
		kpiPayments: "تادیات",
		kpiUnread: "نه لوستل شوي پیغامونه",
		kpiUnavailable: "شتون نلري",
		kpiUnavailableHint: "دا شمېرې اوس مهال شتون نلري.",
		recentOrders: "وروستي فرمایشونه",
		recentOrdersEmpty: "تر اوسه کوم فرمایش نشته.",
		viewAllOrders: "ټول فرمایشونه",
		recentNotifications: "وروستۍ خبرتیاوې",
		recentNotificationsEmpty: "خبرتیا نشته.",
		viewAllNotifications: "ټولې خبرتیاوې",
		quickActions: "چټک لاسرسی",
		browseMarketplace: "بازار وګورئ",
		viewCart: "د پېرود کڅوړه",
		viewMessages: "پیغامونه",
		viewSettings: "تنظیمات",
		signInTitle: "د دوام لپاره ننوځئ",
		signInDescription:
			"د خپلو فرمایشونو، پیغامونو او خبرتیاوو د لیدلو لپاره د پېرودونکي حساب ته ننوځئ.",
		signInAction: "د پېرودونکي په توګه ننوتل",
		loading: "د بارېدو په حال کې…",
		retry: "بیا هڅه",
	},
	ar: {
		title: "نظرة المشتري",
		description: "طلباتك ورسائلك وإشعاراتك في لمحة.",
		profileCard: "حسابي",
		email: "البريد الإلكتروني",
		verified: "موثّق",
		unverified: "غير موثّق",
		accountStatus: "حالة الحساب",
		statusIndividual: "فردي",
		statusCompany: "شركة",
		statusPending: "قيد المراجعة",
		statusBasic: "أساسي",
		kpiOrders: "الطلبات",
		kpiDeliveries: "التوصيلات",
		kpiPayments: "المدفوعات",
		kpiUnread: "الرسائل غير المقروءة",
		kpiUnavailable: "غير متاح",
		kpiUnavailableHint: "هذه الإحصائية غير متاحة حالياً.",
		recentOrders: "الطلبات الأخيرة",
		recentOrdersEmpty: "لا توجد طلبات بعد.",
		viewAllOrders: "كل الطلبات",
		recentNotifications: "الإشعارات الأخيرة",
		recentNotificationsEmpty: "لا توجد إشعارات.",
		viewAllNotifications: "كل الإشعارات",
		quickActions: "إجراءات سريعة",
		browseMarketplace: "تصفح السوق",
		viewCart: "سلة التسوق",
		viewMessages: "الرسائل",
		viewSettings: "الإعدادات",
		signInTitle: "سجّل الدخول للمتابعة",
		signInDescription:
			"سجّل الدخول إلى حساب المشتري لعرض طلباتك ورسائلك وإشعاراتك.",
		signInAction: "الدخول كمشتري",
		loading: "جارٍ التحميل…",
		retry: "حاول مرة أخرى",
	},
};
