import type { Locale } from "./locales";
const en = {
	dirty:
		"You have unsaved changes. Save a new draft or discard them before changing publication status.",
	discardPrompt:
		"This action would discard your unsaved changes. Keep editing or discard them?",
	keep: "Keep editing",
	discard: "Discard changes",
	working:
		"Working preview — includes unsaved changes; this is not the publication target.",
	savedPreview: "Preview saved revision",
	savedTarget: "Saved revision for review and publication",
	validation: "Correct the following fields. Your input is retained.",
	denied:
		"Your session or permission does not allow this action. Sign in again or contact the owner. Your input is retained.",
	dependency:
		"The service could not complete the request. Try again. Your input is retained.",
	limited:
		"Too many requests. Wait before trying again. Your input is retained.",
	plainText:
		"Use plain text. Remove angle brackets, markup and hidden direction/control characters.",
	target:
		"Choose an implemented internal destination, such as /help or /auth/buyer-registration. External URLs are not allowed here.",
	source:
		"Choose the exact Dari source. Keep its section order, visibility, images, list lengths, link destinations and support values unchanged.",
	limit:
		"Reduce this value or list: 24 sections, 6 navigation groups, 12 items per list, 8 section links and 12 navigation links per group. Respect each field's length limit.",
	documentLimit: "Reduce the document to at most 80 KB.",
	unique: "Remove duplicate items or identifiers.",
	required: "Enter a valid value for this field.",
	image: "Provide alternative text for the selected image.",
	documentRule:
		"Check the content type, section settings and required fields. Correct the document before saving.",
};
type Copy = { [K in keyof typeof en]: string };
export const contentEditorCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		dirty:
			"تغییرات ذخیره‌نشده دارید. پیش از تغییر وضعیت نشر، پیش‌نویس نو را ذخیره کنید یا از تغییرات بگذرید.",
		discardPrompt:
			"این کار تغییرات ذخیره‌نشدهٔ شما را از بین می‌برد. ویرایش را ادامه می‌دهید یا از تغییرات می‌گذرید؟",
		keep: "ادامهٔ ویرایش",
		discard: "صرف‌نظر از تغییرات",
		working:
			"پیش‌نمایش در حال ویرایش؛ شامل تغییرات ذخیره‌نشده است و نسخهٔ مورد نشر نیست.",
		savedPreview: "پیش‌نمایش نسخهٔ ذخیره‌شده",
		savedTarget: "نسخهٔ ذخیره‌شده برای بررسی و نشر",
		validation: "خانه‌های زیر را اصلاح کنید. معلومات واردشدهٔ شما حفظ شده است.",
		denied:
			"نشست یا صلاحیت شما اجازهٔ این کار را نمی‌دهد. دوباره وارد شوید یا با مالک تماس بگیرید. معلومات شما حفظ شده است.",
		dependency:
			"خدمت نتوانست درخواست را تکمیل کند. دوباره تلاش کنید. معلومات شما حفظ شده است.",
		limited:
			"درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید. معلومات شما حفظ شده است.",
		plainText:
			"متن ساده بنویسید. نشانه‌های < و >، کدهای نشانه‌گذاری و نویسه‌های پنهان کنترول جهت را حذف کنید.",
		target:
			"یک مقصد داخلی فعال مانند /help یا /auth/buyer-registration را انتخاب کنید. نشانی بیرونی در این خانه مجاز نیست.",
		source:
			"نسخهٔ دقیق منبع دری را انتخاب کنید. ترتیب، نمایش، تصویرها، تعداد موارد، مقصد پیوندها و معلومات پشتیبانی را مانند منبع نگه دارید.",
		limit:
			"اندازهٔ متن یا فهرست را کم کنید: ۲۴ بخش، ۶ گروه راهبری، ۱۲ مورد در هر فهرست، ۸ پیوند در هر بخش و ۱۲ پیوند در هر گروه راهبری. حد طول هر خانه را رعایت کنید.",
		documentLimit: "اندازهٔ سند را به حداکثر ۸۰ کیلوبایت کاهش دهید.",
		unique: "موارد یا شناسه‌های تکراری را حذف کنید.",
		required: "در این خانه یک مقدار معتبر وارد کنید.",
		image: "برای تصویر انتخاب‌شده توضیح بنویسید.",
		documentRule:
			"نوع محتوا، تنظیمات بخش‌ها و خانه‌های ضروری را بررسی و سند را پیش از ذخیره اصلاح کنید.",
	},
	ps: {
		dirty:
			"ناساتل شوي بدلونونه لرئ. د خپرېدو د حالت له بدلولو مخکې نوې مسوده وساتئ یا بدلونونه پرېږدئ.",
		discardPrompt:
			"دا کار به ناساتل شوي بدلونونه له منځه یوسي. سمون ته دوام ورکوئ که بدلونونه پرېږدئ؟",
		keep: "سمون ته دوام",
		discard: "بدلونونه پرېښودل",
		working: "د سمون مخکتنه؛ ناساتل شوي بدلونونه لري او د خپرېدو نسخه نه ده.",
		savedPreview: "د ساتل شوې نسخې مخکتنه",
		savedTarget: "د بیاکتنې او خپرېدو ساتل شوې نسخه",
		validation: "لاندې خانې سمې کړئ. داخل شوي معلومات مو ساتل شوي.",
		denied:
			"ناسته یا واک مو د دې کار اجازه نه ورکوي. بیا ننوځئ یا له مالک سره اړیکه ونیسئ. معلومات مو ساتل شوي.",
		dependency: "خدمت غوښتنه بشپړه نه کړه. بیا هڅه وکړئ. معلومات مو ساتل شوي.",
		limited: "غوښتنې ډېرې دي. لږ وروسته بیا هڅه وکړئ. معلومات مو ساتل شوي.",
		plainText:
			"ساده متن ولیکئ. د < او > نښې، مارک‌اپ او د لوري پټې کنټرولي نښې لرې کړئ.",
		target:
			"فعاله دننۍ موخه لکه /help یا /auth/buyer-registration وټاکئ. بهرنۍ پتې دلته اجازه نه لري.",
		source:
			"د دري سرچینې کره نسخه وټاکئ. ترتیب، ښودل، انځورونه، د توکو شمېر، د تړونو موخې او د ملاتړ معلومات یې وساتئ.",
		limit:
			"متن یا لړ لنډ کړئ: ۲۴ برخې، ۶ لارموندنې ډلې، په هر لړ کې ۱۲ توکي، په هره برخه کې ۸ او په هرې لارموندنې ډلې کې ۱۲ تړوني. د هرې خانې د اوږدوالي حد وساتئ.",
		documentLimit: "سند تر ډېره ۸۰ کیلوبایټو ته راکم کړئ.",
		unique: "تکراري توکي یا پېژندونه لرې کړئ.",
		required: "دې خانې ته سم ارزښت ورکړئ.",
		image: "د ټاکل شوي انځور وضاحت ولیکئ.",
		documentRule:
			"د منځپانګې ډول، د برخو امستنې او اړینې خانې وګورئ او له ساتلو مخکې سند سم کړئ.",
	},
	ar: {
		dirty:
			"لديك تغييرات غير محفوظة. احفظ مسودة جديدة أو تجاهل التغييرات قبل تغيير حالة النشر.",
		discardPrompt:
			"سيؤدي هذا الإجراء إلى فقدان تغييراتك غير المحفوظة. هل تتابع التحرير أم تتجاهلها؟",
		keep: "متابعة التحرير",
		discard: "تجاهل التغييرات",
		working:
			"معاينة العمل؛ تتضمن تغييرات غير محفوظة وليست النسخة المستهدفة للنشر.",
		savedPreview: "معاينة النسخة المحفوظة",
		savedTarget: "النسخة المحفوظة للمراجعة والنشر",
		validation: "صحح الحقول التالية. حُفظت مدخلاتك.",
		denied:
			"لا تسمح جلستك أو صلاحيتك بهذا الإجراء. سجّل الدخول مجددًا أو تواصل مع المالك. حُفظت مدخلاتك.",
		dependency: "تعذر على الخدمة إكمال الطلب. حاول مجددًا. حُفظت مدخلاتك.",
		limited: "الطلبات كثيرة. انتظر قبل المحاولة مجددًا. حُفظت مدخلاتك.",
		plainText:
			"استخدم نصًا عاديًا. أزل علامتي < و > والوسوم ومحارف التحكم الخفية باتجاه النص.",
		target:
			"اختر وجهة داخلية متاحة مثل /help أو /auth/buyer-registration. لا يُسمح بروابط خارجية هنا.",
		source:
			"اختر نسخة المصدر الدري المحددة. حافظ على ترتيب الأقسام وظهورها وصورها وأعداد العناصر ووجهات الروابط وبيانات الدعم.",
		limit:
			"قلل النص أو القائمة: ٢٤ قسمًا و٦ مجموعات تنقل و١٢ عنصرًا لكل قائمة و٨ روابط لكل قسم و١٢ رابطًا لكل مجموعة تنقل. التزم بحد طول كل حقل.",
		documentLimit: "قلل حجم المستند إلى ٨٠ كيلوبايت كحد أقصى.",
		unique: "أزل العناصر أو المعرفات المكررة.",
		required: "أدخل قيمة صالحة في هذا الحقل.",
		image: "أضف وصفًا بديلًا للصورة المختارة.",
		documentRule:
			"تحقق من نوع المحتوى وإعدادات الأقسام والحقول المطلوبة وصحح المستند قبل الحفظ.",
	},
};
