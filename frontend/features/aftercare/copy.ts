import type { Locale } from "../../lib/i18n/locales";
import { fulfilmentCopy } from "../fulfilment/copy.ts";
const en = {
	buyerTitle: "Cancellations and refunds", sellerTitle: "Order aftercare", title: "Cancellations, amendments and refunds",
	intro: "Staff decide cancellation and amendment requests. Approval does not send money. Reports record refunds already sent; independent staff review is still required.",
	cancelOrder: "Request cancellation", cancelWithdraw: "Withdraw cancellation request", amend: "Propose a decrease", amendWithdraw: "Withdraw amendment proposal",
	excess: "Create excess refund due", report: "Report goods refund sent", refundWithdraw: "Withdraw refund report", deliveryRefund: "Report provider delivery refund",
	rules: "Before dispatch only. Decrease quantities or unit prices; no new lines, increases, substitutions or zero quantities. Wholesale minimums and current increments still apply. Original due time does not change.",
	cancelNote: "A pending cancellation blocks dispatch and completion. Withdrawal keeps the history and does not automatically clear the hold. Approved cancellation is terminal; post-dispatch issues need the future dispute process.",
	refundNote: "Report only an actual refund for the exact due amount. This is not a payment instruction, automatic refund or confirmation that the buyer received funds.",
	deliveryNote: "Provider refunds are separate from goods money and invoices. Current arrangement and finalized payee are not interchangeable. Independent staff confirmation is required.",
	adjustments: "Invoice adjustments", immutable: "The original invoice and document bytes remain unchanged. These separate adjustments record the approved changes.",
	effectiveLines: "Current accepted lines", before: "Before", after: "After", quantity: "Quantity", unitPrice: "Unit price", originalTotal: "Original invoice total", acceptedTotal: "Current accepted total",
	received: "Goods received by seller", refunded: "Confirmed goods refunds", refundDue: "Outstanding refund due", remainingDue: "Remaining goods due", balance: "Excess balance",
	dues: "Goods refund dues", reports: "Goods refund reports", cancellations: "Cancellation history", amendments: "Amendment history", deliveryRefunds: "Delivery refund history", target: "Reviewed record", sentAt: "Actual refund time", reference: "Refund reference", providerRefunded: "Confirmed delivery refunds", limit: "Available refund bound",
	email: "Email about unread cancellation, amendment and refund activity", emailNote: "Optional and independent of message and payment emails. Emails contain an authenticated link, not financial or evidence details.",
	throttled: "Too many requests. Wait before trying again; the current packet is retained.", invalid: "Check the exact amount, non-future time, reason and permitted decreases. No action was submitted.",
	pending: "Pending staff review", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", confirmed: "Confirmed", due: "Refund due", reported: "Reported; awaiting review", cancellation: "Cancellation", amendment: "Amendment", excessCause: "Excess payment", cancelled: "Order cancelled", empty: "No aftercare activity yet.",
};
type Copy = Record<keyof typeof en, string>;
const own: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		buyerTitle: "لغوها و بازپرداخت‌ها", sellerTitle: "رسیدگی پس از سفارش", title: "لغو، اصلاح و بازپرداخت",
		intro: "کارمندان درباره درخواست لغو و اصلاح تصمیم می‌گیرند. تأیید به معنای ارسال پول نیست. گزارش، بازپرداخت انجام‌شده را ثبت می‌کند و هنوز به بررسی مستقل نیاز دارد.",
		cancelOrder: "درخواست لغو سفارش", cancelWithdraw: "پس‌گرفتن درخواست لغو", amend: "پیشنهاد کاهش", amendWithdraw: "پس‌گرفتن پیشنهاد اصلاح",
		excess: "ثبت بازپرداخت لازم برای مبلغ اضافی", report: "گزارش بازپرداخت ارسال‌شده کالا", refundWithdraw: "پس‌گرفتن گزارش بازپرداخت", deliveryRefund: "گزارش بازپرداخت عرضه‌کننده تحویل",
		rules: "فقط پیش از ارسال. کاهش مقدار یا قیمت واحد مجاز است؛ ردیف جدید، افزایش، تعویض یا مقدار صفر مجاز نیست. حداقل عمده‌فروشی و گام فعلی مقدار رعایت می‌شود. سررسید اصلی تغییر نمی‌کند.",
		cancelNote: "درخواست لغو در انتظار، ارسال و تکمیل را متوقف می‌کند. پس‌گرفتن، تاریخچه را نگه می‌دارد و توقف را خودکار رفع نمی‌کند. لغو تأییدشده نهایی است؛ مشکلات پس از ارسال به روند آینده اختلاف مربوط است.",
		refundNote: "فقط بازپرداخت واقعی و دقیقاً به مبلغ لازم را گزارش دهید. این دستور پرداخت، بازپرداخت خودکار یا تأیید دریافت پول توسط خریدار نیست.",
		deliveryNote: "بازپرداخت عرضه‌کننده از پول کالا و فاکتور جدا است. عرضه‌کننده فعلی و دریافت‌کننده نهایی هزینه یکسان فرض نمی‌شوند. تأیید مستقل کارمند لازم است.",
		adjustments: "تعدیلات فاکتور", immutable: "فاکتور و فایل اصلی بدون تغییر می‌ماند. این تعدیلات جداگانه، تغییرات تأییدشده را ثبت می‌کند.",
		effectiveLines: "ردیف‌های پذیرفته‌شده فعلی", before: "پیش از تغییر", after: "پس از تغییر", quantity: "مقدار", unitPrice: "قیمت واحد", originalTotal: "مجموع فاکتور اصلی", acceptedTotal: "مجموع پذیرفته‌شده فعلی",
		received: "پول کالای دریافت‌شده توسط فروشنده", refunded: "بازپرداخت تأییدشده کالا", refundDue: "بازپرداخت باقی‌مانده", remainingDue: "باقی‌مانده قابل پرداخت کالا", balance: "مانده اضافی",
		dues: "مبالغ بازپرداخت لازم کالا", reports: "گزارش‌های بازپرداخت کالا", cancellations: "تاریخچه لغو", amendments: "تاریخچه اصلاح", deliveryRefunds: "تاریخچه بازپرداخت تحویل", target: "سند مورد بررسی", sentAt: "زمان واقعی بازپرداخت", reference: "مرجع بازپرداخت", providerRefunded: "بازپرداخت تأییدشده تحویل", limit: "حد موجود بازپرداخت",
		email: "ایمیل فعالیت خوانده‌نشده لغو، اصلاح و بازپرداخت", emailNote: "اختیاری و مستقل از ایمیل پیام و پرداخت است. ایمیل فقط پیوند ورود دارد، نه جزئیات مالی یا مدارک.",
		throttled: "درخواست‌ها زیاد است. پیش از تلاش دوباره صبر کنید؛ بسته فعلی نگه داشته شده است.", invalid: "مبلغ دقیق، زمان گذشته، دلیل و کاهش مجاز را بررسی کنید. هیچ عملی ارسال نشد.",
		pending: "در انتظار بررسی کارمند", approved: "تأییدشده", rejected: "ردشده", withdrawn: "پس‌گرفته‌شده", confirmed: "تصدیق‌شده", due: "بازپرداخت لازم", reported: "گزارش‌شده؛ در انتظار بررسی", cancellation: "لغو", amendment: "اصلاح", excessCause: "پرداخت اضافی", cancelled: "سفارش لغو شده", empty: "هنوز فعالیت رسیدگی پس از سفارش وجود ندارد.",
	},
	ps: {
		buyerTitle: "لغوه کول او بېرته تادیې", sellerTitle: "له سپارښتنې وروسته پاملرنه", title: "لغوه کول، سمون او بېرته تادیه",
		intro: "کارکوونکي د لغوه کولو او سمون په غوښتنو پرېکړه کوي. منظوري د پیسو لېږل نه دي. راپور د مخکې لېږل شوې بېرته تادیې ثبت دی او خپلواکې کتنې ته اړتیا لري.",
		cancelOrder: "د لغوه کولو غوښتنه", cancelWithdraw: "د لغوه کولو غوښتنه بېرته اخیستل", amend: "د کمولو وړاندیز", amendWithdraw: "د سمون وړاندیز بېرته اخیستل",
		excess: "د اضافي پیسو بېرته تادیه ثبتول", report: "د توکو لېږل شوې بېرته تادیې راپور", refundWithdraw: "د بېرته تادیې راپور بېرته اخیستل", deliveryRefund: "د رسوونکي بېرته تادیې راپور",
		rules: "یوازې تر لېږد مخکې. مقدار یا د واحد بیه کمول؛ نوې کرښې، زیاتوالی، بدلول او صفر مقدار نه منل کېږي. د عمده خرڅلاو لږ تر لږه او اوسني ګامونه لا هم پلي دي. اصلي ټاکلې نېټه نه بدلېږي.",
		cancelNote: "د لغوه کولو پاتې غوښتنه لېږد او بشپړول بندوي. بېرته اخیستل تاریخچه ساتي او بندیز په خپله نه لرې کوي. منل شوی لغوه کول وروستی دی؛ تر لېږد وروسته ستونزې د راتلونکي شخړې بهیر پورې اړه لري.",
		refundNote: "یوازې رښتینې بېرته تادیه د دقیق لازم مبلغ لپاره راپور کړئ. دا د پیسو امر، اتومات بېرته تادیه یا د پېرودونکي د ترلاسه کولو تایید نه دی.",
		deliveryNote: "د رسوونکي بېرته تادیې د توکو له پیسو او رسیدونو جلا دي. اوسنی رسوونکی او وروستی اخیستونکی یو مه ګڼئ. د خپلواک کارکوونکي تایید اړین دی.",
		adjustments: "د رسید سمونونه", immutable: "اصلي رسید او فایل نه بدلېږي. دا جلا سمونونه منل شوي بدلونونه ثبتوي.",
		effectiveLines: "اوسنۍ منل شوې کرښې", before: "مخکې", after: "وروسته", quantity: "مقدار", unitPrice: "د واحد بیه", originalTotal: "د اصلي رسید ټول مبلغ", acceptedTotal: "اوسنی منل شوی ټول مبلغ",
		received: "د پلورونکي ترلاسه کړې د توکو پیسې", refunded: "تایید شوې د توکو بېرته تادیې", refundDue: "پاتې بېرته تادیه", remainingDue: "د توکو پاتې تادیه", balance: "اضافي پاتې پیسې",
		dues: "د توکو لازمې بېرته تادیې", reports: "د توکو بېرته تادیې راپورونه", cancellations: "د لغوه کولو تاریخچه", amendments: "د سمون تاریخچه", deliveryRefunds: "د رسولو بېرته تادیې تاریخچه", target: "تر کتنې لاندې سند", sentAt: "د بېرته تادیې رښتینی وخت", reference: "د بېرته تادیې مرجع", providerRefunded: "تایید شوې د رسولو بېرته تادیې", limit: "د بېرته تادیې شته حد",
		email: "د نالوستل شوې لغوه کولو، سمون او بېرته تادیې برېښنالیک", emailNote: "اختیاري او د پیغام او تادیې له برېښنالیکونو جلا دی. برېښنالیک یوازې د ننوتلو تړونی لري، نه مالي یا د ثبوت جزئیات.",
		throttled: "غوښتنې ډېرې دي. بیا هڅې ته انتظار وکړئ؛ اوسنی بسته ساتل شوی دی.", invalid: "دقیق مبلغ، نه راتلونکی وخت، دلیل او اجازه لرونکي کمښتونه وګورئ. هېڅ عمل ونه لېږل شو.",
		pending: "د کارکوونکي کتنې ته په تمه", approved: "منل شوی", rejected: "رد شوی", withdrawn: "بېرته اخیستل شوی", confirmed: "تایید شوی", due: "لازمه بېرته تادیه", reported: "راپور شوی؛ کتنې ته په تمه", cancellation: "لغوه کول", amendment: "سمون", excessCause: "اضافي تادیه", cancelled: "سپارښتنه لغوه شوه", empty: "تر اوسه له سپارښتنې وروسته فعالیت نشته.",
	},
	ar: {
		buyerTitle: "الإلغاءات والمبالغ المستردة", sellerTitle: "متابعة الطلبات", title: "الإلغاء والتعديل والاسترداد",
		intro: "يقرر الموظفون في طلبات الإلغاء والتعديل. الموافقة لا ترسل أموالاً. تسجل التقارير مبالغ أُرسلت بالفعل وتظل بحاجة إلى مراجعة مستقلة.",
		cancelOrder: "طلب إلغاء", cancelWithdraw: "سحب طلب الإلغاء", amend: "اقتراح تخفيض", amendWithdraw: "سحب اقتراح التعديل",
		excess: "إنشاء استحقاق استرداد الزيادة", report: "الإبلاغ عن استرداد البضائع المرسل", refundWithdraw: "سحب تقرير الاسترداد", deliveryRefund: "الإبلاغ عن استرداد مزود التوصيل",
		rules: "قبل الشحن فقط. تخفيض الكمية أو سعر الوحدة؛ لا بنود جديدة أو زيادات أو استبدال أو كميات صفرية. تظل حدود الجملة وخطوات الكمية الحالية سارية. لا يتغير موعد الاستحقاق الأصلي.",
		cancelNote: "يمنع طلب الإلغاء المعلق الشحن والإكمال. يحتفظ السحب بالسجل ولا يرفع التعليق تلقائياً. الإلغاء المعتمد نهائي؛ مشكلات ما بعد الشحن تخص مرحلة النزاعات المستقبلية.",
		refundNote: "أبلغ فقط عن استرداد فعلي بالمبلغ المستحق بالضبط. هذا ليس أمر دفع أو استرداداً تلقائياً أو تأكيداً لاستلام المشتري الأموال.",
		deliveryNote: "استردادات المزود منفصلة عن أموال البضائع وفواتيرها. المزود الحالي والمستفيد المعتمد ليسا قابلين للتبادل. يلزم تأكيد موظف مستقل.",
		adjustments: "تعديلات الفاتورة", immutable: "تبقى الفاتورة الأصلية وملفاتها دون تغيير. تسجل هذه التعديلات المنفصلة التغييرات المعتمدة.",
		effectiveLines: "البنود المقبولة الحالية", before: "قبل", after: "بعد", quantity: "الكمية", unitPrice: "سعر الوحدة", originalTotal: "إجمالي الفاتورة الأصلية", acceptedTotal: "الإجمالي المقبول الحالي",
		received: "أموال البضائع التي استلمها البائع", refunded: "استردادات البضائع المؤكدة", refundDue: "الاسترداد المتبقي المستحق", remainingDue: "المتبقي المستحق للبضائع", balance: "الرصيد الزائد",
		dues: "استحقاقات استرداد البضائع", reports: "تقارير استرداد البضائع", cancellations: "سجل الإلغاء", amendments: "سجل التعديل", deliveryRefunds: "سجل استرداد التوصيل", target: "السجل قيد المراجعة", sentAt: "وقت الاسترداد الفعلي", reference: "مرجع الاسترداد", providerRefunded: "استردادات التوصيل المؤكدة", limit: "حد الاسترداد المتاح",
		email: "بريد لنشاط الإلغاء والتعديل والاسترداد غير المقروء", emailNote: "اختياري ومستقل عن بريد الرسائل والمدفوعات. يتضمن البريد رابط دخول فقط دون تفاصيل مالية أو أدلة.",
		throttled: "طلبات كثيرة. انتظر قبل المحاولة مجدداً؛ تم الاحتفاظ بالحزمة الحالية.", invalid: "تحقق من المبلغ الدقيق والوقت غير المستقبلي والسبب والتخفيضات المسموحة. لم يُرسل أي إجراء.",
		pending: "بانتظار مراجعة الموظف", approved: "معتمد", rejected: "مرفوض", withdrawn: "مسحوب", confirmed: "مؤكد", due: "استرداد مستحق", reported: "تم الإبلاغ؛ بانتظار المراجعة", cancellation: "إلغاء", amendment: "تعديل", excessCause: "دفع زائد", cancelled: "تم إلغاء الطلب", empty: "لا يوجد نشاط متابعة حتى الآن.",
	},
};
const ui = {
	en: {
		openWorkspace: "Open order aftercare", loadGoods: "Show goods refund details", loadDelivery: "Show delivery refund details",
		domainUnavailable: "These details are unavailable in your current role.", noAccess: "Your current identity or role cannot access this aftercare workspace.",
		noActions: "No aftercare action is currently available.", selectLines: "Select only the lines to decrease. Other accepted lines remain unchanged.",
		selected: "Include in proposal", recentHistory: "Recent recorded history", saved: "Action recorded. Refreshing current details.",
		unknownState: "Recorded activity", rebased: "Current versions loaded. Check your retained fields and review again.",
	},
	"fa-AF": {
		openWorkspace: "بازکردن رسیدگی سفارش", loadGoods: "نمایش جزئیات بازپرداخت کالا", loadDelivery: "نمایش جزئیات بازپرداخت تحویل",
		domainUnavailable: "این جزئیات برای نقش فعلی شما در دسترس نیست.", noAccess: "هویت یا نقش فعلی شما به این بخش رسیدگی دسترسی ندارد.",
		noActions: "اکنون هیچ اقدام رسیدگی در دسترس نیست.", selectLines: "فقط ردیف‌هایی را انتخاب کنید که کاهش می‌دهید. دیگر ردیف‌ها بدون تغییر می‌مانند.",
		selected: "شامل پیشنهاد", recentHistory: "تاریخچه ثبت‌شده اخیر", saved: "اقدام ثبت شد. جزئیات فعلی تازه می‌شود.",
		unknownState: "فعالیت ثبت‌شده", rebased: "نسخه‌های فعلی بارگذاری شد. فیلدهای حفظ‌شده را بررسی و دوباره بازبینی کنید.",
	},
	ps: {
		openWorkspace: "د سپارښتنې پاملرنه پرانیستل", loadGoods: "د توکو بېرته تادیې جزئیات ښودل", loadDelivery: "د رسولو بېرته تادیې جزئیات ښودل",
		domainUnavailable: "دا جزئیات ستاسو اوسني رول ته نه شته.", noAccess: "ستاسو اوسنی هویت یا رول دې پاملرنې ته لاسرسی نه لري.",
		noActions: "اوس د پاملرنې هېڅ عمل نه شته.", selectLines: "یوازې د کمولو کرښې وټاکئ. نورې منل شوې کرښې نه بدلېږي.",
		selected: "په وړاندیز کې شاملول", recentHistory: "وروستۍ ثبت شوې تاریخچه", saved: "عمل ثبت شو. اوسني جزئیات تازه کېږي.",
		unknownState: "ثبت شوی فعالیت", rebased: "اوسنۍ نسخې پورته شوې. ساتل شوي معلومات وګورئ او بیا کتنه وکړئ.",
	},
	ar: {
		openWorkspace: "فتح متابعة الطلب", loadGoods: "عرض تفاصيل استرداد البضائع", loadDelivery: "عرض تفاصيل استرداد التوصيل",
		domainUnavailable: "هذه التفاصيل غير متاحة لدورك الحالي.", noAccess: "لا تتيح هويتك أو دورك الحالي الوصول إلى مساحة المتابعة هذه.",
		noActions: "لا يتوفر إجراء متابعة حالياً.", selectLines: "اختر فقط البنود المراد تخفيضها. تبقى البنود الأخرى دون تغيير.",
		selected: "تضمين في الاقتراح", recentHistory: "السجل الحديث المسجل", saved: "تم تسجيل الإجراء. يجري تحديث التفاصيل الحالية.",
		unknownState: "نشاط مسجل", rebased: "تم تحميل الإصدارات الحالية. تحقق من الحقول المحفوظة وراجع مجدداً.",
	},
};
export const aftercareCopy = Object.fromEntries(Object.entries(own).map(([locale, copy]) => [locale, { ...fulfilmentCopy[locale as Locale], ...copy, ...ui[locale as Locale] }])) as Record<Locale, typeof fulfilmentCopy.en & Copy & typeof ui.en>;
export function aftercareState(locale: Locale, state: string) {
	const t = aftercareCopy[locale];
	const values: Record<string, string> = { pending: t.pending, approved: t.approved, rejected: t.rejected, withdrawn: t.withdrawn, confirmed: t.confirmed, due: t.due, reported: t.reported, cancellation: t.cancellation, amendment: t.amendment, excess: t.excessCause, cancelled: t.cancelled };
	return values[state] ?? t.unknownState;
}
