import type { Locale } from "../../lib/i18n/locales";
import { aftercareCopy } from "../aftercare/copy";
import { fulfilmentCopy } from "../fulfilment/copy";
import { paymentState } from "../payments/copy";
import type { OrderActivityEvent } from "./api";
import { commerceCopy } from "./copy";

export const orderViewCopy = {
	en: {
		paymentsLabel: "Payments",
		invoiceLabel: "Invoice",
		invoiceNumber: "Invoice number",
		subtitle: "Review this order and continue with the next step.",
		overview: "Products, customer and delivery details at a glance.",
		payment: "Check the balance and manage money received for this order.",
		invoice: "View or download the original accepted invoice.",
		activity:
			"Recorded events for this order, limited to your current permissions.",
		activityEmpty: "No recorded events on this page.",
		activityDenied: "You no longer have access to this order’s activity.",
		orderEvent: "Order event",
		responseRecorded: "Response recorded",
		decisionRecorded: "Decision recorded",
		issues: "Changes, refunds and disputes",
	},
	"fa-AF": {
		paymentsLabel: "پرداخت‌ها",
		invoiceLabel: "صورت‌حساب",
		invoiceNumber: "شمارهٔ صورت‌حساب",
		subtitle: "سفارش را بررسی کنید و گام بعدی را انجام دهید.",
		overview: "کالاها، مشتری و معلومات تحویل در یک نگاه.",
		payment: "ماندهٔ حساب و پرداخت‌های دریافتی این سفارش را مدیریت کنید.",
		invoice: "صورت‌حساب اصلی پذیرفته‌شده را ببینید یا دانلود کنید.",
		activity: "رویدادهای ثبت‌شدهٔ این سفارش، مطابق دسترسی فعلی شما.",
		activityEmpty: "در این صفحه رویدادی ثبت نشده است.",
		activityDenied: "دیگر به فعالیت‌های این سفارش دسترسی ندارید.",
		orderEvent: "رویداد سفارش",
		responseRecorded: "پاسخ ثبت شد",
		decisionRecorded: "تصمیم ثبت شد",
		issues: "تغییرات، بازپرداخت‌ها و اختلاف‌ها",
	},
	ps: {
		paymentsLabel: "تادیات",
		invoiceLabel: "بل",
		invoiceNumber: "د بل شمېره",
		subtitle: "دا سپارښتنه وګورئ او بل ګام ته دوام ورکړئ.",
		overview: "توکي، پېرودونکی او د سپارنې معلومات په یوه کتنه کې.",
		payment: "پاتې حساب وګورئ او د دې سپارښتنې ترلاسه شوې پیسې مدیریت کړئ.",
		invoice: "اصلي منل شوی بل وګورئ یا ښکته کړئ.",
		activity: "د دې سپارښتنې ثبت شوې پېښې، ستاسو د اوسني لاسرسي له مخې.",
		activityEmpty: "په دې پاڼه کې ثبت شوې پېښه نشته.",
		activityDenied: "تاسو نور د دې سپارښتنې فعالیتونو ته لاسرسی نه لرئ.",
		orderEvent: "د سپارښتنې پېښه",
		responseRecorded: "ځواب ثبت شو",
		decisionRecorded: "پرېکړه ثبت شوه",
		issues: "بدلونونه، بېرته ورکړې او شخړې",
	},
	ar: {
		paymentsLabel: "المدفوعات",
		invoiceLabel: "الفاتورة",
		invoiceNumber: "رقم الفاتورة",
		subtitle: "راجع الطلب وتابع الخطوة التالية.",
		overview: "المنتجات والعميل وتفاصيل التسليم في لمحة.",
		payment: "راجع الرصيد وأدر الأموال المستلمة لهذا الطلب.",
		invoice: "اعرض الفاتورة الأصلية المقبولة أو نزّلها.",
		activity: "أحداث هذا الطلب المسجلة، وفق صلاحياتك الحالية.",
		activityEmpty: "لا توجد أحداث مسجلة في هذه الصفحة.",
		activityDenied: "لم تعد لديك صلاحية الاطلاع على نشاط هذا الطلب.",
		orderEvent: "حدث الطلب",
		responseRecorded: "تم تسجيل رد",
		decisionRecorded: "تم تسجيل القرار",
		issues: "التغييرات والاسترداد والنزاعات",
	},
} as const;

export function orderActivityLabel(locale: Locale, event: OrderActivityEvent) {
	const a = aftercareCopy[locale],
		f = fulfilmentCopy[locale],
		t = orderViewCopy[locale];
	if (event.source === "orders")
		return event.action === "fixed_order_accepted" ||
			event.action === "negotiated_order_accepted"
			? commerceCopy[locale].accepted
			: t.orderEvent;
	if (event.source === "payments") {
		const refunds: Record<string, string> = {
			refund_due_created: a.due,
			refund_reported: a.reported,
			refund_withdrawn: `${a.reports} · ${a.withdrawn}`,
			refund_confirmed: `${a.reports} · ${a.confirmed}`,
			refund_rejected: `${a.reports} · ${a.rejected}`,
		};
		return `${orderViewCopy[locale].paymentsLabel} · ${refunds[event.action] ?? paymentState(locale, event.action)}`;
	}
	if (event.source === "fulfilment") {
		const events: Record<string, string> = {
			recipient_revised: f.recipient,
			arrangement_proposed: f.arrangement,
			prepared: f.preparation,
			partial_authorized: f.partial,
			charge_proposed: f.proposeCharge,
			charge_finalized: f.finalCharge,
			delivery_claimed: f.claimDelivery,
			claim_withdrawn: f.withdrawClaim,
			correction_proposed: f.correctionDelivery,
			delivery_refund_reported: a.deliveryRefund,
			operational_hold: f.blockers,
			cancellation_hold: f.cancellation,
			dispute_hold: a.disputes,
			dispatched: f.dispatched,
			dispatch_blocked: f.notReady,
			tracking_recorded: f.recordTracking,
			delivered: f.delivered,
			completed: f.completed,
		};
		return `${f.title} · ${events[event.action] ?? f.history}`;
	}
	const events: Record<string, string> = {
		cancellation_requested: `${a.cancellation} · ${a.pending}`,
		cancellation_opened: `${a.cancellation} · ${a.pending}`,
		cancellation_assigned: `${a.cancellation} · ${a.assigned}`,
		cancellation_withdrawn: `${a.cancellation} · ${a.withdrawn}`,
		cancellation_approved: `${a.cancellation} · ${a.approved}`,
		cancellation_rejected: `${a.cancellation} · ${a.rejected}`,
		amendment_proposed: `${a.amendment} · ${a.pending}`,
		amendment_assigned: `${a.amendment} · ${a.assigned}`,
		amendment_withdrawn: `${a.amendment} · ${a.withdrawn}`,
		amendment_approved: `${a.amendment} · ${a.approved}`,
		amendment_rejected: `${a.amendment} · ${a.rejected}`,
		dispute_opened: `${a.disputes} · ${a.disputePending}`,
		dispute_assigned: `${a.disputes} · ${a.assigned}`,
		dispute_response: `${a.disputes} · ${t.responseRecorded}`,
		dispute_withdrawn: `${a.disputes} · ${a.withdrawn}`,
		dispute_decided: `${a.disputes} · ${t.decisionRecorded}`,
		review_submitted: `${a.reviews} · ${a.reviewPending}`,
		review_withdrawn: `${a.reviews} · ${a.withdrawn}`,
		review_decided: `${a.reviews} · ${t.decisionRecorded}`,
	};
	return events[event.action] ?? a.title;
}
