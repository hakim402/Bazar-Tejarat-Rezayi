import type { Locale } from "./locales";

const en = {
	title: "Products",
	listHelp:
		"Add products, improve their details and follow their review. Stock is managed in Inventory.",
	add: "Add product",
	setupTitle: "Start a new product",
	setupHelp:
		"Choose the business and selling terms first. Add the name, options and photos on the next screen.",
	continue: "Continue to product details",
	setupRule:
		"Currency and pricing type cannot change after this step. This does not publish the product.",
	untitled: "Untitled draft",
	notSaved: "Not saved yet",
	productVersion: "Product version",
	noCategories:
		"No product categories are available yet. The marketplace team must configure them before you can complete this product.",
	latestStatus: "Latest saved details",
	publicStatus: "Public listing",
	live: "Published listing",
	notLive: "Not published",
	publicHelp:
		"Public access also depends on current business approval. New drafts do not replace the published version until approved.",
	viewPublic: "View public product",
	filterHelp:
		"Review filters include products with matching saved history. Published listings have an approved version. The list includes all products you can manage, not just the business selected in navigation.",
	page: "Page",
	onPage: "Products on this page",
	edit: "Open product",
	details: "Product details",
	options: "Selling options",
	photos: "Photos",
	prices: "Prices",
	review: "Review & history",
	detailsHelp:
		"Start with a clear name and category. Add the description and specifications buyers need.",
	optionsHelp:
		"One option is enough for a simple product. Add another for a different size, colour or pack.",
	photosHelp:
		"Upload a photo, then attach it to this draft. The first attached photo is the cover.",
	newPrices: "Prices for new options",
	existingPrices: "Current live prices",
	pricesHelp:
		"New option prices save with the draft. Existing option prices have a separate save and take effect immediately.",
	savePrices: "Save live prices",
	livePriceHelp:
		"These changes take effect immediately. Product review does not restore older prices.",
	reviewHelp:
		"Save a draft before sending it for review. Staff approve the exact saved version, not unsaved changes.",
	noRevision:
		"No draft saved yet. Complete the product details and save your first draft.",
	savedHint:
		"Each save creates a new draft. Send it for review only when it is ready.",
	previewHelp:
		"Preview only: stock is not shown here. Existing options show current live prices, even in saved revisions.",
	previewOnly: "Stock is not shown in this preview.",
	saveDraft: "Save draft",
	unsaved: "Unsaved changes",
	unchanged: "No unsaved changes",
	dirtyTitle: "Discard product changes?",
	dirtyHelp:
		"Your unsaved product details or prices will be lost. Saved drafts and uploaded photos remain.",
	stay: "Keep editing",
	discard: "Discard and continue",
	removePublic: "Remove from public listing",
	removeHelp:
		"This hides the approved product from new public views. Saved content and history remain. Enter a reason before confirming.",
	confirmRemove: "Confirm removal",
	cancel: "Cancel",
	acknowledged:
		"The operation was accepted, but updated details could not be loaded. Reload before another save; do not repeat the operation.",
	reloadRequired: "Reload saved data before making another change.",
	manageStock: "Manage stock",
	stockHelp:
		"Saved options link to Inventory. Stock settings, receipts and adjustments stay there.",
	languages: "Product languages",
	languageHelp:
		"Staff manage translations. Approval here refers only to this saved revision, not every version.",
	approved: "Approved translation",
	awaiting: "Translation awaiting approval",
	noTranslation: "No approved translation",
	historyLimit:
		"Showing up to 100 saved revisions and the published version. Price history includes up to 200 recent changes.",
	noHistory: "No price changes recorded.",
	chooseCategory: "Choose a category",
	readyPhotos: "Uploaded photos available to attach",
	attachPhoto: "Attach to draft",
	noStaged:
		"All uploaded photos are already attached, or no photos have been uploaded.",
	photoLimit:
		"Up to 12 photos in a draft. Removing a photo here does not delete its stored file.",
	sku: "Product code (SKU)",
	skuHelp: "Use your own unique code to identify this option.",
	quantityHelp:
		"The smallest step buyers can order, such as 1 piece or 0.5 kg.",
	minimumHelp:
		"The minimum quantity for a wholesale order; it must match the quantity step.",
	contentsHelp: "For packs or cartons, describe what each one contains.",
	immutableHelp:
		"Saved codes, units and quantity terms cannot change. Add another option for a different definition.",
	allOptions: "Whole product",
	choosePhoto: "Choose an uploaded photo",
	noPrice: "Price not entered",
	savedVersion: "Saved version",
	priceHistory: "Recent price changes",
	creationDenied:
		"No eligible business is available for adding products. Check your approval and catalogue permissions.",
	busy: "Working…",
};
type Copy = typeof en;
export const sellerProductsCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		title: "محصولات",
		listHelp:
			"محصول اضافه کنید، معلومات آن را بهتر سازید و بررسی آن را دنبال کنید. موجودی در بخش موجودی مدیریت می‌شود.",
		add: "افزودن محصول",
		setupTitle: "شروع محصول جدید",
		setupHelp:
			"ابتدا کسب‌وکار و شرایط فروش را انتخاب کنید. نام، گزینه‌ها و عکس‌ها را در صفحه بعد اضافه کنید.",
		continue: "ادامه به معلومات محصول",
		setupRule:
			"پس از این مرحله، پول و نوع قیمت‌گذاری تغییر نمی‌کند. این کار محصول را نشر نمی‌کند.",
		untitled: "پیش‌نویس بدون نام",
		notSaved: "هنوز ذخیره نشده",
		productVersion: "نسخه محصول",
		noCategories:
			"هنوز دسته‌بندی محصول موجود نیست. تیم بازار باید آن را تنظیم کند تا بتوانید این محصول را تکمیل کنید.",
		latestStatus: "آخرین معلومات ذخیره‌شده",
		publicStatus: "نمایش عمومی",
		live: "نسخه نشرشده",
		notLive: "نشر نشده",
		publicHelp:
			"دسترسی عمومی به تأیید فعلی کسب‌وکار نیز وابسته است. پیش‌نویس جدید تا تأیید شدن جای نسخه نشرشده را نمی‌گیرد.",
		viewPublic: "دیدن محصول عمومی",
		filterHelp:
			"فیلتر بررسی، محصولات دارای سابقه مطابق را نشان می‌دهد. محصولات نشرشده نسخه تأییدشده دارند. فهرست شامل همه محصولات قابل مدیریت شما است، نه فقط کسب‌وکار انتخاب‌شده در راهبری.",
		page: "صفحه",
		onPage: "محصولات این صفحه",
		edit: "باز کردن محصول",
		details: "معلومات محصول",
		options: "گزینه‌های فروش",
		photos: "عکس‌ها",
		prices: "قیمت‌ها",
		review: "بررسی و سابقه",
		detailsHelp:
			"با نام روشن و دسته‌بندی شروع کنید. توضیحات و مشخصات مورد نیاز خریدار را اضافه کنید.",
		optionsHelp:
			"برای محصول ساده یک گزینه کافی است. برای اندازه، رنگ یا بسته متفاوت گزینه دیگر اضافه کنید.",
		photosHelp:
			"عکس را بارگذاری کرده، سپس به این پیش‌نویس اضافه کنید. اولین عکس اضافه‌شده عکس اصلی است.",
		newPrices: "قیمت گزینه‌های جدید",
		existingPrices: "قیمت‌های فعلی فروش",
		pricesHelp:
			"قیمت گزینه جدید با پیش‌نویس ذخیره می‌شود. قیمت گزینه‌های موجود جداگانه ذخیره شده و فوراً اعمال می‌شود.",
		savePrices: "ذخیره قیمت‌های فروش",
		livePriceHelp:
			"این تغییرات فوراً اعمال می‌شود. بررسی محصول قیمت‌های قبلی را برنمی‌گرداند.",
		reviewHelp:
			"پیش از ارسال برای بررسی، پیش‌نویس را ذخیره کنید. کارمندان همان نسخه ذخیره‌شده را تأیید می‌کنند، نه تغییرات ذخیره‌نشده را.",
		noRevision:
			"هنوز پیش‌نویس ذخیره نشده است. معلومات محصول را تکمیل و اولین پیش‌نویس را ذخیره کنید.",
		savedHint:
			"هر ذخیره یک پیش‌نویس جدید می‌سازد. تنها وقتی آماده است آن را برای بررسی بفرستید.",
		previewHelp:
			"فقط پیش‌نمایش: موجودی اینجا نشان داده نمی‌شود. گزینه‌های موجود، حتی در نسخه ذخیره‌شده، قیمت فعلی فروش را نشان می‌دهد.",
		previewOnly: "موجودی در این پیش‌نمایش نشان داده نمی‌شود.",
		saveDraft: "ذخیره پیش‌نویس",
		unsaved: "تغییرات ذخیره‌نشده",
		unchanged: "تغییر ذخیره‌نشده ندارید",
		dirtyTitle: "تغییرات محصول کنار گذاشته شود؟",
		dirtyHelp:
			"معلومات یا قیمت‌های ذخیره‌نشده از بین می‌رود. پیش‌نویس‌های ذخیره‌شده و عکس‌های بارگذاری‌شده باقی می‌ماند.",
		stay: "ادامه ویرایش",
		discard: "کنار گذاشتن و ادامه",
		removePublic: "برداشتن از نمایش عمومی",
		removeHelp:
			"این کار محصول تأییدشده را از دیدهای عمومی جدید پنهان می‌کند. معلومات ذخیره‌شده و سابقه باقی می‌ماند. پیش از تأیید دلیل را بنویسید.",
		confirmRemove: "تأیید برداشتن",
		cancel: "لغو",
		acknowledged:
			"عملیات پذیرفته شد، اما معلومات تازه بارگیری نشد. پیش از ذخیره دیگر دوباره بارگیری کنید؛ عملیات را تکرار نکنید.",
		reloadRequired:
			"پیش از تغییر دیگر، معلومات ذخیره‌شده را دوباره بارگیری کنید.",
		manageStock: "مدیریت موجودی",
		stockHelp:
			"گزینه‌های ذخیره‌شده به موجودی وصل است. تنظیمات، دریافت و اصلاح موجودی در همان بخش انجام می‌شود.",
		languages: "زبان‌های محصول",
		languageHelp:
			"ترجمه را کارمندان مدیریت می‌کنند. تأیید اینجا فقط مربوط به این نسخه ذخیره‌شده است، نه همه نسخه‌ها.",
		approved: "ترجمه تأییدشده",
		awaiting: "ترجمه در انتظار تأیید",
		noTranslation: "ترجمه تأییدشده نیست",
		historyLimit:
			"تا ۱۰۰ نسخه ذخیره‌شده و نسخه نشرشده نشان داده می‌شود. سابقه قیمت شامل تا ۲۰۰ تغییر اخیر است.",
		noHistory: "تغییر قیمت ثبت نشده است.",
		chooseCategory: "انتخاب دسته‌بندی",
		readyPhotos: "عکس‌های بارگذاری‌شده برای افزودن",
		attachPhoto: "افزودن به پیش‌نویس",
		noStaged: "همه عکس‌ها اضافه شده است یا هنوز عکسی بارگذاری نشده است.",
		photoLimit:
			"تا ۱۲ عکس در پیش‌نویس. برداشتن عکس از اینجا فایل ذخیره‌شده را حذف نمی‌کند.",
		sku: "کد محصول (SKU)",
		skuHelp: "برای شناسایی این گزینه، کد یکتای خود را بنویسید.",
		quantityHelp: "کوچک‌ترین گام سفارش، مانند ۱ عدد یا ۰٫۵ کیلوگرام.",
		minimumHelp:
			"کمترین مقدار سفارش عمده؛ باید با گام مقدار مطابقت داشته باشد.",
		contentsHelp: "برای بسته یا کارتن، محتویات هر یک را توضیح دهید.",
		immutableHelp:
			"کد، واحد و شرایط مقدار ذخیره‌شده تغییر نمی‌کند. برای تعریف متفاوت گزینه دیگری اضافه کنید.",
		allOptions: "تمام محصول",
		choosePhoto: "انتخاب عکس بارگذاری‌شده",
		noPrice: "قیمت وارد نشده",
		savedVersion: "نسخه ذخیره‌شده",
		priceHistory: "تغییرات اخیر قیمت",
		creationDenied:
			"کسب‌وکار واجد شرایط برای افزودن محصول موجود نیست. تأیید و صلاحیت کاتالوگ خود را بررسی کنید.",
		busy: "در حال انجام…",
	},
	ps: {
		title: "محصولات",
		listHelp:
			"محصول زیات کړئ، معلومات یې ښه کړئ او ارزونه یې تعقیب کړئ. موجودي د موجودۍ په برخه کې اداره کېږي.",
		add: "محصول زیاتول",
		setupTitle: "نوی محصول پیل کړئ",
		setupHelp:
			"لومړی کاروبار او د پلور شرطونه وټاکئ. نوم، انتخابونه او عکسونه په بله پاڼه کې زیات کړئ.",
		continue: "د محصول معلوماتو ته دوام",
		setupRule:
			"له دې ګام وروسته اسعار او د بیې ډول نه بدلېږي. دا کار محصول نه خپروي.",
		untitled: "بې نومه مسوده",
		notSaved: "لا خوندي شوې نه ده",
		productVersion: "د محصول نسخه",
		noCategories:
			"لا د محصول کټګورۍ نشته. د بازار ټیم باید هغه تنظیم کړي، څو دا محصول بشپړ کړئ.",
		latestStatus: "وروستي خوندي معلومات",
		publicStatus: "عامه ښودنه",
		live: "خپره شوې نسخه",
		notLive: "نه دی خپور شوی",
		publicHelp:
			"عامه لاسرسی د کاروبار په اوسني تایید هم تړلی دی. نوې مسوده تر تایید مخکې خپره شوې نسخه نه بدلوي.",
		viewPublic: "عامه محصول کتل",
		filterHelp:
			"د ارزونې چاڼ هغه محصولات ښيي چې برابر خوندي تاریخ لري. خپاره محصولات تایید شوې نسخه لري. لړلیک ستاسو ټول د ادارې وړ محصولات ښيي، نه یوازې په لارښوونه کې ټاکل شوی کاروبار.",
		page: "پاڼه",
		onPage: "د دې پاڼې محصولات",
		edit: "محصول پرانیستل",
		details: "د محصول معلومات",
		options: "د پلور انتخابونه",
		photos: "عکسونه",
		prices: "بیې",
		review: "ارزونه او تاریخ",
		detailsHelp:
			"له روښانه نوم او کټګورۍ پیل کړئ. د پېرودونکي اړین تشریح او ځانګړنې زیاتې کړئ.",
		optionsHelp:
			"د ساده محصول لپاره یو انتخاب بس دی. د بلې اندازې، رنګ یا بسته لپاره بل انتخاب زیات کړئ.",
		photosHelp:
			"عکس پورته کړئ، بیا یې دې مسودې ته ورزیات کړئ. لومړی ورزیات شوی عکس اصلي عکس دی.",
		newPrices: "د نویو انتخابونو بیې",
		existingPrices: "اوسنۍ د پلور بیې",
		pricesHelp:
			"د نوي انتخاب بیه له مسودې سره خوندي کېږي. د اوسنیو انتخابونو بیې جلا خوندي کېږي او سمدستي پلي کېږي.",
		savePrices: "د پلور بیې خوندي کول",
		livePriceHelp:
			"دا بدلونونه سمدستي پلي کېږي. د محصول ارزونه پخوانۍ بیې نه راګرځوي.",
		reviewHelp:
			"له ارزونې ته لېږلو مخکې مسوده خوندي کړئ. کارکوونکي هماغه خوندي نسخه تاییدوي، نه ناخوندي بدلونونه.",
		noRevision:
			"مسوده لا نه ده خوندي شوې. معلومات بشپړ او لومړۍ مسوده خوندي کړئ.",
		savedHint:
			"هر خوندي کول نوې مسوده جوړوي. یوازې چې چمتو وي ارزونې ته یې ولېږئ.",
		previewHelp:
			"یوازې مخکتنه: موجودي دلته نه ښودل کېږي. اوسني انتخابونه، حتی په خوندي نسخو کې، د پلور اوسنۍ بیې ښيي.",
		previewOnly: "موجودي په دې مخکتنه کې نه ښودل کېږي.",
		saveDraft: "مسوده خوندي کول",
		unsaved: "ناخوندي بدلونونه",
		unchanged: "ناخوندي بدلونونه نشته",
		dirtyTitle: "د محصول بدلونونه پرېږدئ؟",
		dirtyHelp:
			"ناخوندي معلومات یا بیې له منځه ځي. خوندي مسودې او پورته شوي عکسونه پاتې کېږي.",
		stay: "سمون ته دوام",
		discard: "پرېښودل او دوام",
		removePublic: "له عامه ښودنې لرې کول",
		removeHelp:
			"دا تایید شوی محصول له نویو عامه کتنو پټوي. خوندي معلومات او تاریخ پاتې کېږي. تر تایید مخکې دلیل ولیکئ.",
		confirmRemove: "لرې کول تایید کړئ",
		cancel: "لغوه",
		acknowledged:
			"عملیات ومنل شول، خو نوي معلومات را نه وړل شول. تر بل خوندي کولو مخکې بیا پورته کړئ؛ عملیات مه تکراروئ.",
		reloadRequired: "تر بل بدلون مخکې خوندي معلومات بیا پورته کړئ.",
		manageStock: "موجودي اداره کول",
		stockHelp:
			"خوندي انتخابونه له موجودۍ سره تړلي دي. تنظیمات، رسیدونه او سمون هلته دي.",
		languages: "د محصول ژبې",
		languageHelp:
			"ژباړې کارکوونکي اداره کوي. دلته تایید یوازې دې خوندي نسخې ته دی، نه ټولو نسخو ته.",
		approved: "تایید شوې ژباړه",
		awaiting: "ژباړه د تایید په تمه",
		noTranslation: "تایید شوې ژباړه نشته",
		historyLimit:
			"تر ۱۰۰ خوندي نسخې او خپره شوې نسخه ښودل کېږي. د بیې تاریخ تر ۲۰۰ وروستي بدلونونه لري.",
		noHistory: "د بیې بدلون نه دی ثبت شوی.",
		chooseCategory: "کټګوري وټاکئ",
		readyPhotos: "د ورزیاتولو لپاره پورته شوي عکسونه",
		attachPhoto: "مسودې ته ورزیاتول",
		noStaged: "ټول عکسونه ورزیات شوي یا لا عکسونه نه دي پورته شوي.",
		photoLimit: "په مسوده کې تر ۱۲ عکسونه. دلته لرې کول خوندي فایل نه ړنګوي.",
		sku: "د محصول کوډ (SKU)",
		skuHelp: "د دې انتخاب پېژندلو لپاره خپل ځانګړی کوډ ولیکئ.",
		quantityHelp: "د فرمایش تر ټولو کوچنی ګام، لکه ۱ دانه یا ۰٫۵ کیلوګرام.",
		minimumHelp: "د عمده فرمایش لږ مقدار؛ باید د مقدار له ګام سره برابر وي.",
		contentsHelp: "د بسته یا کارتن د هر یوه منځپانګه تشریح کړئ.",
		immutableHelp:
			"خوندي کوډونه، واحدونه او د مقدار شرطونه نه بدلېږي. د بل تعریف لپاره بل انتخاب زیات کړئ.",
		allOptions: "ټول محصول",
		choosePhoto: "پورته شوی عکس وټاکئ",
		noPrice: "بیه نه ده لیکل شوې",
		savedVersion: "خوندي نسخه",
		priceHistory: "د بیې وروستي بدلونونه",
		creationDenied:
			"د محصول زیاتولو لپاره وړ کاروبار نشته. تایید او د کټالوګ اجازه وګورئ.",
		busy: "کار روان دی…",
	},
	ar: {
		title: "المنتجات",
		listHelp:
			"أضف منتجات وحسّن معلوماتها وتابع مراجعتها. تُدار الكميات في المخزون.",
		add: "إضافة منتج",
		setupTitle: "بدء منتج جديد",
		setupHelp:
			"اختر النشاط وشروط البيع أولاً. أضف الاسم والخيارات والصور في الشاشة التالية.",
		continue: "المتابعة إلى معلومات المنتج",
		setupRule:
			"لا يمكن تغيير العملة ونوع التسعير بعد هذه الخطوة. هذا لا ينشر المنتج.",
		untitled: "مسودة بلا اسم",
		notSaved: "لم تُحفظ بعد",
		productVersion: "إصدار المنتج",
		noCategories:
			"لا توجد تصنيفات منتجات بعد. يجب أن يجهزها فريق السوق قبل أن تتمكن من إكمال هذا المنتج.",
		latestStatus: "أحدث معلومات محفوظة",
		publicStatus: "العرض العام",
		live: "نسخة منشورة",
		notLive: "غير منشور",
		publicHelp:
			"يعتمد الوصول العام أيضاً على اعتماد النشاط الحالي. لا تستبدل المسودات الجديدة النسخة المنشورة حتى اعتمادها.",
		viewPublic: "عرض المنتج العام",
		filterHelp:
			"تضم مرشحات المراجعة المنتجات ذات السجل المحفوظ المطابق. للمنتجات المنشورة نسخة معتمدة. تضم القائمة جميع المنتجات التي يمكنك إدارتها، وليس النشاط المحدد في التنقل فقط.",
		page: "الصفحة",
		onPage: "منتجات هذه الصفحة",
		edit: "فتح المنتج",
		details: "معلومات المنتج",
		options: "خيارات البيع",
		photos: "الصور",
		prices: "الأسعار",
		review: "المراجعة والسجل",
		detailsHelp:
			"ابدأ باسم واضح وتصنيف. أضف الوصف والمواصفات التي يحتاجها المشتري.",
		optionsHelp:
			"خيار واحد يكفي لمنتج بسيط. أضف خياراً لحجم أو لون أو عبوة مختلفة.",
		photosHelp:
			"ارفع صورة ثم أرفقها بهذه المسودة. أول صورة مرفقة هي صورة الغلاف.",
		newPrices: "أسعار الخيارات الجديدة",
		existingPrices: "أسعار البيع الحالية",
		pricesHelp:
			"تُحفظ أسعار الخيارات الجديدة مع المسودة. أسعار الخيارات الحالية لها حفظ مستقل وتسري فوراً.",
		savePrices: "حفظ أسعار البيع",
		livePriceHelp:
			"تسري هذه التغييرات فوراً. لا تُعيد مراجعة المنتج الأسعار السابقة.",
		reviewHelp:
			"احفظ مسودة قبل إرسالها للمراجعة. يعتمد الموظفون النسخة المحفوظة المحددة، لا التغييرات غير المحفوظة.",
		noRevision: "لم تُحفظ مسودة بعد. أكمل المعلومات واحفظ مسودتك الأولى.",
		savedHint: "كل حفظ ينشئ مسودة جديدة. أرسلها للمراجعة عندما تصبح جاهزة فقط.",
		previewHelp:
			"معاينة فقط: لا يظهر المخزون هنا. تعرض الخيارات الحالية أسعار البيع الحالية حتى في النسخ المحفوظة.",
		previewOnly: "لا يظهر المخزون في هذه المعاينة.",
		saveDraft: "حفظ المسودة",
		unsaved: "تغييرات غير محفوظة",
		unchanged: "لا تغييرات غير محفوظة",
		dirtyTitle: "تجاهل تغييرات المنتج؟",
		dirtyHelp:
			"ستفقد المعلومات أو الأسعار غير المحفوظة. تبقى المسودات المحفوظة والصور المرفوعة.",
		stay: "متابعة التحرير",
		discard: "تجاهل ومتابعة",
		removePublic: "إزالة من العرض العام",
		removeHelp:
			"يخفي هذا المنتج المعتمد عن المشاهدات العامة الجديدة. تبقى المعلومات المحفوظة والسجل. أدخل سبباً قبل التأكيد.",
		confirmRemove: "تأكيد الإزالة",
		cancel: "إلغاء",
		acknowledged:
			"قُبلت العملية ولكن تعذّر تحميل المعلومات المحدثة. أعد التحميل قبل حفظ آخر؛ لا تكرر العملية.",
		reloadRequired: "أعد تحميل المعلومات المحفوظة قبل إجراء تغيير آخر.",
		manageStock: "إدارة المخزون",
		stockHelp:
			"ترتبط الخيارات المحفوظة بالمخزون. تبقى الإعدادات والاستلام والتعديلات هناك.",
		languages: "لغات المنتج",
		languageHelp:
			"يدير الموظفون الترجمات. الاعتماد هنا لهذه النسخة المحفوظة فقط، وليس لكل النسخ.",
		approved: "ترجمة معتمدة",
		awaiting: "ترجمة تنتظر الاعتماد",
		noTranslation: "لا ترجمة معتمدة",
		historyLimit:
			"عرض حتى 100 نسخة محفوظة والنسخة المنشورة. يشمل سجل الأسعار حتى 200 تغيير حديث.",
		noHistory: "لم تُسجّل تغييرات أسعار.",
		chooseCategory: "اختر تصنيفاً",
		readyPhotos: "صور مرفوعة متاحة للإرفاق",
		attachPhoto: "إرفاق بالمسودة",
		noStaged: "كل الصور مرفقة أو لم تُرفع صور بعد.",
		photoLimit:
			"حتى 12 صورة في المسودة. إزالة الصورة هنا لا تحذف ملفها المحفوظ.",
		sku: "رمز المنتج (SKU)",
		skuHelp: "استخدم رمزك الفريد لتحديد هذا الخيار.",
		quantityHelp: "أصغر خطوة يمكن طلبها، مثل قطعة واحدة أو 0.5 كغ.",
		minimumHelp: "الحد الأدنى لطلب الجملة؛ يجب أن يوافق خطوة الكمية.",
		contentsHelp: "للعبوات والكرتون، وضّح محتويات كل واحد.",
		immutableHelp:
			"لا يمكن تغيير الرموز والوحدات وشروط الكمية المحفوظة. أضف خياراً لتعريف مختلف.",
		allOptions: "المنتج كله",
		choosePhoto: "اختر صورة مرفوعة",
		noPrice: "السعر غير مُدخل",
		savedVersion: "نسخة محفوظة",
		priceHistory: "تغييرات الأسعار الأخيرة",
		creationDenied:
			"لا يوجد نشاط مؤهل لإضافة المنتجات. تحقق من الاعتماد وصلاحيات الكتالوج.",
		busy: "جارٍ العمل…",
	},
};

export const productFlowCopy: Record<
	Locale,
	{
		steps: string[];
		next: string;
		previous: string;
		submit: string;
		submitHelp: string;
		listHelp: string;
		filters: string;
		all: string;
		filterNote: string;
		history: string;
		step: string;
		advanced: string;
		submitted: string;
		savedToast: string;
		submittedToast: string;
		errorToast: string;
		delete: string;
		deleteTitle: string;
		deleteHelp: string;
		deleteSuccess: string;
	}
> = {
	en: {
		steps: ["Selling setup", "Product details", "Options & prices", "Photos"],
		next: "Next",
		previous: "Previous",
		submit: "Submit product",
		submitHelp:
			"Submit when everything is ready. Your product will be sent for approval before it appears in the marketplace.",
		listHelp: "Your products, all in one place.",
		filters: "Filter products",
		all: "All products",
		filterNote:
			"All businesses you can manage. Status filters also match saved history.",
		history: "Saved versions & listing settings",
		step: "Step",
		advanced: "Quantity & pack settings",
		submitted:
			"A version of this product is awaiting approval. You can save further changes as a new draft.",
		savedToast: "Product changes saved.",
		submittedToast: "Product sent for review.",
		errorToast:
			"We could not complete that action. Review the message and try again.",
		delete: "Delete product",
		deleteTitle: "Delete this product?",
		deleteHelp:
			"This permanently removes the product and its saved catalogue details. Products linked to protected business history cannot be deleted.",
		deleteSuccess: "Product deleted.",
	},
	"fa-AF": {
		steps: ["تنظیم فروش", "معلومات محصول", "گزینه‌ها و قیمت‌ها", "عکس‌ها"],
		next: "بعدی",
		previous: "قبلی",
		submit: "ارسال محصول",
		submitHelp:
			"پس از تکمیل معلومات، محصول را ارسال کنید. پیش از نمایش در بازار، محصول باید تأیید شود.",
		listHelp: "همه محصولات شما در یک‌جا.",
		filters: "فیلتر محصولات",
		all: "همه محصولات",
		filterNote:
			"همه کسب‌وکارهای قابل مدیریت شما. فیلتر وضعیت شامل سابقه ذخیره‌شده نیز است.",
		history: "نسخه‌های ذخیره‌شده و تنظیم نمایش",
		step: "مرحله",
		advanced: "تنظیم مقدار و بسته",
		submitted:
			"یک نسخه این محصول در انتظار تأیید است. تغییرات بعدی را می‌توانید به‌صورت پیش‌نویس جدید ذخیره کنید.",
		savedToast: "تغییرات محصول ذخیره شد.",
		submittedToast: "محصول برای بررسی فرستاده شد.",
		errorToast: "این کار انجام نشد. پیام را بررسی کنید و دوباره تلاش نمایید.",
		delete: "حذف محصول",
		deleteTitle: "این محصول حذف شود؟",
		deleteHelp:
			"این کار محصول و معلومات ذخیره‌شده آن را برای همیشه حذف می‌کند. محصول پیوندخورده به سابقه تجارتی محافظت‌شده حذف نمی‌شود.",
		deleteSuccess: "محصول حذف شد.",
	},
	ps: {
		steps: ["د پلور تنظیم", "د محصول معلومات", "بڼې او بیې", "انځورونه"],
		next: "بل",
		previous: "مخکینی",
		submit: "محصول واستوئ",
		submitHelp:
			"کله چې معلومات بشپړ شي، محصول واستوئ. په بازار کې له ښکاره کېدو مخکې باید تایید شي.",
		listHelp: "ستاسو ټول محصولات په یوه ځای کې.",
		filters: "د محصولاتو چاڼ",
		all: "ټول محصولات",
		filterNote:
			"ستاسو ټول د مدیریت وړ کاروبارونه. د حالت چاڼ خوندي شوې مخینه هم رانغاړي.",
		history: "خوندي بڼې او د ښودلو تنظیمات",
		step: "پړاو",
		advanced: "د مقدار او بستې تنظیمات",
		submitted:
			"د دې محصول یوه بڼه د تایید په تمه ده. نور بدلونونه د نوې مسودې په توګه خوندي کولای شئ.",
		savedToast: "د محصول بدلونونه خوندي شول.",
		submittedToast: "محصول د بیاکتنې لپاره واستول شو.",
		errorToast: "دا کار بشپړ نه شو. پیغام وګورئ او بیا هڅه وکړئ.",
		delete: "محصول ړنګ کړئ",
		deleteTitle: "دا محصول ړنګ شي؟",
		deleteHelp:
			"دا کار محصول او خوندي شوي معلومات د تل لپاره ړنګوي. له خوندي سوداګریزې مخینې سره تړلی محصول نه شي ړنګېدای.",
		deleteSuccess: "محصول ړنګ شو.",
	},
	ar: {
		steps: ["إعداد البيع", "تفاصيل المنتج", "الخيارات والأسعار", "الصور"],
		next: "التالي",
		previous: "السابق",
		submit: "إرسال المنتج",
		submitHelp:
			"أرسل المنتج بعد إكمال المعلومات. يحتاج إلى الموافقة قبل ظهوره في السوق.",
		listHelp: "جميع منتجاتك في مكان واحد.",
		filters: "تصفية المنتجات",
		all: "جميع المنتجات",
		filterNote:
			"جميع الأنشطة التي يمكنك إدارتها. تشمل تصفية الحالة السجل المحفوظ أيضاً.",
		history: "الإصدارات المحفوظة وإعدادات العرض",
		step: "الخطوة",
		advanced: "إعدادات الكمية والعبوة",
		submitted:
			"هناك إصدار من هذا المنتج بانتظار الموافقة. يمكنك حفظ التغييرات الإضافية كمسودة جديدة.",
		savedToast: "تم حفظ تغييرات المنتج.",
		submittedToast: "تم إرسال المنتج للمراجعة.",
		errorToast: "تعذر إكمال هذا الإجراء. راجع الرسالة وحاول مرة أخرى.",
		delete: "حذف المنتج",
		deleteTitle: "حذف هذا المنتج؟",
		deleteHelp:
			"سيؤدي ذلك إلى حذف المنتج وتفاصيله المحفوظة نهائياً. لا يمكن حذف المنتجات المرتبطة بسجل تجاري محمي.",
		deleteSuccess: "تم حذف المنتج.",
	},
};
