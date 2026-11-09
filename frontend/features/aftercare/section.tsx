import Link from "next/link";
import type { Locale } from "../../lib/i18n/locales";
import { uuidPattern } from "../../lib/routes/account-routes";
import { action, panel } from "../orders/components/controls";
import { salesAction, salesPanel } from "../sales/components/seller-sales-ui";
import { aftercareHref } from "./api";
import { AftercareWorkspace } from "./workspace";
import { aftercareCopy } from "./copy";
import type { Context } from "./types";

type Props = {
	locale: Locale;
	context: Context;
	orderId: string;
	seller?: string;
	interactive?: boolean;
};

// Order readers may mount the independently authorized aftercare poll owner.
// Already-polling payment/invoice/fulfilment pages retain only the deliberate link.
export function AftercareSection({ locale, context, orderId, seller, interactive = false }: Props) {
	if (!uuidPattern.test(orderId)) return null;
	const t = aftercareCopy[locale];
	if (interactive) return <section className="min-w-0 space-y-3"><AftercareWorkspace {...{ locale, context, orderId }} embedded /><Link className={context === "seller" ? salesAction : action} prefetch={false} href={aftercareHref(locale, context, orderId, seller)}>{t.openWorkspace}</Link></section>;
	return (
		<section
			className={`${context === "seller" ? salesPanel : panel} space-y-3`}
		>
			<h2 className="text-xl font-bold">{t.title}</h2>
			<Link
				className={context === "seller" ? salesAction : action}
				prefetch={false}
				href={aftercareHref(locale, context, orderId, seller)}
			>
				{t.openWorkspace}
			</Link>
		</section>
	);
}
