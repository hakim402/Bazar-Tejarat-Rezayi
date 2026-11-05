import type { Locale } from "../../lib/i18n/locales";
export const commerceCopy: Record<
	Locale,
	Record<
		| "cart"
		| "reconcile"
		| "quantityInvalid"
		| "guestUnavailable"
		| "guestCartChanged"
		| "useCurrentCart"
		| "guestCartReady"
		| "termsLoading"
		| "termsUnavailable"
		| "termsDependency"
		| "termsUnconfigured"
		| "add"
		| "quantity"
		| "tier"
		| "retail"
		| "wholesale"
		| "update"
		| "remove"
		| "empty"
		| "checkout"
		| "orders"
		| "invoices"
		| "terms"
		| "merge"
		| "merged"
		| "signIn"
		| "loading"
		| "error"
		| "retry"
		| "pending"
		| "currentPrice"
		| "delivery"
		| "unreserved"
		| "submit"
		| "advance"
		| "cod"
		| "country"
		| "city"
		| "method"
		| "enabled"
		| "allCities"
		| "cities"
		| "reason"
		| "save"
		| "reload"
		| "goods"
		| "total"
		| "due"
		| "issued"
		| "accepted"
		| "unpaid"
		| "notDispatched"
		| "unavailable"
		| "minimum"
		| "increment"
		| "source"
		| "priceChanged"
		| "shownEstimate"
		| "acceptedUnitPrice"
		| "previous"
		| "next"
		| "print"
		| "pdf"
		| "business"
		| "choose"
		| "currency"
		| "fixed"
		| "negotiable"
		| "saved"
		| "review"
		| "resume"
		| "destination"
		| "history"
		| "documentError"
		| "termsHelp"
		| "retryHelp"
		| "wholesaleHelp"
		| "estimate"
		| "stock_unconfigured"
		| "stock_shortage"
		| "destination_unavailable"
		| "method_unavailable"
		| "cart_changed"
		| "tier_unavailable"
		| "seller_unavailable"
		| "frozen",
		string
	>
> = {
	en: {
		reconcile: "Reconcile request and edit",
		guestCartChanged:
			"Your guest cart changed in another tab or expired. The earlier request may already have been merged or applied. It will not be added again.",
		useCurrentCart: "Use current guest cart",
		guestCartReady:
			"Current guest cart selected. Nothing was added. Review the quantity, then choose Add to cart if you want a new addition.",
		guestUnavailable:
			"Guest cart needs secure cross-tab browser support. Sign in as a buyer or use a supported browser.",
		quantityInvalid:
			"Enter a positive quantity that matches the displayed increment.",
		termsLoading: "Loading this seller’s terms…",
		termsUnavailable:
			"This seller is unavailable. Exclude its selections to continue with other sellers.",
		termsDependency:
			"This seller’s terms could not be loaded. Retry, or exclude its selections.",
		termsUnconfigured:
			"Checkout has not been configured for this seller. Exclude its selections to continue.",
		cart: "Cart",
		add: "Add to cart",
		quantity: "Quantity",
		tier: "Price tier",
		retail: "Retail",
		wholesale: "Wholesale",
		update: "Update",
		remove: "Remove",
		empty: "Your cart is empty.",
		checkout: "Checkout",
		orders: "Orders",
		invoices: "Invoices",
		terms: "Checkout settings",
		merge: "Merge saved guest selections",
		merged: "Saved selections merged.",
		signIn: "Sign in as buyer",
		loading: "Loading…",
		error:
			"Unable to complete this request. Reload current data or retry the same request.",
		retry: "Retry same request",
		pending: "Pending — outcome unresolved",
		currentPrice:
			"Checkout uses current server prices; displayed estimates may change.",
		delivery:
			"Delivery amount pending; arranged and paid separately. Excluded from goods total.",
		unreserved:
			"Stock remains unreserved on acceptance alone. Manage goods receipts in Payments and physical delivery in Deliveries / Fulfilment.",
		submit: "Submit fixed-price orders",
		advance: "Advance",
		cod: "Cash on delivery",
		country: "Country (ISO code)",
		city: "City",
		method: "Payment method",
		enabled: "Enable checkout",
		allCities: "All cities",
		cities: "Allowed cities (one per line)",
		reason: "Reason",
		save: "Save",
		reload: "Reload current data",
		goods: "Goods amount",
		total: "Goods total",
		due: "Advance due (Kabul time)",
		issued: "Issued",
		accepted: "Accepted",
		unpaid: "Unpaid",
		notDispatched: "Not dispatched",
		unavailable: "Unavailable selection",
		minimum: "Wholesale minimum",
		increment: "Increment",
		source: "Source language",
		priceChanged: "Price updated at acceptance",
		shownEstimate: "Previously shown estimate",
		acceptedUnitPrice: "Accepted unit price",
		previous: "Previous",
		next: "Next",
		print: "Printable invoice",
		pdf: "Download PDF",
		business: "Business",
		choose: "Choose",
		currency: "Currency",
		fixed: "Fixed price",
		negotiable: "Negotiable — saved for later negotiation",
		saved: "Saved to cart",
		review: "Review current estimate",
		resume: "Resume pending sellers",
		destination: "Destination",
		history: "Submission history",
		documentError:
			"Invoice rendering is temporarily unavailable. The accepted order is retained.",
		termsHelp:
			"Only approved business owners can configure allowed destinations and methods. Checkout starts disabled.",
		retryHelp:
			"Keep this exact request until its outcome is reconciled; accepted sellers are never purchased again by retry.",
		wholesaleHelp:
			"Wholesale requires a currently approved business-buyer profile and the variant minimum. Choose retail explicitly if needed.",
		estimate: "Estimated goods total",
		stock_unconfigured:
			"Stock availability is not configured. These selections were retained.",
		stock_shortage:
			"The requested goods quantity is unavailable. These selections were retained.",
		destination_unavailable:
			"The selected destination is no longer allowed. Review the retained selections.",
		method_unavailable:
			"The selected payment method is unavailable. Review the retained selections.",
		cart_changed:
			"Your cart changed. Review the retained quantities before a new submission.",
		tier_unavailable:
			"The selected price tier is unavailable. Choose another tier explicitly.",
		seller_unavailable:
			"This seller or listing is currently unavailable. These selections were retained.",
		frozen: "Accepted prices and quantities stay fixed on this agreement.",
	},
	"fa-AF": {
		reconcile: "بررسی درخواست و ویرایش",
		guestCartChanged:
			"سبد مهمان شما در زبانهٔ دیگر تغییر کرده یا منقضی شده است. درخواست قبلی شاید قبلاً ثبت یا با حساب شما یکجا شده باشد. دوباره افزوده نمی‌شود.",
		useCurrentCart: "استفاده از سبد مهمان فعلی",
		guestCartReady:
			"سبد مهمان فعلی انتخاب شد. چیزی افزوده نشد. مقدار را بررسی کنید و برای افزودن تازه، دکمهٔ افزودن به سبد را بزنید.",
		guestUnavailable:
			"سبد مهمان به مرورگر با پشتیبانی امن چند زبانه نیاز دارد. به حساب خریدار وارد شوید یا مرورگر پشتیبانی‌شده به کار ببرید.",
		quantityInvalid: "مقدار مثبت مطابق گام نمایش‌داده‌شده وارد کنید.",
		termsLoading: "شرایط این فروشنده در حال دریافت است…",
		termsUnavailable:
			"این فروشنده در دسترس نیست. برای ادامه با دیگران، کالاهایش را از انتخاب خارج کنید.",
		termsDependency:
			"شرایط این فروشنده دریافت نشد. دوباره تلاش کنید یا کالاهایش را از انتخاب خارج کنید.",
		termsUnconfigured:
			"این فروشنده شرایط خرید را تنظیم نکرده است. برای ادامه، کالاهایش را از انتخاب خارج کنید.",
		cart: "سبد خرید",
		add: "افزودن به سبد",
		quantity: "مقدار",
		tier: "نوع قیمت",
		retail: "پرچون",
		wholesale: "عمده",
		update: "به‌روزرسانی",
		remove: "حذف",
		empty: "سبد شما خالی است.",
		checkout: "تکمیل خرید",
		orders: "سفارش‌ها",
		invoices: "صورتحساب‌ها",
		terms: "تنظیمات خرید",
		merge: "یکجا کردن انتخاب‌های مهمان",
		merged: "انتخاب‌ها یکجا شد.",
		signIn: "ورود به حساب خریدار",
		loading: "در حال بارگیری…",
		error:
			"درخواست تکمیل نشد. داده‌های تازه را بارگیری یا همان درخواست را دوباره تلاش کنید.",
		retry: "تلاش دوبارهٔ همان درخواست",
		pending: "در انتظار — نتیجه روشن نیست",
		currentPrice:
			"خرید با قیمت فعلی سرور انجام می‌شود؛ برآورد نمایش‌یافته ممکن است تغییر کند.",
		delivery:
			"هزینهٔ تحویل هنوز تعیین نشده؛ جداگانه تنظیم و پرداخت می‌شود و شامل مجموع کالا نیست.",
		unreserved:
			"پذیرش سفارش به‌تنهایی موجودی را ذخیره نمی‌کند. دریافت پول کالا در پرداخت‌ها و تحویل واقعی در بخش تحویل و ارسال مدیریت می‌شود.",
		submit: "ثبت سفارش‌های قیمت ثابت",
		advance: "پیش‌پرداخت",
		cod: "پرداخت هنگام تحویل",
		country: "کشور (کد ISO)",
		city: "شهر",
		method: "روش پرداخت",
		enabled: "فعال‌سازی خرید",
		allCities: "همهٔ شهرها",
		cities: "شهرهای مجاز (هر سطر یک شهر)",
		reason: "دلیل",
		save: "ذخیره",
		reload: "بارگیری داده‌های تازه",
		goods: "مبلغ کالا",
		total: "مجموع کالا",
		due: "مهلت پیش‌پرداخت (وقت کابل)",
		issued: "صدور",
		accepted: "پذیرفته‌شده",
		unpaid: "پرداخت‌نشده",
		notDispatched: "ارسال‌نشده",
		unavailable: "انتخاب در دسترس نیست",
		minimum: "حداقل عمده",
		increment: "گام مقدار",
		source: "زبان منبع",
		priceChanged: "قیمت هنگام پذیرش تغییر کرد",
		shownEstimate: "برآورد نمایش‌داده‌شدهٔ قبلی",
		acceptedUnitPrice: "قیمت واحد پذیرفته‌شده",
		previous: "قبلی",
		next: "بعدی",
		print: "صورتحساب قابل چاپ",
		pdf: "دانلود PDF",
		business: "کسب‌وکار",
		choose: "انتخاب",
		currency: "پول",
		fixed: "قیمت ثابت",
		negotiable: "توافقی — برای مذاکرهٔ بعدی ذخیره شده",
		saved: "به سبد افزوده شد",
		review: "دیدن برآورد فعلی",
		resume: "ادامهٔ فروشندگان در انتظار",
		destination: "مقصد",
		history: "پیشینهٔ درخواست‌ها",
		documentError: "ایجاد سند موقتاً در دسترس نیست. سفارش پذیرفته‌شده محفوظ است.",
		termsHelp:
			"تنها مالک کسب‌وکار تأییدشده می‌تواند مقصدها و روش‌های مجاز را تنظیم کند. خرید در آغاز غیرفعال است.",
		retryHelp:
			"تا روشن شدن نتیجه همین درخواست را نگه دارید؛ تلاش دوباره سفارش پذیرفته‌شده را تکرار نمی‌کند.",
		wholesaleHelp:
			"خرید عمده به حساب تجارتی تأییدشدهٔ خریدار و حداقل مقدار نیاز دارد. در صورت نیاز پرچون را خودتان انتخاب کنید.",
		estimate: "برآورد مجموع کالا",
		stock_unconfigured:
			"موجودی هنوز تنظیم نشده است. انتخاب‌ها در سبد محفوظ است.",
		stock_shortage:
			"مقدار درخواستی کالا در دسترس نیست. انتخاب‌ها در سبد محفوظ است.",
		destination_unavailable:
			"مقصد انتخاب‌شده دیگر مجاز نیست. انتخاب‌های محفوظ را بررسی کنید.",
		method_unavailable:
			"روش پرداخت انتخاب‌شده در دسترس نیست. انتخاب‌های محفوظ را بررسی کنید.",
		cart_changed:
			"سبد شما تغییر کرد. پیش از درخواست تازه مقدارهای محفوظ را بررسی کنید.",
		tier_unavailable:
			"نوع قیمت انتخاب‌شده در دسترس نیست. نوع دیگر را خودتان انتخاب کنید.",
		seller_unavailable:
			"فروشنده یا محصول فعلاً در دسترس نیست. انتخاب‌ها در سبد محفوظ است.",
		frozen: "قیمت‌ها و مقدارهای پذیرفته‌شده در این توافق ثابت می‌ماند.",
	},
	ps: {
		reconcile: "غوښتنه وڅېړئ او سمون ورکړئ",
		guestCartChanged:
			"ستاسو د مېلمه سبد په بل ټب کې بدل شوی یا پای ته رسېدلی دی. پخوانۍ غوښتنه ښايي ثبت شوې یا له حساب سره یوځای شوې وي. بیا نه زیاتېږي.",
		useCurrentCart: "اوسنی مېلمه سبد وکاروئ",
		guestCartReady:
			"اوسنی مېلمه سبد وټاکل شو. هېڅ شی نه دی زیات شوی. مقدار وګورئ او د نوي زیاتولو لپاره سبد ته زیاتول وټاکئ.",
		guestUnavailable:
			"د مېلمه ټوکرۍ خوندي د څو ټبونو ملاتړ غواړي. د پېرودونکي حساب ته ننوځئ یا ملاتړ شوی براوزر وکاروئ.",
		quantityInvalid: "له ښودل شوي ګام سره سم مثبت مقدار ولیکئ.",
		termsLoading: "د دې پلورونکي شرطونه لوستل کېږي…",
		termsUnavailable:
			"دا پلورونکی نشته. له نورو سره د دوام لپاره یې توکي له انتخابه وباسئ.",
		termsDependency:
			"د دې پلورونکي شرطونه ونه لوستل شول. بیا هڅه وکړئ یا یې توکي له انتخابه وباسئ.",
		termsUnconfigured:
			"دې پلورونکي د پېرود شرطونه نه دي ټاکلي. د دوام لپاره یې توکي له انتخابه وباسئ.",
		cart: "د پېر سبد",
		add: "سبد ته زیاتول",
		quantity: "مقدار",
		tier: "د بیې ډول",
		retail: "پرچون",
		wholesale: "عمده",
		update: "تازه کول",
		remove: "لرې کول",
		empty: "ستاسو سبد تش دی.",
		checkout: "د پېر بشپړول",
		orders: "سپارښتنې",
		invoices: "بلونه",
		terms: "د پېر تنظیمات",
		merge: "د مېلمه انتخابونه یوځای کول",
		merged: "انتخابونه یوځای شول.",
		signIn: "د پېرودونکي حساب ته ننوتل",
		loading: "بارېږي…",
		error: "غوښتنه بشپړه نه شوه. تازه معلومات واخلئ یا هماغه غوښتنه بیا وکړئ.",
		retry: "هماغه غوښتنه بیا هڅول",
		pending: "په تمه — پایله روښانه نه ده",
		currentPrice: "پېر د سرور په اوسنۍ بیه کېږي؛ ښودل شوی اټکل بدلېدای شي.",
		delivery:
			"د لېږد مبلغ لا نه دی ټاکل شوی؛ جلا تنظیم او ورکول کېږي او په ټول مبلغ کې نشته.",
		unreserved:
			"یوازې د فرمایش منل موجودي نه زېرمه کوي. د توکو رسیدونه په تادیاتو او واقعي لېږد په سپارنو کې اداره کړئ.",
		submit: "د ثابتې بیې سپارښتنې ثبتول",
		advance: "مخکې تادیه",
		cod: "د سپارلو پر مهال تادیه",
		country: "هېواد (ISO کوډ)",
		city: "ښار",
		method: "د تادیې طریقه",
		enabled: "پېر فعالول",
		allCities: "ټول ښارونه",
		cities: "مجاز ښارونه (هره کرښه یو ښار)",
		reason: "دلیل",
		save: "ساتل",
		reload: "تازه معلومات اخیستل",
		goods: "د توکو مبلغ",
		total: "د توکو ټول مبلغ",
		due: "د مخکې تادیې مهلت (کابل وخت)",
		issued: "صادر شوی",
		accepted: "منل شوی",
		unpaid: "ناورکړل شوی",
		notDispatched: "نه دی لېږل شوی",
		unavailable: "انتخاب نشته",
		minimum: "د عمده لږ تر لږه",
		increment: "د مقدار ګام",
		source: "د سرچینې ژبه",
		priceChanged: "د منلو پر مهال بیه بدله شوه",
		shownEstimate: "مخکې ښودل شوې اټکلي بیه",
		acceptedUnitPrice: "منل شوې د واحد بیه",
		previous: "مخکینی",
		next: "راتلونکی",
		print: "د چاپ بل",
		pdf: "د PDF ښکته کول",
		business: "سوداګري",
		choose: "انتخاب",
		currency: "پیسې",
		fixed: "ثابته بیه",
		negotiable: "توافقي — د وروسته خبرو لپاره ساتل شوی",
		saved: "په سبد کې وساتل شو",
		review: "اوسنی اټکل کتل",
		resume: "په تمه پلورونکي بیا هڅول",
		destination: "موخه",
		history: "د غوښتنو مخینه",
		documentError: "د سند جوړول لنډمهاله نشته. منل شوې سپارښتنه ساتل شوې ده.",
		termsHelp:
			"یوازې د تایید شوې سوداګرۍ مالک مجازې موخې او طریقې تنظیمولای شي. پېر په پیل کې غیر فعال دی.",
		retryHelp:
			"تر روښانه پایلې هماغه غوښتنه وساتئ؛ بیا هڅه منل شوې سپارښتنې نه تکراروي.",
		wholesaleHelp:
			"عمده پېر تایید شوی سوداګریز پېرودونکی او لږ تر لږه مقدار غواړي. د اړتیا په صورت پرچون خپله وټاکئ.",
		estimate: "د توکو اټکلي ټول مبلغ",
		stock_unconfigured:
			"موجودي لا نه ده تنظیم شوې. انتخابونه په سبد کې ساتل شوي دي.",
		stock_shortage:
			"د توکو غوښتل شوی مقدار نشته. انتخابونه په سبد کې ساتل شوي دي.",
		destination_unavailable:
			"ټاکل شوې موخه نور مجازه نه ده. ساتل شوي انتخابونه وګورئ.",
		method_unavailable:
			"ټاکل شوې د تادیې طریقه نشته. ساتل شوي انتخابونه وګورئ.",
		cart_changed:
			"ستاسو سبد بدل شو. تر نوې غوښتنې مخکې ساتل شوي مقدارونه وګورئ.",
		tier_unavailable: "د بیې ټاکل شوی ډول نشته. بل ډول خپله وټاکئ.",
		seller_unavailable:
			"پلورونکی یا محصول اوس نشته. انتخابونه په سبد کې ساتل شوي دي.",
		frozen: "په دې هوکړه کې منل شوې بیې او مقدارونه ثابت پاتې کېږي.",
	},
	ar: {
		reconcile: "تحقق من الطلب ثم عدّل",
		guestCartChanged:
			"تغيرت سلة الضيف في علامة تبويب أخرى أو انتهت صلاحيتها. ربما سُجل الطلب السابق أو دُمج بالفعل. لن يُضاف مرة أخرى.",
		useCurrentCart: "استخدم سلة الضيف الحالية",
		guestCartReady:
			"تم اختيار سلة الضيف الحالية ولم يُضف شيء. راجع الكمية ثم اختر أضف إلى السلة لإضافة جديدة.",
		guestUnavailable:
			"تحتاج سلة الضيف إلى دعم آمن لتنسيق علامات التبويب. سجّل الدخول كمشترٍ أو استخدم متصفحاً مدعوماً.",
		quantityInvalid: "أدخل كمية موجبة تطابق الزيادة المعروضة.",
		termsLoading: "جار تحميل شروط هذا البائع…",
		termsUnavailable:
			"هذا البائع غير متاح. أزل تحديد منتجاته للمتابعة مع البائعين الآخرين.",
		termsDependency:
			"تعذر تحميل شروط هذا البائع. أعد المحاولة أو أزل تحديد منتجاته.",
		termsUnconfigured:
			"لم يحدد هذا البائع شروط الشراء. أزل تحديد منتجاته للمتابعة.",
		cart: "السلة",
		add: "أضف إلى السلة",
		quantity: "الكمية",
		tier: "نوع السعر",
		retail: "تجزئة",
		wholesale: "جملة",
		update: "تحديث",
		remove: "إزالة",
		empty: "سلتك فارغة.",
		checkout: "إتمام الشراء",
		orders: "الطلبات",
		invoices: "الفواتير",
		terms: "إعدادات الشراء",
		merge: "دمج اختيارات الزائر",
		merged: "تم دمج الاختيارات.",
		signIn: "الدخول كمشترٍ",
		loading: "جار التحميل…",
		error: "تعذر إكمال الطلب. أعد تحميل البيانات أو حاول الطلب نفسه.",
		retry: "إعادة محاولة الطلب نفسه",
		pending: "معلق — النتيجة غير محسومة",
		currentPrice:
			"يستخدم الشراء أسعار الخادم الحالية؛ قد يتغير التقدير المعروض.",
		delivery:
			"مبلغ التوصيل قيد التحديد ويُرتب ويُدفع منفصلاً؛ غير مشمول بإجمالي البضائع.",
		unreserved:
			"قبول الطلب وحده لا يحجز المخزون. تدار إيصالات البضائع في المدفوعات والتسليم الفعلي في قسم التسليم والشحن.",
		submit: "تسجيل طلبات السعر الثابت",
		advance: "دفع مقدم",
		cod: "الدفع عند الاستلام",
		country: "الدولة (رمز ISO)",
		city: "المدينة",
		method: "طريقة الدفع",
		enabled: "تمكين الشراء",
		allCities: "جميع المدن",
		cities: "المدن المسموحة (مدينة في كل سطر)",
		reason: "السبب",
		save: "حفظ",
		reload: "تحميل البيانات الحالية",
		goods: "مبلغ البضائع",
		total: "إجمالي البضائع",
		due: "مهلة الدفع المقدم (وقت كابل)",
		issued: "الإصدار",
		accepted: "مقبول",
		unpaid: "غير مدفوع",
		notDispatched: "غير مرسل",
		unavailable: "اختيار غير متاح",
		minimum: "الحد الأدنى للجملة",
		increment: "خطوة الكمية",
		source: "لغة المصدر",
		priceChanged: "تغير السعر عند القبول",
		shownEstimate: "التقدير المعروض سابقاً",
		acceptedUnitPrice: "سعر الوحدة المقبول",
		previous: "السابق",
		next: "التالي",
		print: "فاتورة قابلة للطباعة",
		pdf: "تنزيل PDF",
		business: "المنشأة",
		choose: "اختر",
		currency: "العملة",
		fixed: "سعر ثابت",
		negotiable: "تفاوضي — محفوظ للتفاوض لاحقاً",
		saved: "أضيف إلى السلة",
		review: "عرض التقدير الحالي",
		resume: "استئناف البائعين المعلقين",
		destination: "الوجهة",
		history: "سجل الطلبات",
		documentError: "إنشاء المستند غير متاح مؤقتاً. الطلب المقبول محفوظ.",
		termsHelp:
			"فقط مالك المنشأة المعتمدة يمكنه إعداد الوجهات والطرق المسموحة. الشراء معطل افتراضياً.",
		retryHelp:
			"احتفظ بالطلب نفسه حتى حسم النتيجة؛ إعادة المحاولة لا تكرر طلبات البائعين المقبولة.",
		wholesaleHelp:
			"الجملة تتطلب ملف مشترٍ تجارياً معتمداً والحد الأدنى للكمية. اختر التجزئة صراحة عند الحاجة.",
		estimate: "إجمالي البضائع التقديري",
		stock_unconfigured: "لم يُضبط توفر المخزون بعد. اختياراتك محفوظة في السلة.",
		stock_shortage:
			"كمية البضائع المطلوبة غير متاحة. اختياراتك محفوظة في السلة.",
		destination_unavailable:
			"الوجهة المختارة لم تعد مسموحة. راجع الاختيارات المحفوظة.",
		method_unavailable:
			"طريقة الدفع المختارة غير متاحة. راجع الاختيارات المحفوظة.",
		cart_changed: "تغيرت سلتك. راجع الكميات المحفوظة قبل إرسال طلب جديد.",
		tier_unavailable: "نوع السعر المختار غير متاح. اختر نوعاً آخر صراحة.",
		seller_unavailable:
			"البائع أو المنتج غير متاح حالياً. اختياراتك محفوظة في السلة.",
		frozen: "تبقى الأسعار والكميات المقبولة ثابتة في هذا الاتفاق.",
	},
};
