import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../../../lib/i18n/locales";
import { OrdersWorkspace } from "../../../../../../../../features/orders/components/orders";
export function PageContent({ locale, id }: { locale: Locale; id?: string }) {
	if (!id) return notFound();
	return (
		<OrdersWorkspace locale={locale} context="seller" mode="orders" id={id} />
	);
}
