import type { Locale } from "../../../../../lib/i18n/locales";
import { CartWorkspace } from "../../../../../features/cart/components/cart";
export function PageContent({ locale }: { locale: Locale }) {
	return (
		<div className="mx-auto max-w-5xl px-4 py-8">
			<CartWorkspace locale={locale} />
		</div>
	);
}
