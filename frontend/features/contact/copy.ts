import type { Locale } from "../../lib/i18n/locales";

type ContactCopy = {
	title: string;
	intro: string;
	eyebrow: string;
	formTitle: string;
	formIntro: string;
	name: string;
	email: string;
	topic: string;
	reference: string;
	message: string;
	optional: string;
	choose: string;
	send: string;
	sending: string;
	privacy: string;
	success: string;
	successBody: string;
	another: string;
	error: string;
	invalid: string;
	limited: string;
	uncertain: string;
	helpTitle: string;
	helpBody: string;
	helpLink: string;
	details: string;
	security: string;
	topics: readonly [string, string, string, string, string];
};
export const topicValues = [
	"general",
	"selling",
	"order",
	"payment",
	"feedback",
] as const;
export const contactCopy: Record<Locale, ContactCopy> = {
	"fa-AF": {
		title: "با ما در ارتباط باشید",
		intro: "پرسش، پیشنهاد یا مشکلی دارید؟ موضوع را با ما در میان بگذارید.",
		eyebrow: "تماس با بازار رضایی",
		formTitle: "برای ما پیام بفرستید",
		formIntro:
			"فورم را تکمیل کنید. پاسخ را از طریق ایمیلی که وارد می‌کنید پیگیری خواهیم کرد.",
		name: "نام شما",
		email: "ایمیل شما",
		topic: "موضوع پیام",
		reference: "مرجع سفارش یا کالا",
		message: "پیام شما",
		optional: "اختیاری",
		choose: "موضوع را انتخاب کنید",
		send: "ارسال پیام",
		sending: "در حال ارسال…",
		privacy:
			"معلومات تماس شما برای پاسخ و پیگیری این درخواست استفاده می‌شود. رمز، کود ورود یا اسناد هویتی نفرستید.",
		success: "پیام شما ارسال شد",
		successBody: "سپاس از تماس شما. پاسخ را در ایمیل خود پیگیری کنید.",
		another: "ارسال پیام دیگر",
		error:
			"ارسال پیام ممکن نشد. متن شما محفوظ است؛ از راه ارتباطی رسمی کنار فورم استفاده کنید.",
		invalid:
			"معلومات فورم را بررسی کنید؛ نام، ایمیل معتبر، موضوع و پیامی با حداقل ۱۰ حرف لازم است.",
		limited: "تعداد درخواست‌ها زیاد است. لطفاً کمی بعد دوباره تلاش کنید.",
		uncertain:
			"نتیجهٔ ارسال مشخص نشد. پیش از ارسال دوباره، کمی منتظر بمانید یا از راه ارتباطی رسمی پیگیری کنید.",
		helpTitle: "شاید پاسخ شما اینجا باشد",
		helpBody: "برای راهنمای خرید، فروش، پرداخت و تحویل، مرکز راهنما را ببینید.",
		helpLink: "رفتن به مرکز راهنما",
		details: "راه‌های ارتباطی",
		security: "برای پیگیری بهتر، مرجع سفارش و شرح کوتاه موضوع را بنویسید.",
		topics: [
			"پرسش عمومی",
			"فروش و همکاری",
			"سفارش و تحویل",
			"پرداخت",
			"پیشنهاد و نظر",
		],
	},
	ps: {
		title: "له موږ سره په اړیکه کې اوسئ",
		intro: "پوښتنه، وړاندیز یا ستونزه لرئ؟ خپله موضوع راسره شریکه کړئ.",
		eyebrow: "له رضايي بازار سره اړیکه",
		formTitle: "موږ ته پیغام واستوئ",
		formIntro:
			"فورمه بشپړه کړئ. ستاسو غوښتنه به د ورکړل شوي ایمیل له لارې تعقیب کړو.",
		name: "ستاسو نوم",
		email: "ستاسو ایمیل",
		topic: "د پیغام موضوع",
		reference: "د فرمایش یا توکي مرجع",
		message: "ستاسو پیغام",
		optional: "اختیاري",
		choose: "موضوع وټاکئ",
		send: "پیغام واستوئ",
		sending: "د لېږلو په حال کې…",
		privacy:
			"ستاسو د اړیکې معلومات د همدې غوښتنې د ځواب او تعقیب لپاره کارول کېږي. پټنوم، د ننوتلو کوډ یا هویتي اسناد مه استوئ.",
		success: "ستاسو پیغام واستول شو",
		successBody: "له اړیکې مو مننه. ځواب په خپل ایمیل کې تعقیب کړئ.",
		another: "بل پیغام استول",
		error:
			"پیغام ونه لېږل شو. متن مو ساتل شوی؛ د فورمې ترڅنګ د اړیکې رسمي لاره وکاروئ.",
		invalid:
			"د فورمې معلومات وګورئ؛ نوم، معتبر ایمیل، موضوع او لږ تر لږه ۱۰ توري لرونکی پیغام اړین دي.",
		limited: "غوښتنې ډېرې دي. مهرباني وکړئ لږ وروسته بیا هڅه وکړئ.",
		uncertain:
			"د لېږلو پایله معلومه نه شوه. له بیا لېږلو مخکې لږ انتظار وکړئ یا له رسمي لارې موضوع تعقیب کړئ.",
		helpTitle: "ښايي ځواب مو دلته وي",
		helpBody:
			"د پېر، پلور، تادیې او سپارلو د لارښوونو لپاره د مرستې مرکز وګورئ.",
		helpLink: "د مرستې مرکز ته لاړ شئ",
		details: "د اړیکې لارې",
		security: "د غوره تعقیب لپاره د فرمایش مرجع او د موضوع لنډ بیان ولیکئ.",
		topics: [
			"عمومي پوښتنه",
			"پلور او همکاري",
			"فرمایش او سپارل",
			"تادیه",
			"وړاندیز او نظر",
		],
	},
	en: {
		title: "Let’s talk",
		intro: "Have a question, suggestion or problem? Tell us how we can help.",
		eyebrow: "Contact Bazar Rezayi",
		formTitle: "Send us a message",
		formIntro:
			"Complete the form below. We’ll follow up using the email address you provide.",
		name: "Your name",
		email: "Your email",
		topic: "Topic",
		reference: "Order or product reference",
		message: "Your message",
		optional: "optional",
		choose: "Choose a topic",
		send: "Send message",
		sending: "Sending…",
		privacy:
			"Your contact details will be used to respond to and follow up on this request. Do not include passwords, sign-in codes or identity documents.",
		success: "Your message has been sent",
		successBody:
			"Thank you for getting in touch. Look out for a reply in your email.",
		another: "Send another message",
		error:
			"We couldn’t send your message. Your text is still here; use the official contact details beside the form.",
		invalid:
			"Check the form: a name, valid email, topic and message of at least 10 characters are required.",
		limited: "Too many requests. Please try again later.",
		uncertain:
			"We couldn’t confirm the result. Wait before sending again, or follow up through the official contact details.",
		helpTitle: "Your answer may already be here",
		helpBody:
			"Find guidance on buying, selling, payments and delivery in our help centre.",
		helpLink: "Visit the help centre",
		details: "Contact details",
		security:
			"For easier follow-up, include your order reference and a short explanation.",
		topics: [
			"General enquiry",
			"Selling & partnerships",
			"Order & delivery",
			"Payment",
			"Feedback & suggestions",
		],
	},
	ar: {
		title: "يسعدنا تواصلك",
		intro: "لديك سؤال أو اقتراح أو مشكلة؟ أخبرنا كيف يمكننا مساعدتك.",
		eyebrow: "تواصل مع سوق رضائي",
		formTitle: "أرسل لنا رسالة",
		formIntro:
			"أكمل النموذج أدناه. سنتابع طلبك عبر البريد الإلكتروني الذي تقدمه.",
		name: "اسمك",
		email: "بريدك الإلكتروني",
		topic: "موضوع الرسالة",
		reference: "مرجع الطلب أو المنتج",
		message: "رسالتك",
		optional: "اختياري",
		choose: "اختر الموضوع",
		send: "إرسال الرسالة",
		sending: "جارٍ الإرسال…",
		privacy:
			"ستُستخدم بيانات اتصالك للرد على هذا الطلب ومتابعته. لا تُدرج كلمات المرور أو رموز الدخول أو وثائق الهوية.",
		success: "تم إرسال رسالتك",
		successBody: "شكراً لتواصلك. تابع الرد عبر بريدك الإلكتروني.",
		another: "إرسال رسالة أخرى",
		error:
			"تعذر إرسال الرسالة. لا يزال النص محفوظاً؛ استخدم بيانات الاتصال الرسمية بجانب النموذج.",
		invalid:
			"راجع النموذج؛ الاسم والبريد الإلكتروني الصحيح والموضوع ورسالة من ١٠ أحرف على الأقل مطلوبة.",
		limited: "طلبات كثيرة. يرجى المحاولة لاحقاً.",
		uncertain:
			"تعذر تأكيد نتيجة الإرسال. انتظر قبل المحاولة مجدداً أو تابع عبر بيانات الاتصال الرسمية.",
		helpTitle: "قد تجد إجابتك هنا",
		helpBody:
			"اطلع على إرشادات الشراء والبيع والدفع والتسليم في مركز المساعدة.",
		helpLink: "زيارة مركز المساعدة",
		details: "بيانات الاتصال",
		security: "لتسهيل المتابعة، اذكر مرجع الطلب ووصفاً مختصراً للموضوع.",
		topics: [
			"استفسار عام",
			"البيع والشراكات",
			"الطلب والتسليم",
			"الدفع",
			"الملاحظات والاقتراحات",
		],
	},
};
