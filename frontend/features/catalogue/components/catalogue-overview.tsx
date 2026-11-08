import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy, catalogueStatuses } from "../../../lib/i18n/catalogue";
import { sellerProductsCopy } from "../../../lib/i18n/seller-products";
import type { QueryReader } from "../../../lib/routes/account-routes";
import type { ProductList } from "../types";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { EmptyState } from "../../../components/ui/empty-state";
import { productHref, productLink } from "./seller-products-ui";

export function CatalogueOverview({
	locale,
	list,
	seller,
	filters,
}: {
	locale: Locale;
	list: ProductList;
	seller?: string | null;
	filters?: QueryReader;
}) {
	const t = sellerProductsCopy[locale];
	return (
		<section className="min-w-0 space-y-4" aria-label={t.title}>
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted">
				<span>{t.onPage}</span>
				<span className="rounded-lg bg-info px-2.5 py-1 font-semibold tabular-nums text-action">
					{new Intl.NumberFormat(locale).format(list.results.length)}
				</span>
			</div>
			{!list.results.length && (
				<EmptyState
					icon="box"
					title={catalogueCopy[locale].empty}
					description={t.listHelp}
				/>
			)}
			<ul className="m-0 grid list-none gap-3 p-0">
				{list.results.map((product) => (
					<li
						key={product.id}
						className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:p-5"
					>
						<div className="flex min-w-0 flex-1 items-start gap-3">
							<span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info text-action">
								<Icon name="box" />
							</span>
							<div className="min-w-0 space-y-1">
								<Link
									href={productHref(
										locale,
										`catalogue/${product.id}`,
										seller,
										filters,
									)}
									className="inline-flex min-h-11 items-center text-base font-semibold text-foreground no-underline hover:text-action wrap-anywhere"
								>
									{product.title || t.untitled}
								</Link>
								<p className="text-sm text-muted wrap-anywhere">
									<bdi>{product.seller}</bdi>
								</p>
							</div>
						</div>
						<div className="grid min-w-0 grid-cols-2 gap-3 sm:w-64">
							<div className="min-w-0 space-y-1.5">
								<p className="text-xs text-muted">{t.latestStatus}</p>
								<StatusBadge variant={statusVariant(product.state)}>
									{catalogueStatuses[locale][product.state]}
								</StatusBadge>
							</div>
							<div className="min-w-0 space-y-1.5">
								<p className="text-xs text-muted">{t.publicStatus}</p>
								<StatusBadge
									variant={product.published ? "success" : "neutral"}
								>
									{product.published ? t.live : t.notLive}
								</StatusBadge>
							</div>
						</div>
						<Link
							href={productHref(
								locale,
								`catalogue/${product.id}`,
								seller,
								filters,
							)}
							className={productLink}
							aria-label={`${t.edit}: ${product.title || t.untitled}`}
						>
							{t.edit}
							<Icon name="arrow" className="size-4 rtl:rotate-180" />
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
