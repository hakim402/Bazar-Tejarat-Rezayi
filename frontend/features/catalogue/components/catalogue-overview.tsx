import Link from "next/link";
import Image from "next/image";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy, catalogueStatuses } from "../../../lib/i18n/catalogue";
import {
	productFlowCopy,
	productActionsCopy,
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
import { productHref } from "./seller-products-ui";

export function CatalogueOverview({
	locale,
	list,
	seller,
	filters,
	onDelete,
	onAction,
}: {
	locale: Locale;
	list: ProductList;
	seller?: string | null;
	filters?: QueryReader;
	onDelete: (id: string, title: string) => void;
	onAction: (id: string, action: "publish" | "unpublish") => void;
}) {
	const t = sellerProductsCopy[locale];
	const a = productActionsCopy[locale];
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
									<p className="line-clamp-2 text-sm leading-relaxed text-muted">
										{product.description || a.noDescription}
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
								<div className="flex items-end justify-between gap-2" dir="ltr">
									<div
										className="flex flex-wrap gap-3 text-xs text-muted"
										dir={locale === "en" ? "ltr" : "rtl"}
									>
										<span>
											{a.views}: {a.unavailable}
										</span>
										<span>
											{a.likes}: {a.unavailable}
										</span>
									</div>
									<details
										className="relative shrink-0"
										dir={locale === "en" ? "ltr" : "rtl"}
									>
										<summary
											aria-label={a.menu}
											className="flex size-10 cursor-pointer list-none items-center justify-center rounded-xl border border-border bg-surface text-xl hover:bg-info [&::-webkit-details-marker]:hidden"
										>
											⋯
										</summary>
										<div className="absolute bottom-full right-0 z-20 mb-2 grid w-56 max-w-[75vw] gap-1 rounded-xl border border-border bg-surface p-2 text-sm shadow-lifted">
											<Link
												className="rounded-lg px-3 py-2 text-foreground no-underline hover:bg-info"
												href={href}
											>
												{t.edit}
											</Link>
											{product.published ? (
												<button
													type="button"
													className="rounded-lg border-0 bg-transparent px-3 py-2 text-start hover:bg-info"
													onClick={(event) => {
														event.currentTarget
															.closest("details")
															?.removeAttribute("open");
														onAction(product.id, "unpublish");
													}}
												>
													{a.unpublish}
												</button>
											) : (
												<button
													type="button"
													disabled={product.state === "submitted"}
													className="rounded-lg border-0 bg-transparent px-3 py-2 text-start hover:bg-info disabled:opacity-50"
													onClick={(event) => {
														event.currentTarget
															.closest("details")
															?.removeAttribute("open");
														onAction(product.id, "publish");
													}}
												>
													{a.publish}
												</button>
											)}
											{product.published ? (
												<Link
													className="rounded-lg px-3 py-2 text-foreground no-underline hover:bg-info"
													href={`/${locale}/products/${product.id}`}
													target="_blank"
													rel="noopener noreferrer"
												>
													{t.viewPublic}
												</Link>
											) : (
												<span className="px-3 py-2 text-muted opacity-60">
													{t.viewPublic} · {t.notLive}
												</span>
											)}
											<button
												type="button"
												className="rounded-lg border-0 bg-transparent px-3 py-2 text-start text-danger hover:bg-danger-surface"
												onClick={(event) => {
													event.currentTarget
														.closest("details")
														?.removeAttribute("open");
													onDelete(product.id, product.title || t.untitled);
												}}
											>
												{productFlowCopy[locale].delete}
											</button>
										</div>
									</details>
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
