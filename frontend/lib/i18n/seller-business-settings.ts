import type { Locale } from "./locales";

const en = {
	businessStatus: "Business & review status",
	publicInformation: "Public information",
	manualLanguages:
		"Write each included language yourself. Missing editions use the source language; nothing is translated automatically.",
	sourceFallback:
		"Shown in the source language because this edition is not included.",
	sourceHelp:
		"The source edition is required. Other language editions are optional.",
	missingEdition:
		"This language is not included. Enable it to enter a manual edition.",
	images: "Store images",
	imageHelp:
		"JPEG, PNG or WebP only, up to 8 MiB. Images are inspected by the server; review is still required.",
	noImage: "No image selected for this draft.",
	draftPreview: "Current private preview",
	draftPreviewHelp:
		"This shows your current input, including unsaved changes. It is not a public version.",
	approvedPreviewHelp:
		"This is the retained approved revision. Current business eligibility still governs public availability.",
	reviewActions: "Save & review",
	reviewHelp:
		"Save creates a new private draft. Only the latest saved draft can be submitted for independent review.",
	pendingHelp:
		"This revision is submitted. Its fields and images are read-only; withdrawal retains its history.",
	noRevision: "No saved optional-content revision yet.",
	draftSaved:
		"A new private draft was saved. It has not been submitted or published.",
	reviewSubmitted:
		"The saved draft was submitted for review. It is not approval or publication.",
	reviewWithdrawn:
		"The submission was withdrawn. Its revision and review history are retained.",
	saveFailed: "The draft could not be saved. Your input is retained.",
	submitFailed: "The draft could not be submitted. Your input is retained.",
	withdrawFailed:
		"The submission could not be withdrawn. Reload deliberately to check its current state.",
	uploadFailed:
		"The image could not be attached. Your other input is retained.",
	imageAttached:
		"The inspected image is attached to your input. Save the draft to include it in a revision.",
	fieldError: "Check this field before trying again.",
	checkFields: "Check the highlighted fields.",
	selectedRequired: "Select a business to view its settings.",
	profilesFailed: "Business access could not be loaded. Reload to try again.",
	checkoutDenied:
		"You cannot manage checkout settings for this business with your current access.",
	noCheckoutBusiness:
		"No currently eligible business permits checkout settings. Approved ownership is required.",
	checkoutState: "Order acceptance",
	enabledHelp:
		"Enabling checkout does not add destinations or payment methods. Only your explicit saved choices apply.",
	coverage: "Accepted destinations",
	coverageHelp:
		"List up to 20 countries. Coverage is explicit, not worldwide; it does not set delivery fees or promise delivery.",
	countryHelp:
		"Use a two-letter ISO country code, for example AF. Letters are normalized to uppercase.",
	citiesHelp:
		"Enter one city per line, up to 20 cities per country, at most 100 characters each. All cities applies only to this country.",
	noDestinations: "No destinations selected. No worldwide coverage is implied.",
	addDestination: "Add country",
	methodsHelp:
		"Select advance payment, cash on delivery, both or neither. No method is enabled by default; this does not activate a payment gateway.",
	noMethods: "No payment method selected.",
	changeReason: "Audited change reason",
	reasonHelp:
		"Explain this change (3–1,000 characters). The server records it with the exact settings version.",
	checkoutSaved: "Checkout settings were saved for this business and version.",
	checkoutFailed:
		"Checkout settings could not be saved. Your input and reason are retained.",
	checkoutStale:
		"The settings version changed. Your input and reason are retained. Reload only when ready to replace them.",
	version: "Version",
};
type Copy = { [K in keyof typeof en]: string };
export const sellerBusinessSettingsCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		businessStatus: "کسب‌وکار و وضعیت بررسی",
		publicInformation: "اطلاعات عمومی",
		manualLanguages:
			"هر زبان شامل‌شده را خودتان بنویسید. اگر نسخهٔ زبانی موجود نباشد، زبان منبع نمایش داده می‌شود؛ ترجمهٔ خودکار انجام نمی‌شود.",
		sourceFallback:
			"چون نسخهٔ این زبان شامل نیست، متن به زبان منبع نمایش داده می‌شود.",
		sourceHelp: "نسخهٔ زبان منبع الزامی است. نسخه‌های زبان‌های دیگر اختیاری است.",
		missingEdition: "این زبان شامل نیست. برای نوشتن نسخهٔ دستی آن را فعال کنید.",
		images: "تصاویر فروشگاه",
		imageHelp:
			"فقط JPEG، PNG یا WebP تا ۸ MiB. سرور تصاویر را بررسی می‌کند؛ بررسی محتوا همچنان لازم است.",
		noImage: "برای این پیش‌نویس تصویری انتخاب نشده است.",
		draftPreview: "پیش‌نمایش خصوصی فعلی",
		draftPreviewHelp:
			"این پیش‌نمایش ورودی فعلی، از جمله تغییرات ذخیره‌نشده را نشان می‌دهد. نسخهٔ عمومی نیست.",
		approvedPreviewHelp:
			"این نسخهٔ تأییدشدهٔ نگهداری‌شده است. نمایش عمومی همچنان به واجد شرایط بودن فعلی کسب‌وکار وابسته است.",
		reviewActions: "ذخیره و بررسی",
		reviewHelp:
			"ذخیره، پیش‌نویس خصوصی جدید می‌سازد. فقط آخرین پیش‌نویس ذخیره‌شده برای بررسی مستقل قابل ارسال است.",
		pendingHelp:
			"این نسخه ارسال شده است. فیلدها و تصاویر فقط خواندنی است؛ پس‌گرفتن، تاریخچه را حفظ می‌کند.",
		noRevision: "هنوز نسخهٔ ذخیره‌شده‌ای از محتوای اختیاری ندارید.",
		draftSaved: "پیش‌نویس خصوصی جدید ذخیره شد. ارسال یا نشر نشده است.",
		reviewSubmitted:
			"پیش‌نویس ذخیره‌شده برای بررسی ارسال شد. این به معنی تأیید یا نشر نیست.",
		reviewWithdrawn: "ارسال پس گرفته شد. نسخه و تاریخچهٔ بررسی حفظ شده است.",
		saveFailed: "پیش‌نویس ذخیره نشد. ورودی شما حفظ شده است.",
		submitFailed: "پیش‌نویس ارسال نشد. ورودی شما حفظ شده است.",
		withdrawFailed:
			"ارسال پس گرفته نشد. برای بررسی وضعیت فعلی، با انتخاب خود دوباره بارگیری کنید.",
		uploadFailed: "تصویر ضمیمه نشد. ورودی‌های دیگر حفظ شده است.",
		imageAttached:
			"تصویر بررسی‌شده به ورودی ضمیمه شد. برای شامل‌کردن در نسخه، پیش‌نویس را ذخیره کنید.",
		fieldError: "پیش از تلاش دوباره این فیلد را بررسی کنید.",
		checkFields: "فیلدهای مشخص‌شده را بررسی کنید.",
		selectedRequired: "برای دیدن تنظیمات، کسب‌وکار را انتخاب کنید.",
		profilesFailed:
			"دسترسی کسب‌وکار بارگیری نشد. برای تلاش دوباره، بارگیری کنید.",
		checkoutDenied:
			"با دسترسی فعلی نمی‌توانید تنظیمات سفارش این کسب‌وکار را مدیریت کنید.",
		noCheckoutBusiness:
			"هیچ کسب‌وکار واجد شرایط فعلی اجازهٔ تنظیم سفارش نمی‌دهد. مالکیت تأییدشده لازم است.",
		checkoutState: "پذیرش سفارش",
		enabledHelp:
			"فعال‌کردن سفارش، مقصد یا روش پرداخت اضافه نمی‌کند. فقط انتخاب‌های صریح ذخیره‌شدهٔ شما اعمال می‌شود.",
		coverage: "مقصدهای پذیرش سفارش",
		coverageHelp:
			"تا ۲۰ کشور را مشخص کنید. محدوده صریح است، نه جهانی؛ هزینه یا وعدهٔ تحویل تعیین نمی‌کند.",
		countryHelp:
			"کد دوحرفی ISO کشور، مانند AF، را وارد کنید. حروف به بزرگ تبدیل می‌شود.",
		citiesHelp:
			"هر شهر را در یک خط بنویسید؛ تا ۲۰ شهر در هر کشور و حداکثر ۱۰۰ نویسه برای هر شهر. همهٔ شهرها فقط به همین کشور مربوط است.",
		noDestinations: "مقصدی انتخاب نشده است. پوشش جهانی در نظر گرفته نمی‌شود.",
		addDestination: "افزودن کشور",
		methodsHelp:
			"پیش‌پرداخت، پرداخت هنگام تحویل، هر دو یا هیچ‌کدام را انتخاب کنید. هیچ روش پیش‌فرض فعال نیست؛ درگاه پرداخت فعال نمی‌شود.",
		noMethods: "روش پرداختی انتخاب نشده است.",
		changeReason: "دلیل ثبت‌شوندهٔ تغییر",
		reasonHelp:
			"تغییر را توضیح دهید (۳ تا ۱٬۰۰۰ نویسه). سرور آن را با نسخهٔ دقیق تنظیمات ثبت می‌کند.",
		checkoutSaved: "تنظیمات سفارش برای این کسب‌وکار و نسخه ذخیره شد.",
		checkoutFailed: "تنظیمات سفارش ذخیره نشد. ورودی و دلیل شما حفظ شده است.",
		checkoutStale:
			"نسخهٔ تنظیمات تغییر کرده است. ورودی و دلیل شما حفظ شده است. فقط زمانی بارگیری کنید که آمادهٔ جایگزینی آن‌ها هستید.",
		version: "نسخه",
	},
	ps: {
		businessStatus: "سوداګري او د کتنې حالت",
		publicInformation: "عامه معلومات",
		manualLanguages:
			"هره شامله ژبه پخپله ولیکئ. نشتې نسخې د سرچینې ژبه کاروي؛ اتومات ژباړه نه کېږي.",
		sourceFallback: "دا نسخه شامله نه ده، نو متن د سرچینې په ژبه ښودل کېږي.",
		sourceHelp: "د سرچینې ژبې نسخه اړینه ده. د نورو ژبو نسخې اختیاري دي.",
		missingEdition: "دا ژبه شامله نه ده. د لاسي نسخې لیکلو لپاره یې فعاله کړئ.",
		images: "د پلورنځي انځورونه",
		imageHelp:
			"یوازې JPEG، PNG یا WebP تر ۸ MiB پورې. سرور انځورونه ګوري؛ د منځپانګې کتنه لا هم اړینه ده.",
		noImage: "د دې مسودې لپاره انځور نه دی ټاکل شوی.",
		draftPreview: "اوسنی شخصي مخکتنه",
		draftPreviewHelp:
			"دا اوسني معلومات او ناخوندي بدلونونه ښيي. عامه نسخه نه ده.",
		approvedPreviewHelp:
			"دا ساتل شوې تایید شوې نسخه ده. عامه شتون لا هم د سوداګرۍ په اوسني وړتیا پورې تړلی دی.",
		reviewActions: "خوندي کول او کتنه",
		reviewHelp:
			"خوندي کول نوې شخصي مسوده جوړوي. یوازې وروستۍ خوندي شوې مسوده خپلواکې کتنې ته لېږل کېدای شي.",
		pendingHelp:
			"دا نسخه لېږل شوې ده. برخې او انځورونه یوازې لوستل کېږي؛ بېرته اخیستل تاریخچه ساتي.",
		noRevision: "تر اوسه د اختیاري منځپانګې خوندي شوې نسخه نشته.",
		draftSaved: "نوې شخصي مسوده خوندي شوه. نه ده لېږل شوې یا خپره شوې.",
		reviewSubmitted:
			"خوندي شوې مسوده کتنې ته ولېږل شوه. دا تایید یا خپرول نه دي.",
		reviewWithdrawn:
			"لېږنه بېرته واخیستل شوه. نسخه او د کتنې تاریخچه ساتل شوې ده.",
		saveFailed: "مسوده خوندي نه شوه. ستاسو معلومات ساتل شوي دي.",
		submitFailed: "مسوده ونه لېږل شوه. ستاسو معلومات ساتل شوي دي.",
		withdrawFailed:
			"لېږنه بېرته ونه اخیستل شوه. د اوسني حالت لپاره په خپله خوښه بیا پورته کړئ.",
		uploadFailed: "انځور ضمیمه نه شو. نور معلومات ساتل شوي دي.",
		imageAttached:
			"کتل شوی انځور ضمیمه شو. په نسخه کې د شاملولو لپاره مسوده خوندي کړئ.",
		fieldError: "له بیا هڅې مخکې دا برخه وګورئ.",
		checkFields: "نښه شوې برخې وګورئ.",
		selectedRequired: "د تنظیماتو لیدلو لپاره سوداګري وټاکئ.",
		profilesFailed: "د سوداګرۍ لاسرسی پورته نه شو. بیا یې پورته کړئ.",
		checkoutDenied:
			"په اوسني لاسرسي د دې سوداګرۍ د سپارښتنو تنظیمات نشئ اداره کولای.",
		noCheckoutBusiness:
			"هیڅ اوسنۍ وړ سوداګري د سپارښتنو تنظیماتو اجازه نه ورکوي. تایید شوی مالکیت اړین دی.",
		checkoutState: "د سپارښتنو منل",
		enabledHelp:
			"فعالول ځایونه یا د تادیې لارې نه زیاتوي. یوازې ستاسو څرګند خوندي شوي انتخابونه کارول کېږي.",
		coverage: "د سپارښتنو ځایونه",
		coverageHelp:
			"تر ۲۰ هېوادونو پورې وټاکئ. سیمه څرګنده ده، نړیواله نه ده؛ د تحویلۍ بیه یا ژمنه نه ټاکي.",
		countryHelp:
			"د هېواد دوه توري ISO کوډ، لکه AF، ولیکئ. توري لویو تورو ته بدلېږي.",
		citiesHelp:
			"هر ښار په جلا کرښه ولیکئ؛ په هر هېواد کې تر ۲۰ ښارونو او د هر ښار لپاره تر ۱۰۰ تورو پورې. ټول ښارونه یوازې د همدې هېواد دي.",
		noDestinations: "ځایونه نه دي ټاکل شوي. نړیواله سیمه نه فرض کېږي.",
		addDestination: "هېواد زیاتول",
		methodsHelp:
			"مخکینۍ تادیه، د تحویلۍ پر مهال تادیه، دواړه یا هیڅ یوه وټاکئ. هېڅ لاره په اصل کې فعاله نه ده؛ د تادیې دروازه نه فعالېږي.",
		noMethods: "د تادیې لاره نه ده ټاکل شوې.",
		changeReason: "د ثبتېدونکي بدلون دلیل",
		reasonHelp:
			"بدلون تشریح کړئ (۳ تر ۱٬۰۰۰ تورو). سرور یې د تنظیماتو له دقیقې نسخې سره ثبتوي.",
		checkoutSaved: "د دې سوداګرۍ او نسخې د سپارښتنو تنظیمات خوندي شول.",
		checkoutFailed:
			"د سپارښتنو تنظیمات خوندي نه شول. معلومات او دلیل ساتل شوي دي.",
		checkoutStale:
			"د تنظیماتو نسخه بدله شوې ده. معلومات او دلیل ساتل شوي دي. یوازې د بدلولو لپاره د چمتووالي پر مهال بیا پورته کړئ.",
		version: "نسخه",
	},
	ar: {
		businessStatus: "النشاط التجاري وحالة المراجعة",
		publicInformation: "المعلومات العامة",
		manualLanguages:
			"اكتب كل لغة مُدرجة بنفسك. تستخدم النسخ المفقودة لغة المصدر؛ لا توجد ترجمة تلقائية.",
		sourceFallback: "يُعرض النص بلغة المصدر لأن نسخة هذه اللغة غير مُدرجة.",
		sourceHelp: "نسخة لغة المصدر مطلوبة. نسخ اللغات الأخرى اختيارية.",
		missingEdition: "هذه اللغة غير مُدرجة. فعّلها لكتابة نسخة يدوية.",
		images: "صور المتجر",
		imageHelp:
			"JPEG أو PNG أو WebP فقط، حتى 8 MiB. يفحص الخادم الصور؛ تبقى مراجعة المحتوى مطلوبة.",
		noImage: "لم تُحدد صورة لهذه المسودة.",
		draftPreview: "المعاينة الخاصة الحالية",
		draftPreviewHelp:
			"تعرض هذه المعاينة المدخلات الحالية، بما فيها التغييرات غير المحفوظة. ليست نسخة عامة.",
		approvedPreviewHelp:
			"هذه النسخة المعتمدة المحتفظ بها. يظل الظهور العام خاضعاً لأهلية النشاط التجاري الحالية.",
		reviewActions: "الحفظ والمراجعة",
		reviewHelp:
			"ينشئ الحفظ مسودة خاصة جديدة. يمكن إرسال أحدث مسودة محفوظة فقط للمراجعة المستقلة.",
		pendingHelp:
			"تم إرسال هذه النسخة. الحقول والصور للقراءة فقط؛ يحتفظ السحب بالسجل.",
		noRevision: "لا توجد نسخة محفوظة للمحتوى الاختياري بعد.",
		draftSaved: "حُفظت مسودة خاصة جديدة. لم تُرسل ولم تُنشر.",
		reviewSubmitted:
			"أُرسلت المسودة المحفوظة للمراجعة. هذا ليس اعتماداً أو نشراً.",
		reviewWithdrawn: "سُحب الإرسال. تم الاحتفاظ بالنسخة وسجل المراجعة.",
		saveFailed: "تعذر حفظ المسودة. تم الاحتفاظ بمدخلاتك.",
		submitFailed: "تعذر إرسال المسودة. تم الاحتفاظ بمدخلاتك.",
		withdrawFailed:
			"تعذر سحب الإرسال. أعد التحميل باختيارك للتحقق من الحالة الحالية.",
		uploadFailed: "تعذر إرفاق الصورة. تم الاحتفاظ بالمدخلات الأخرى.",
		imageAttached:
			"أُرفقت الصورة المفحوصة بمدخلاتك. احفظ المسودة لإدراجها في نسخة.",
		fieldError: "تحقق من هذا الحقل قبل المحاولة مجدداً.",
		checkFields: "تحقق من الحقول المحددة.",
		selectedRequired: "حدد نشاطاً تجارياً لعرض إعداداته.",
		profilesFailed:
			"تعذر تحميل صلاحيات النشاط التجاري. أعد التحميل للمحاولة مجدداً.",
		checkoutDenied:
			"لا يمكنك إدارة إعدادات الطلبات لهذا النشاط التجاري بصلاحياتك الحالية.",
		noCheckoutBusiness:
			"لا يوجد نشاط مؤهل حالياً يسمح بإدارة إعدادات الطلبات. الملكية المعتمدة مطلوبة.",
		checkoutState: "قبول الطلبات",
		enabledHelp:
			"لا يضيف التفعيل وجهات أو طرق دفع. تُطبق اختياراتك الصريحة المحفوظة فقط.",
		coverage: "الوجهات المقبولة",
		coverageHelp:
			"حدد حتى 20 دولة. النطاق صريح وليس عالمياً؛ لا يحدد رسوم التوصيل أو يَعِد بالتوصيل.",
		countryHelp:
			"استخدم رمز ISO للدولة من حرفين مثل AF. تُحول الأحرف إلى أحرف كبيرة.",
		citiesHelp:
			"أدخل مدينة واحدة في كل سطر، حتى 20 مدينة لكل دولة و100 محرف لكل مدينة. جميع المدن تخص هذه الدولة فقط.",
		noDestinations: "لم تُحدد وجهات. لا يُفترض نطاق عالمي.",
		addDestination: "إضافة دولة",
		methodsHelp:
			"حدد الدفع المسبق أو الدفع عند التسليم أو كليهما أو لا شيء. لا تُفعّل أي طريقة افتراضياً؛ لا تُفعّل بوابة دفع.",
		noMethods: "لم تُحدد طريقة دفع.",
		changeReason: "سبب التغيير المسجل",
		reasonHelp:
			"اشرح التغيير (3–1,000 محرف). يسجله الخادم مع نسخة الإعدادات الدقيقة.",
		checkoutSaved: "حُفظت إعدادات الطلبات لهذا النشاط التجاري وهذه النسخة.",
		checkoutFailed: "تعذر حفظ إعدادات الطلبات. تم الاحتفاظ بالمدخلات والسبب.",
		checkoutStale:
			"تغيرت نسخة الإعدادات. تم الاحتفاظ بالمدخلات والسبب. أعد التحميل فقط عندما تكون مستعداً لاستبدالها.",
		version: "النسخة",
	},
};
