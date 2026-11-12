"use client";
import { useRouter } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { ReportForm } from "../../messaging/components/report";
import { useCommunicationSession } from "../../messaging/hooks";
import { communicationCopy } from "../../messaging/copy";
import { action } from "../../messaging/components/controls";
import { marketplaceCopy } from "../copy";
export function ProductReportPanel({
	locale,
	id,
}: {
	locale: Locale;
	id: string;
}) {
	const router = useRouter(),
		session = useCommunicationSession("buyer"),
		t = marketplaceCopy[locale],
		c = communicationCopy[locale];
	if (session.loading)
		return (
			<p role="status" className="text-sm text-muted">
				{c.loading}
			</p>
		);
	const buyer = session.session?.accounts.some(
		(account) => account.context === "buyer",
	);
	if (!buyer) {
		const signIn = () => {
			const url = new URL(window.location.href);
			url.searchParams.set("auth", "buyer-sign-in");
			url.searchParams.set("return", `/${locale}/products/${id}`);
			router.push(url.pathname + url.search);
		};
		return (
			<div className="space-y-3 text-sm">
				<p className="text-muted">{t.reportSignIn}</p>
				<button type="button" className={`${action} gap-2`} onClick={signIn}>
					<Icon name="lock" className="size-4" />
					{c.signIn}
				</button>
			</div>
		);
	}
	return (
		<ReportForm
			embedded
			key={`${session.session?.identity.id}:${id}:${locale}`}
			locale={locale}
			context="buyer"
			id={id}
			target="product"
		/>
	);
}
