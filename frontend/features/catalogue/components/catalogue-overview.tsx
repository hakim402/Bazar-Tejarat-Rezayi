import Link from "next/link";
import Image from "next/image";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy, catalogueStatuses } from "../../../lib/i18n/catalogue";
import {
	productFlowCopy,
	sellerProductsCopy,
} from "../../../lib/i18n/seller-products";
import type { QueryReader } from "../../../lib/routes/account-routes";
import type { ProductList } from "../types";
import { Icon } from "../../../components/ui/icon";
import { apiOrigin } from "../../../lib/api/client";
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
	onDelete,
}: {
	locale: Locale;
	list: ProductList;
	seller?: string | null;
	filters?: QueryReader;
	onDelete: (id: string, title: string) => void;
}) {
	const t = sellerProductsCopy[locale];
	return (
		<section className="min-w-0 space-y-4" aria-label={t.title}>
			<p className="text-sm text-muted">
				{t.onPage}{" "}
				<span className="ms-1 font-semibold tabular-nums text-foreground">
					{new Intl.NumberFormat(locale).format(list.results.length)}
				</span>
			</p>
			{!list.results.length && (
				<EmptyState
					icon="box"
					title={catalogueCopy[locale].empty}
					description={t.listHelp}
				/>
			)}
			<ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
				{list.results.map((product) => {
					const href = productHref(
						locale,
						`catalogue/${product.id}`,
						seller,
						filters,
					);
					return (
						<li
							key={product.id}
							className="group flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-surface p-3 shadow-sm transition-shadow hover:shadow-card motion-reduce:transition-none"
						>
							<Link
								href={href}
								tabIndex={-1}
								aria-hidden="true"
								className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-2xl bg-info/60 text-action no-underline"
							>
								{product.image ? (
									<Image
										unoptimized
										fill
										sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
										className="object-cover transition-transform group-hover:scale-[1.03] motion-reduce:transform-none"
										src={
											apiOrigin(process.env.NEXT_PUBLIC_API_URL) + product.image
										}
										alt={product.title || t.untitled}
									/>
								) : (
									<>
										<span className="absolute inset-6 rounded-2xl border border-action/10 rotate-6" />
										<Icon
											name="box"
											className="size-14 opacity-60 transition-transform group-hover:scale-105 motion-reduce:transform-none"
										/>
									</>
								)}
							</Link>
							<div className="flex flex-1 flex-col gap-4 px-2 pb-2 pt-5">
								<div className="min-w-0 flex-1 space-y-2">
									<h2 className="text-base font-semibold leading-snug wrap-anywhere">
										<Link
											href={href}
											className="text-foreground no-underline hover:text-action"
										>
											{product.title || t.untitled}
										</Link>
									</h2>
									<p className="text-sm text-muted wrap-anywhere">
										<bdi>{product.seller}</bdi>
									</p>
								</div>
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<StatusBadge variant={statusVariant(product.state)}>
										{catalogueStatuses[locale][product.state]}
									</StatusBadge>
									<span className="text-xs text-muted">
										{product.published ? t.live : t.notLive}
									</span>
								</div>
								<div className="grid grid-cols-[1fr_auto] gap-2">
									<Link
										href={href}
										className={`${productLink} w-full border-action! bg-action! text-on-primary! hover:bg-action-hover!`}
										aria-label={`${t.edit}: ${product.title || t.untitled}`}
									>
										{t.edit}
										<Icon name="arrow" className="size-4 rtl:rotate-180" />
									</Link>
									<button
										type="button"
										onClick={() =>
											onDelete(product.id, product.title || t.untitled)
										}
										className="min-h-11 rounded-xl border border-danger/30 bg-surface px-3 text-sm font-semibold text-danger hover:bg-danger-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
									>
										{productFlowCopy[locale].delete}
									</button>
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
