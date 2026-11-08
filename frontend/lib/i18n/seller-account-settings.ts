import type { Locale } from "./locales";
const en = {
	nameHelp:
		"This is your personal display name, not your company or storefront name.",
	summary: "Account information",
	summaryHelp:
		"Read-only identity and seller-account details. Email and account status cannot be edited here.",
	google: "Google sign-in",
	googleHelp:
		"Link Google to this identity using your current password. This does not add buyer access or merge another identity.",
	passwordHelp:
		"Use 12–128 characters. A successful change invalidates existing sign-ins; sign in again with the new password.",
	recoveryHelp:
		"If you do not know your current password, use password recovery. Buyer and seller access use the same password.",
	buyerPassword: "Add buyer access with your password",
	buyerGoogle: "Add buyer access with Google",
	buyerHelp:
		"Use your existing identity. New buyer access starts individual/basic; business upgrades have their own review.",
	signout: "Sign out of seller access",
	signoutAll: "Sign out of both roles in this browser",
	signoutHelp:
		"Seller sign-out leaves buyer access unchanged. The second action clears buyer and seller access in this browser, not all devices.",
	messageHelp: "Optional email reminders for unread marketplace messages.",
	emailScope:
		"These preferences belong to your seller role-account, not the selected store. Message, payment and aftercare emails can be saved independently of other settings.",
	fieldError: "Check this field and try again.",
	companyHelp:
		"Create a company draft. Public details, legal details and private verification information are kept separate; creation does not grant approval.",
};
type Copy = { [K in keyof typeof en]: string };
export const sellerAccountSettingsCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		nameHelp: "این نام نمایشی شخصی شما است، نه نام شرکت یا فروشگاه شما.",
		summary: "معلومات حساب",
		summaryHelp:
			"معلومات هویت و حساب فروشنده فقط خواندنی است. ایمیل و وضعیت حساب در اینجا قابل ویرایش نیست.",
		google: "ورود با گوگل",
		googleHelp:
			"با رمز عبور فعلی، گوگل را به همین هویت پیوند دهید. این کار دسترسی خریدار اضافه نمی‌کند و هویت دیگری را ادغام نمی‌کند.",
		passwordHelp:
			"از ۱۲ تا ۱۲۸ نویسه استفاده کنید. تغییر موفق، ورودهای موجود را باطل می‌کند؛ دوباره با رمز جدید وارد شوید.",
		recoveryHelp:
			"اگر رمز فعلی را نمی‌دانید، از بازیابی رمز استفاده کنید. دسترسی خریدار و فروشنده از یک رمز استفاده می‌کند.",
		buyerPassword: "افزودن دسترسی خریدار با رمز عبور",
		buyerGoogle: "افزودن دسترسی خریدار با گوگل",
		buyerHelp:
			"از هویت موجود خود استفاده کنید. دسترسی جدید خریدار فردی و ابتدایی است؛ ارتقای کسب‌وکار بررسی جداگانه دارد.",
		signout: "خروج از دسترسی فروشنده",
		signoutAll: "خروج از هر دو نقش در این مرورگر",
		signoutHelp:
			"خروج فروشنده دسترسی خریدار را تغییر نمی‌دهد. گزینهٔ دوم دسترسی خریدار و فروشنده را در همین مرورگر پاک می‌کند، نه در همهٔ دستگاه‌ها.",
		messageHelp: "یادآوری اختیاری ایمیلی برای پیام‌های خوانده‌نشدهٔ بازار.",
		emailScope:
			"این ترجیحات مربوط به حساب نقش فروشندهٔ شما است، نه فروشگاه انتخاب‌شده. ایمیل‌های پیام، پرداخت و پیگیری را جدا از سایر تنظیمات ذخیره کنید.",
		fieldError: "این بخش را بررسی کرده و دوباره کوشش کنید.",
		companyHelp:
			"پیش‌نویس شرکت ایجاد کنید. معلومات عمومی، قانونی و خصوصی تأیید جدا نگه داشته می‌شود؛ ایجاد شرکت به معنی تأیید نیست.",
	},
	ps: {
		nameHelp: "دا ستاسو شخصي ښودل کېدونکی نوم دی، نه د شرکت یا پلورنځي نوم.",
		summary: "د حساب معلومات",
		summaryHelp:
			"د هویت او پلورونکي حساب معلومات یوازې د لوستلو دي. بریښنالیک او د حساب حالت دلته نه بدلېږي.",
		google: "د ګوګل له لارې ننوتل",
		googleHelp:
			"د اوسني پټنوم په کارولو ګوګل له همدې هویت سره وتړئ. دا د پېرودونکي لاسرسی نه زیاتوي او بل هویت نه یوځای کوي.",
		passwordHelp:
			"له ۱۲ تر ۱۲۸ تورو وکاروئ. بریالی بدلون موجود ننوتل باطلوي؛ په نوي پټنوم بیا ننوځئ.",
		recoveryHelp:
			"که اوسنی پټنوم نه پوهېږئ، د پټنوم بېرته ترلاسه کول وکاروئ. پېرودونکی او پلورونکی یو پټنوم کاروي.",
		buyerPassword: "په پټنوم د پېرودونکي لاسرسی زیاتول",
		buyerGoogle: "په ګوګل د پېرودونکي لاسرسی زیاتول",
		buyerHelp:
			"خپل موجود هویت وکاروئ. نوی پېرودونکی انفرادي او بنسټیز لاسرسی لري؛ سوداګریز لوړول جلا کتنه غواړي.",
		signout: "د پلورونکي له لاسرسي وتل",
		signoutAll: "په دې براوزر کې له دواړو رولونو وتل",
		signoutHelp:
			"د پلورونکي وتل د پېرودونکي لاسرسی نه بدلوي. دوهم انتخاب په همدې براوزر کې دواړه لاسرسي پاکوي، نه په ټولو وسایلو کې.",
		messageHelp:
			"د بازار د نالوستل شویو پیغامونو لپاره اختیاري بریښنالیک یادونې.",
		emailScope:
			"دا غوره‌توبونه ستاسو د پلورونکي رول حساب پورې اړه لري، نه ټاکلي پلورنځي پورې. د پیغام، تادیې او وروسته تعقیب بریښنالیکونه له نورو تنظیماتو جلا خوندي کړئ.",
		fieldError: "دا برخه وګورئ او بیا هڅه وکړئ.",
		companyHelp:
			"د شرکت مسوده جوړه کړئ. عامه، قانوني او شخصي تصدیقي معلومات جلا ساتل کېږي؛ جوړول د تایید معنا نه لري.",
	},
	ar: {
		nameHelp: "هذا اسمك الشخصي المعروض، وليس اسم شركتك أو متجرك.",
		summary: "معلومات الحساب",
		summaryHelp:
			"تفاصيل الهوية وحساب البائع للقراءة فقط. لا يمكن تعديل البريد أو حالة الحساب هنا.",
		google: "تسجيل الدخول عبر Google",
		googleHelp:
			"اربط Google بهذه الهوية باستخدام كلمة مرورك الحالية. لا يضيف ذلك وصول المشتري ولا يدمج هوية أخرى.",
		passwordHelp:
			"استخدم 12–128 حرفاً. يُبطل التغيير الناجح تسجيلات الدخول الحالية؛ سجّل الدخول مجدداً بكلمة المرور الجديدة.",
		recoveryHelp:
			"إذا لم تعرف كلمة المرور الحالية، استخدم استعادتها. يشترك وصول المشتري والبائع في كلمة المرور نفسها.",
		buyerPassword: "إضافة وصول المشتري بكلمة المرور",
		buyerGoogle: "إضافة وصول المشتري عبر Google",
		buyerHelp:
			"استخدم هويتك الحالية. يبدأ وصول المشتري الجديد كفرد بالمستوى الأساسي؛ تتطلب الترقية التجارية مراجعة منفصلة.",
		signout: "تسجيل الخروج من وصول البائع",
		signoutAll: "تسجيل الخروج من الدورين في هذا المتصفح",
		signoutHelp:
			"لا يغيّر خروج البائع وصول المشتري. يمسح الخيار الثاني وصول المشتري والبائع في هذا المتصفح، وليس في جميع الأجهزة.",
		messageHelp: "تذكيرات بريدية اختيارية لرسائل السوق غير المقروءة.",
		emailScope:
			"تخص هذه التفضيلات حساب دور البائع، وليس المتجر المحدد. احفظ رسائل البريد للرسائل والمدفوعات والمتابعة بشكل منفصل عن الإعدادات الأخرى.",
		fieldError: "تحقق من هذا الحقل وحاول مجدداً.",
		companyHelp:
			"أنشئ مسودة شركة. تُفصل المعلومات العامة والقانونية ومعلومات التحقق الخاصة؛ الإنشاء لا يعني الموافقة.",
	},
};
