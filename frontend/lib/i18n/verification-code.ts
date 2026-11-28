import type { Locale } from "./locales";

export const verificationCodeCopy = {
	en: {
		received:
			"Your request was received. Check your email for a verification code.",
		code: "Verification code",
		help: "Enter the six digit code sent to your email. It expires after 10 minutes.",
		resend: "Send another code",
		wait: "You can request another code in",
		invalid:
			"The code is incorrect, expired, or already used. Check it or request another code.",
		activated: "Your email is verified. Sign in to continue.",
		seller:
			"Your seller account is active. Complete your individual or company business profile and submit it for admin review. Selling becomes available after approval.",
		buyer:
			"Your buyer account is active. You can start shopping. For business purchasing, complete and submit a business profile for verification.",
	},
	"fa-AF": {
		received:
			"درخواست شما ثبت شد. لطفاً ایمیل خود را بررسی کنید؛ یک کد تایید برای شما ارسال شده است.",
		code: "کد تایید",
		help: "کد شش رقمی ارسال شده به ایمیل خود را وارد کنید. این کد تا ۱۰ دقیقه اعتبار دارد.",
		resend: "ارسال دوباره کد",
		wait: "زمان باقی مانده تا ارسال دوباره کد",
		invalid:
			"کد نادرست است، اعتبار آن پایان یافته یا قبلاً استفاده شده است. کد را بررسی کنید یا کد جدید بخواهید.",
		activated: "ایمیل شما تایید شد. برای ادامه وارد حساب خود شوید.",
		seller:
			"حساب فروشندگی شما فعال شد. لطفاً در بخش پروفایل، مشخصات فردی و اطلاعات شرکت خود را تکمیل کرده و برای مدیریت ارسال کنید. حساب شما پس از بررسی و تایید مدیر، آماده فعالیت خواهد بود.",
		buyer:
			"حساب خریداری شما فعال شد. می‌توانید خرید را شروع کنید. برای خرید تجاری، مشخصات کسب و کار خود را تکمیل کرده و برای تایید مدیریت ارسال کنید.",
	},
	ps: {
		received:
			"ستاسو غوښتنه ثبت شوه. خپل برېښنالیک وګورئ؛ د تایید کوډ درلېږل شوی دی.",
		code: "د تایید کوډ",
		help: "خپل برېښنالیک ته استول شوی شپږ عددي کوډ ولیکئ. کوډ تر ۱۰ دقیقو اعتبار لري.",
		resend: "کوډ بیا واستوئ",
		wait: "د بل کوډ غوښتلو لپاره پاتې وخت",
		invalid:
			"کوډ ناسم دی، وخت یې تېر شوی یا کارول شوی دی. کوډ وګورئ یا نوی کوډ وغواړئ.",
		activated: "ستاسو برېښنالیک تایید شو. د دوام لپاره ننوځئ.",
		seller:
			"ستاسو د پلورونکي حساب فعال شو. خپل شخصي یا شرکتي سوداګریز پروفایل بشپړ او ادارې ته یې د کتنې لپاره واستوئ. پلور د ادارې له تایید وروسته پیلېږي.",
		buyer:
			"ستاسو د پېرودونکي حساب فعال شو. پېرود پیلولای شئ. د سوداګریز پېرود لپاره خپل سوداګریز پروفایل بشپړ او د تایید لپاره واستوئ.",
	},
	ar: {
		received: "تم تسجيل طلبك. تحقق من بريدك الإلكتروني؛ أرسلنا إليك رمز تأكيد.",
		code: "رمز التأكيد",
		help: "أدخل الرمز المكون من ستة أرقام المرسل إلى بريدك. تنتهي صلاحيته بعد ١٠ دقائق.",
		resend: "إرسال رمز آخر",
		wait: "الوقت المتبقي لطلب رمز آخر",
		invalid:
			"الرمز غير صحيح أو منتهي الصلاحية أو مستخدم سابقاً. تحقق منه أو اطلب رمزاً جديداً.",
		activated: "تم تأكيد بريدك الإلكتروني. سجل الدخول للمتابعة.",
		seller:
			"تم تفعيل حساب البائع. أكمل ملفك التجاري الفردي أو بيانات الشركة وأرسله لمراجعة الإدارة. يصبح البيع متاحاً بعد الموافقة.",
		buyer:
			"تم تفعيل حساب المشتري. يمكنك البدء بالتسوق. للشراء التجاري، أكمل الملف التجاري وأرسله للتحقق.",
	},
} satisfies Record<Locale, Record<string, string>>;
