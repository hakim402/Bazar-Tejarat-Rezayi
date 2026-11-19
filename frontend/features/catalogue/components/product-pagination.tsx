"use client";
import { Pager } from "../../../components/pager";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { sellerProductsCopy } from "../../../lib/i18n/seller-products";
import type { Locale } from "../../../lib/i18n/locales";
import type { QueryReader } from "../../../lib/routes/account-routes";
import { productHref } from "./seller-products-ui";

export function ProductPagination({
	locale,
	page,
	count,
	seller,
	filters,
}: {
	locale: Locale;
	page: number;
	count: number;
	seller: string | null;
	filters: QueryReader;
}) {
	const t = catalogueCopy[locale],
		copy = sellerProductsCopy[locale],
		number = new Intl.NumberFormat(locale),
		last = Math.min(10000, Math.max(1, Math.ceil(count / 8)));
	return (
		<Pager
			locale={locale}
			page={page}
			count={count}
			pageSize={8}
			href={(n) =>
				productHref(locale, "catalogue", seller, filters, { page: String(n) })
			}
			labels={{ prev: t.back, next: t.next, page: copy.page }}
			className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row"
			summary={
				<p className="m-0 shrink-0 text-xs text-muted">
					{copy.page}{" "}
					<bdi>
						{number.format(page)} / {number.format(last)}
					</bdi>
				</p>
			}
		/>
	);
}