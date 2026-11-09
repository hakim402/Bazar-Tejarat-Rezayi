"use client";
import { type FormEvent, useState } from "react";
import type { components } from "../../lib/api/schema.d";
import type { Locale } from "../../lib/i18n/locales";
import { AccountError, privateRequest } from "../../lib/api/private-client";
import { ACCOUNT_SESSION_CHANGED } from "../../features/identity/api/accounts";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { CheckField, Field, Input } from "../ui/form-field";

type Blocker = components["schemas"]["BlockersEnum"];
type Status = components["schemas"]["ClosureStatus"];

const copy = {
	"fa-AF": {
		title: "بستن حساب",
		body: "با بستن حساب، این نقش دیگر وارد نمی‌شود و در بازار دیده نمی‌شود. سفارش‌ها، پرداخت‌ها و سوابق نگه داشته می‌شوند و پاک نمی‌شوند. بازگشایی فقط از طریق پشتیبانی ممکن است.",
		open: "بستن این حساب",
		loading: "در حال بررسی…",
		blocked: "پیش از بستن حساب این کارها را تمام کنید:",
		ready: "هیچ کار بازی نمانده است.",
		password: "رمز عبور فعلی",
		confirm:
			"می‌فهمم که این حساب بسته می‌شود و فقط پشتیبانی می‌تواند آن را دوباره باز کند.",
		submit: "بستن حساب",
		wrong: "رمز عبور پذیرفته نشد.",
		limited: "تلاش‌های زیاد. لطفاً بعداً دوباره کوشش کنید.",
		failed: "بستن حساب ممکن نشد. دوباره کوشش کنید.",
		closed: "حساب بسته شد.",
		blockers: {
			open_orders: "سفارش‌های باز",
			refunds_outstanding: "بازپرداخت‌های تأییدنشده",
			pending_disputes: "اختلاف‌های در انتظار",
			open_negotiations: "مذاکره‌های باز",
			open_payment_reviews: "بررسی‌های باز پرداخت",
			open_delivery_reviews: "بررسی‌های باز تحویل",
			sole_company_owner: "شما تنها مالک فعال یک شرکت هستید",
		},
	},
	ps: {
		title: "حساب تړل",
		body: "د حساب په تړلو سره دا رول نور نه ننوځي او په بازار کې نه ښکاري. فرمایشونه، تادیې او ریکارډونه ساتل کېږي او نه ړنګېږي. بیا پرانیستل یوازې د ملاتړ له لارې کېږي.",
		open: "دا حساب وتړئ",
		loading: "کتنه روانه ده…",
		blocked: "د حساب له تړلو مخکې دا کارونه بشپړ کړئ:",
		ready: "هېڅ پرانیستی کار نشته.",
		password: "اوسنی پټنوم",
		confirm: "پوهېږم چې دا حساب تړل کېږي او یوازې ملاتړ یې بیا پرانیستلی شي.",
		submit: "حساب وتړئ",
		wrong: "پټنوم ونه منل شو.",
		limited: "ډېرې هڅې. وروسته بیا هڅه وکړئ.",
		failed: "حساب ونه تړل شو. بیا هڅه وکړئ.",
		closed: "حساب وتړل شو.",
		blockers: {
			open_orders: "پرانیستي فرمایشونه",
			refunds_outstanding: "نه تایید شوې بیرته ورکړې",
			pending_disputes: "پاتې شخړې",
			open_negotiations: "پرانیستې خبرې اترې",
			open_payment_reviews: "د تادیې پرانیستې کتنې",
			open_delivery_reviews: "د سپارنې پرانیستې کتنې",
			sole_company_owner: "تاسو د یوه شرکت یوازینی فعال مالک یاست",
		},
	},
	ar: {
		title: "إغلاق الحساب",
		body: "عند إغلاق الحساب لا يمكن الدخول بهذا الدور ولا يظهر في السوق. تبقى الطلبات والمدفوعات والسجلات محفوظة ولا تُحذف. إعادة الفتح ممكنة عبر الدعم فقط.",
		open: "إغلاق هذا الحساب",
		loading: "جارٍ التحقق…",
		blocked: "أكمل هذه الأعمال قبل إغلاق الحساب:",
		ready: "لا توجد أعمال مفتوحة.",
		password: "كلمة المرور الحالية",
		confirm: "أفهم أن هذا الحساب سيُغلق وأن الدعم وحده يمكنه إعادة فتحه.",
		submit: "إغلاق الحساب",
		wrong: "لم تُقبل كلمة المرور.",
		limited: "محاولات كثيرة. حاول لاحقًا.",
		failed: "تعذّر إغلاق الحساب. حاول مرة أخرى.",
		closed: "تم إغلاق الحساب.",
		blockers: {
			open_orders: "طلبات مفتوحة",
			refunds_outstanding: "مبالغ مستردة غير مؤكدة",
			pending_disputes: "نزاعات معلّقة",
			open_negotiations: "مفاوضات مفتوحة",
			open_payment_reviews: "مراجعات دفع مفتوحة",
			open_delivery_reviews: "مراجعات تسليم مفتوحة",
			sole_company_owner: "أنت المالك النشط الوحيد لشركة",
		},
	},
	en: {
		title: "Close account",
		body: "Closing stops this role from signing in and removes it from the marketplace. Orders, payments and records are kept, not deleted. Only support can reopen it.",
		open: "Close this account",
		loading: "Checking…",
		blocked: "Finish these before closing the account:",
		ready: "No open work remains.",
		password: "Current password",
		confirm:
			"I understand this account will be closed and only support can reopen it.",
		submit: "Close account",
		wrong: "The password was not accepted.",
		limited: "Too many attempts. Try again later.",
		failed: "The account could not be closed. Try again.",
		closed: "The account is closed.",
		blockers: {
			open_orders: "Open orders",
			refunds_outstanding: "Refunds not yet confirmed",
			pending_disputes: "Pending disputes",
			open_negotiations: "Open negotiations",
			open_payment_reviews: "Open payment reviews",
			open_delivery_reviews: "Open delivery reviews",
			sole_company_owner: "You are the only active owner of a company",
		},
	},
} satisfies Record<Locale, unknown>;

export function CloseAccount({
	locale,
	context,
}: {
	locale: Locale;
	context: "buyer" | "seller";
}) {
	const t = copy[locale];
	const path = `auth/${context}/closure/`;
	const [blockers, setBlockers] = useState<Blocker[] | null>(null);
	const [loading, setLoading] = useState(false),
		[busy, setBusy] = useState(false),
		[confirm, setConfirm] = useState(false);
	const [error, setError] = useState(""),
		[done, setDone] = useState(false);

	async function load() {
		setLoading(true);
		setError("");
		try {
			setBlockers((await privateRequest<Status>(path)).blockers);
		} catch {
			setError(t.failed);
		} finally {
			setLoading(false);
		}
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !confirm) return;
		const password = String(
			new FormData(event.currentTarget).get("password") ?? "",
		);
		setBusy(true);
		setError("");
		try {
			await privateRequest(path, { password, confirm: true });
			setDone(true);
			window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED));
			window.location.assign(`/${locale}`);
		} catch (cause) {
			const status = cause instanceof AccountError ? cause.status : 0;
			if (
				status === 400 &&
				cause instanceof AccountError &&
				cause.fields.includes("blockers")
			)
				await load();
			else
				setError(
					status === 403 ? t.wrong : status === 429 ? t.limited : t.failed,
				);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section
			aria-labelledby={`close-${context}-heading`}
			className="space-y-3 rounded-card border border-border bg-surface p-5"
			data-testid="close-account"
		>
			<h2 id={`close-${context}-heading`} className="text-xl font-bold">
				{t.title}
			</h2>
			<p className="max-w-3xl text-sm leading-relaxed text-muted">{t.body}</p>
			<details
				onToggle={(event) => {
					if (event.currentTarget.open && blockers === null && !loading)
						void load();
				}}
			>
				<summary className="min-h-11 cursor-pointer py-3 font-bold text-danger">
					{t.open}
				</summary>
				{loading && (
					<p role="status" className="text-muted">
						{t.loading}
					</p>
				)}
				{error && <Alert role="alert">{error}</Alert>}
				{done && (
					<Alert variant="success" role="status">
						{t.closed}
					</Alert>
				)}
				{blockers && blockers.length > 0 && (
					<div className="space-y-2">
						<p className="font-bold">{t.blocked}</p>
						<ul className="list-disc space-y-1 ps-6 text-sm">
							{blockers.map((code) => (
								<li key={code}>{t.blockers[code]}</li>
							))}
						</ul>
					</div>
				)}
				{blockers && blockers.length === 0 && !done && (
					<form onSubmit={submit} className="max-w-md space-y-2">
						<p className="text-sm text-muted">{t.ready}</p>
						<Field name={`close-${context}-password`} label={t.password}>
							<Input
								id={`field-close-${context}-password`}
								name="password"
								type="password"
								autoComplete="current-password"
								required
								dir="ltr"
							/>
						</Field>
						<CheckField
							name={`close-${context}-confirm`}
							checked={confirm}
							onChange={(event) => setConfirm(event.currentTarget.checked)}
							label={t.confirm}
						/>
						<Button
							type="submit"
							variant="secondary"
							className="text-danger"
							disabled={busy || !confirm}
						>
							{t.submit}
						</Button>
					</form>
				)}
			</details>
		</section>
	);
}
