import Link from "next/link";
import type { Locale } from "../../lib/i18n/locales";
import { uuidPattern } from "../../lib/routes/account-routes";
import { action, panel } from "../orders/components/controls";
import { salesAction, salesPanel } from "../sales/components/seller-sales-ui";
import { aftercareHref } from "./api";
import { aftercareCopy } from "./copy";
import type { Context } from "./types";

type Props = {
	locale: Locale;
	context: Context;
	orderId: string;
	seller?: string;
};

// The containing page owns its session and polling. Private details and history
// are loaded only by the dedicated, independently authorized workspace.
export function AftercareSection({ locale, context, orderId, seller }: Props) {
	if (!uuidPattern.test(orderId)) return null;
	const t = aftercareCopy[locale];
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
