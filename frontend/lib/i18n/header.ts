import type { Locale } from "./locales";
const en = {
	viewCart: "View cart",
	markedRead: "Notification marked as read.",
	actionError: "Action failed. Try again.",
	buyerRole: "Buyer",
	sellerRole: "Seller",
};
type Copy = { [K in keyof typeof en]: string };
export const headerCopy: Record<Locale, Copy> = {
	en,
	"fa-AF": {
		viewCart: "دیدن سبد خرید",
		markedRead: "اطلاعیه به‌عنوان خوانده‌شده نشانی شد.",
		actionError: "انجام کار ناموفق بود. دوباره تلاش کنید.",
		buyerRole: "خریدار",
		sellerRole: "فروشنده",
	},
	ps: {
		viewCart: "د پېرلو ټوکرۍ وګورئ",
		markedRead: "خبرتیا د لوستل شوې په توګه ونښول شوه.",
		actionError: "کار ونه شو. بیا هڅه وکړئ.",
		buyerRole: "پېرودونکی",
		sellerRole: "پلورونکی",
	},
	ar: {
		viewCart: "عرض السلة",
		markedRead: "تم وضع علامة مقروء على الإشعار.",
		actionError: "فشل الإجراء. حاول مرة أخرى.",
		buyerRole: "المشتري",
		sellerRole: "البائع",
	},
};
