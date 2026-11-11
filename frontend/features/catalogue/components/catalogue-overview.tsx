"use client";

import Link from "next/link";
import Image from "next/image";
import {
	Eye,
	EyeOff,
	Heart,
	MoreHorizontal,
	PencilLine,
	Send,
	Trash2,
	Package,
} from "lucide-react";
import { Card, CardContent, CardFooter } from "../../../components/shadcn/card";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "../../../components/shadcn/dropdown-menu";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy, catalogueStatuses } from "../../../lib/i18n/catalogue";
import {
	productFlowCopy,
	productActionsCopy,
	sellerProductsCopy,
} from "../../../lib/i18n/seller-products";
import type { QueryReader } from "../../../lib/routes/account-routes";
import type { ProductList } from "../types";
import { apiOrigin } from "../../../lib/api/client";
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
	const t = sellerProductsCopy[locale],
		a = productActionsCopy[locale];
	return (
		<section className="min-w-0 space-y-4" aria-label={t.title}>
			<p className="text-xs text-muted">
				{t.onPage}{" "}
				<span className="font-semibold text-foreground">
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
			<ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{list.results.map((product) => {
					const title = product.title || t.untitled,
						href = productHref(
							locale,
							`catalogue/${product.id}`,
							seller,
							filters,
						);
					return (
						<li key={product.id} className="min-w-0">
							<Card className="group h-full gap-0 overflow-hidden rounded-2xl border-border bg-surface py-0 shadow-xs transition-shadow hover:shadow-md">
								<Link
									href={href}
									tabIndex={-1}
									aria-hidden="true"
									className="relative m-2 mb-0 flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl bg-info/60 text-action"
								>
									{product.image ? (
										<Image
											unoptimized
											fill
											sizes="(max-width: 480px) 100vw, (max-width: 1024px) 50vw, 25vw"
											src={
												apiOrigin(process.env.NEXT_PUBLIC_API_URL) +
												product.image
											}
											alt=""
											className="object-cover transition-transform group-hover:scale-[1.03] motion-reduce:transform-none"
										/>
									) : (
										<Package className="size-10 opacity-40" />
									)}
								</Link>
								<CardContent className="flex flex-1 flex-col gap-2.5 px-3.5 pt-3 pb-2">
									<div className="flex flex-wrap gap-1.5">
										<Badge
											variant="secondary"
											className={
												product.state === "rejected"
													? "bg-danger-surface text-danger"
													: product.state === "submitted"
														? "bg-warning-surface text-warning"
														: "bg-info text-action"
											}
										>
											{catalogueStatuses[locale][product.state]}
										</Badge>
										{product.published && (
											<Badge
												variant="outline"
												className="border-success/20 bg-success-surface text-success"
											>
												<span
													aria-hidden="true"
													className="size-1.5 rounded-full bg-current"
												/>
												{t.live}
											</Badge>
										)}
									</div>
									<h2
										className="m-0 line-clamp-1 text-sm font-semibold leading-snug"
										title={title}
									>
										<Link
											href={href}
											className="text-foreground no-underline hover:text-action"
										>
											{title}
										</Link>
									</h2>
									<p className="m-0 line-clamp-2 min-h-9 text-xs leading-4.5 text-muted">
										{product.description || a.noDescription}
									</p>
									<p className="m-0 truncate text-[11px] text-muted">
										<bdi>{product.seller}</bdi>
									</p>
								</CardContent>
								<CardFooter
									className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2"
									dir="ltr"
								>
									<div className="flex gap-3 text-xs text-muted">
										<span
											className="inline-flex items-center gap-1"
											title={`${a.views}: ${a.unavailable}`}
										>
											<Eye aria-hidden="true" className="size-3.5" />
											<span aria-hidden="true">—</span>
											<span className="sr-only">
												{a.views}: {a.unavailable}
											</span>
										</span>
										<span
											className="inline-flex items-center gap-1"
											title={`${a.likes}: ${a.unavailable}`}
										>
											<Heart aria-hidden="true" className="size-3.5" />
											<span aria-hidden="true">—</span>
											<span className="sr-only">
												{a.likes}: {a.unavailable}
											</span>
										</span>
									</div>
									<div className="flex gap-1">
										<Button
											asChild
											size="icon"
											variant="ghost"
											className="size-9 rounded-lg text-action"
										>
											<Link
												href={href}
												aria-label={`${t.edit}: ${title}`}
												title={t.edit}
											>
												<PencilLine />
											</Link>
										</Button>
										<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
											<DropdownMenuTrigger asChild>
												<Button
													size="icon"
													variant="ghost"
													className="size-9 rounded-lg"
													aria-label={`${a.menu}: ${title}`}
													title={a.menu}
												>
													<MoreHorizontal />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												align="end"
												sideOffset={6}
												className="w-52 rounded-xl border-border p-1.5"
											>
												<DropdownMenuItem asChild>
													<Link href={href}>
														<PencilLine />
														{t.edit}
													</Link>
												</DropdownMenuItem>
												<DropdownMenuItem
													disabled={
														!product.published && product.state === "submitted"
													}
													onSelect={() =>
														onAction(
															product.id,
															product.published ? "unpublish" : "publish",
														)
													}
												>
													{product.published ? <EyeOff /> : <Send />}
													{product.published ? a.unpublish : a.publish}
												</DropdownMenuItem>
												{product.published ? (
													<DropdownMenuItem asChild>
														<Link
															href={`/${locale}/products/${product.id}`}
															target="_blank"
															rel="noopener noreferrer"
														>
															<Eye />
															{t.viewPublic}
														</Link>
													</DropdownMenuItem>
												) : (
													<DropdownMenuItem disabled>
														<Eye />
														{t.viewPublic}
													</DropdownMenuItem>
												)}
												<DropdownMenuSeparator />
												<DropdownMenuItem
													variant="destructive"
													onSelect={() => onDelete(product.id, title)}
												>
													<Trash2 />
													{productFlowCopy[locale].delete}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</CardFooter>
							</Card>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
